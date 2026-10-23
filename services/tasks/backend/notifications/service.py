"""The one entry point for notifying a user.

notify() ALWAYS creates the in-app notification, then fans out to Gmail and
WhatsApp. Channel senders are inert until configured, and every attempt
(sent / skipped / error) is recorded on the notification row itself.
"""
from django.conf import settings
from django.utils import timezone

from .channels import gmail, whatsapp
from .models import Notification

HOURS_SETTING = "WHATSAPP_HOURS"


def whatsapp_hours() -> tuple[int, int]:
    """WhatsApp goes out only inside these local hours, e.g. "10-19" = 10 AM up to 7 PM. A per-company
    setting (WHATSAPP_HOURS, Task settings -> WhatsApp hours); default settings.WHATSAPP_HOURS ("10-19",
    "0-24" under tests). Outside them a WhatsApp is held for the next opening or skipped."""
    from tenancy.company_settings import company_env

    raw = company_env(HOURS_SETTING, getattr(settings, "WHATSAPP_HOURS", "10-19")) or "10-19"
    try:
        a, b = (int(x) for x in raw.split("-"))
    except ValueError:
        return 10, 19
    if not (0 <= a < b <= 24):
        return 10, 19
    return a, b


def in_whatsapp_hours(now=None) -> bool:
    start, end = whatsapp_hours()
    return start <= timezone.localtime(now).hour < end


def _remember_whatsapp(user, result: dict, template: str) -> None:
    """Meta reports delivery later, on a callback that carries only the
    message id. Without this row that callback has nothing to attach to, and
    "accepted by Meta" stays the only thing anyone can ever find out."""
    wamid = (result or {}).get("wamid")
    if not wamid:
        return
    from .delivery import WhatsAppDelivery
    WhatsAppDelivery.objects.update_or_create(
        wamid=wamid,
        defaults={"user": user, "phone": user.whatsapp_phone or "",
                  "template": template, "status": "accepted"},
    )


def notify(user, type_: str, title: str, body: str = "", link: str = "",
           wa_template: tuple[str, list] | None = None,
           link_label: str | None = None,
           extra_links=(), want_whatsapp: bool = True,
           want_email: bool = True, outside_hours: str = "defer") -> Notification:
    """wa_template=(template_name, [params]) routes the WhatsApp leg through
    an approved Meta template (deliverable any time); without it the message
    goes as free-form text, which Meta only delivers inside a 24h
    customer-service window. want_whatsapp=False keeps it to in-app and email.

    Outside the company's WhatsApp hours (default 10 AM - 7 PM) the in-app
    note and email still go at once; the WhatsApp is held for the next opening
    (outside_hours="defer") or dropped (outside_hours="skip", for reminders
    that repeat anyway and would otherwise pile up at the opening)."""
    from tenancy.profile import app_name, brand

    from .rules import allows
    # The company's notification rules (PLAN.md §16.5) can turn off the email or WhatsApp copy.
    want_email = want_email and allows(type_, "email")
    want_whatsapp = want_whatsapp and allows(type_, "whatsapp")
    if link_label is None:
        # A Kaampilot company sees its own name; a standalone install keeps the original wording.
        link_label = f"Open in {app_name()}" if brand() else "Open in Automate Task"
    results = []
    if want_email:
        results.append(gmail.send_email(
            user.email, f"[{app_name()}] {title}", body or title,
            link=link, link_label=link_label, extra_links=extra_links))
    deferred = None
    if not want_whatsapp:
        wa = {"channel": "whatsapp", "status": "skipped", "detail": "not sent to this user"}
    elif not in_whatsapp_hours():
        start, end = whatsapp_hours()
        if outside_hours == "skip":
            wa = {"channel": "whatsapp", "status": "skipped",
                  "detail": f"outside WhatsApp hours ({start}:00-{end}:00)"}
        else:
            wa = {"channel": "whatsapp", "status": "deferred", "detail": f"held until {start}:00"}
            deferred = {"template": wa_template[0] if wa_template else None,
                        "params": list(wa_template[1]) if wa_template else [],
                        "text": f"{title}\n{body}".strip()}
    elif wa_template:
        wa = whatsapp.send_template(user.whatsapp_phone, wa_template[0], wa_template[1])
    else:
        wa = whatsapp.send_text(user.whatsapp_phone, f"{title}\n{body}".strip())
    results.append(wa)
    _remember_whatsapp(user, wa, wa_template[0] if wa_template else "")
    return Notification.objects.create(
        user=user, type=type_, title=title, body=body, link=link, channels=results,
        wa_deferred=deferred,
    )


def send_deferred_whatsapp(limit: int = 300) -> int:
    """Send the WhatsApps held back outside the hours, once they open again (run by the worker for each
    company). Anything held for more than 3 days is dropped -- it is no longer news."""
    if not in_whatsapp_hours():
        return 0
    stale = timezone.now() - timezone.timedelta(days=3)
    sent = 0
    for n in (Notification.objects.filter(wa_deferred__isnull=False)
              .select_related("user").order_by("created_at")[:limit]):
        held = n.wa_deferred or {}
        if n.created_at < stale or not n.user.is_active:
            res = {"channel": "whatsapp", "status": "skipped", "detail": "held too long, dropped"}
        elif held.get("template"):
            res = whatsapp.send_template(n.user.whatsapp_phone, held["template"], held.get("params") or [])
            _remember_whatsapp(n.user, res, held["template"])
        else:
            res = whatsapp.send_text(n.user.whatsapp_phone, held.get("text") or n.title)
            _remember_whatsapp(n.user, res, "")
        n.channels = [res if c.get("channel") == "whatsapp" and c.get("status") == "deferred" else c
                      for c in (n.channels or [])]
        n.wa_deferred = None
        n.save(update_fields=["channels", "wa_deferred"])
        sent += 1
    return sent


def notify_lead_assigned(lead, actor=None):
    if not lead.assigned_to:
        return None
    if actor is not None and actor.pk == lead.assigned_to.pk:
        return None  # self-assignment needs no ping
    who = (actor.get_full_name() or actor.username) if actor else "System"
    return notify(
        lead.assigned_to, "lead_assigned",
        f"New lead assigned: {lead.customer_name}",
        f"{lead.requirement or 'No requirement captured yet.'}\n"
        f"Source: {lead.get_source_display()} · Priority: {lead.get_priority_display()} · By: {who}",
        link="/leads",
    )


def notify_status_change(lead, actor, old_status_label):
    if not lead.assigned_to or actor.pk == lead.assigned_to.pk:
        return None
    return notify(
        lead.assigned_to, "status_change",
        f"Lead updated: {lead.customer_name}",
        f"Status changed {old_status_label} -> {lead.get_status_display()} "
        f"by {actor.get_full_name() or actor.username}",
        link="/leads",
    )


def notify_follow_up_due(lead):
    if not lead.assigned_to:
        return None
    return notify(
        lead.assigned_to, "follow_up_due",
        f"Follow-up due: {lead.customer_name}",
        f"{lead.requirement or ''}\nStatus: {lead.get_status_display()} · "
        f"Phone: {lead.phone or '-'}".strip(),
        wa_template=("lead_followup_due", [
            lead.assigned_to.get_full_name() or lead.assigned_to.username,
            lead.customer_name,
            lead.get_status_display(),
            lead.phone or "not on file",
        ]),
        link="/leads",
    )
