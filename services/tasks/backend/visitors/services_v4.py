"""Visitors V4 (PLAN.md §22.11): the 4-digit check-in code, the visitor's phone bound to their visit, the check-out QR
with feedback, and the host saying where the visitor should wait (in the app and by WhatsApp template).

V4.1 (2026-10-29): check-out needs no code (the request shows in the guard's "Waiting to leave" list: Approve / Hold),
and whom to meet is optional (company setting `whom_to_meet`, optionally `whom_required`).
"""
import hashlib
import secrets
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, Throttled, ValidationError

from . import conf
from .models import GateAction, GateLog, Visit, VisitStatus
from .services import can_gate, can_view_all, log, name_of, text, who

CODE_TRIES = 10                    # wrong codes per guard ...
CODE_WINDOW = timedelta(minutes=5)  # ... in this window lock code entry for the rest of it
NO_CODE = "No visitor is waiting with this code."
ANSWERS = {"place": "Wait at", "coming": "Host is coming to the gate", "unavailable": "Host is not available"}


# ---------------------------------------------------------------- codes

def code_minutes() -> int:
    return int(conf.get()["code_minutes"] or 120)


def pending_checkin(now=None) -> Q:
    return Q(status=VisitStatus.WAITING, code_expires_at__gt=now or timezone.now())


def new_code(now=None) -> str:
    """4 random digits (like an OTP; never derived from an id), unique among the company's pending check-in codes, so
    the "Visitor code" box finds exactly one visit."""
    now = now or timezone.now()
    for _ in range(60):
        code = f"{secrets.randbelow(10000):04d}"
        taken = Visit.objects.filter(pending_checkin(now), short_code=code).exists()
        if not taken:
            return code
    raise ValidationError({"detail": "Too many visitors are waiting right now. Please ask the guard."})


def _misses(actor, now) -> int:
    return GateLog.objects.filter(actor=actor, action=GateAction.CODE_MISS, at__gte=now - CODE_WINDOW).count()


def find_by_code(actor, raw) -> tuple[str, Visit]:
    """The gate types a check-in code: ("checkin", visit) (check-out has no code since V4.1). Wrong codes are counted per guard; after CODE_TRIES in
    CODE_WINDOW code entry is locked for the rest of the window. A miss never says what was wrong."""
    now = timezone.now()
    if _misses(actor, now) >= CODE_TRIES:
        raise Throttled(wait=int(CODE_WINDOW.total_seconds()),
                        detail="Too many wrong codes. Wait 5 minutes, or find the visitor in the list.")
    code = "".join(ch for ch in str(raw or "") if ch.isdigit())
    v = None
    if len(code) == 4:
        v = Visit.objects.filter(pending_checkin(now), short_code=code).select_related("host", "location").first()
    if not v:
        log(actor, GateAction.CODE_MISS, "Wrong visitor code entered")
        raise ValidationError({"code": NO_CODE})
    return "checkin", v


def expire_codes(now=None) -> int:
    """QR sign-ins still waiting when their code ran out: Did not come (the guard never let them in)."""
    now = now or timezone.now()
    rows = list(Visit.objects.filter(status=VisitStatus.WAITING, code_expires_at__isnull=False, code_expires_at__lte=now))
    for v in rows:
        v.status = VisitStatus.NO_SHOW
        v.save(update_fields=["status"])
    return len(rows)


# ---------------------------------------------------------------- the visitor's phone

def new_device() -> tuple[str, str]:
    """(secret for the phone, hash kept on the visit)."""
    secret = secrets.token_urlsafe(32)
    return secret, hash_device(secret)


def hash_device(secret: str) -> str:
    return hashlib.sha256(str(secret or "").encode()).hexdigest()


def visit_for_device(secret: str, only_inside=False):
    secret = str(secret or "").strip()
    if not 20 <= len(secret) <= 100:
        return None
    qs = Visit.objects.filter(device_hash=hash_device(secret), anonymised=False)
    if only_inside:
        qs = qs.filter(status=VisitStatus.INSIDE)
    return qs.select_related("host", "location").order_by("-created_at").first()


def where_to_wait(v: Visit) -> str:
    if v.host_answer == "place" and v.host_place:
        return f"Please wait at {v.host_place}."
    if v.host_answer == "coming":
        return "Your host is coming to the gate."
    if v.host_answer == "unavailable":
        return "Your host is not available. Please speak to the guard."
    return ""


def device_state(v: Visit | None) -> dict:
    """What the visitor's own phone may show: the state of their own visit, its check-in code, where to wait, and the
    guard's hold note (said to them). Nothing about anyone else, never the host's contact details."""
    if not v:
        return {"state": "none"}
    now = timezone.now()
    first = (v.name or "").split(" ")[0]
    out = {"first_name": first, "pass_no": v.pass_no, "where": where_to_wait(v)}
    if v.status == VisitStatus.WAITING:
        live = bool(v.code_expires_at and v.code_expires_at > now)
        out |= {"state": "pending" if live else "expired", "code": v.short_code if live else "",
                "expires_at": timezone.localtime(v.code_expires_at).isoformat() if live else None}
    elif v.status == VisitStatus.WAITING_HOST:
        out |= {"state": "waiting_host"}
    elif v.status == VisitStatus.INSIDE:
        if v.checkout_requested_at:
            out |= {"state": "leaving"}  # "Please wait, the guard will let you out" (V4.1: no code)
        elif v.checkout_held_at:
            out |= {"state": "held", "note": v.checkout_hold_note}
        else:
            out |= {"state": "inside"}
    elif v.status == VisitStatus.OUT:
        out |= {"state": "out", "where": ""}
    else:  # turned away / denied / did not come / cancelled
        out |= {"state": "closed", "where": ""}
    return out


# ---------------------------------------------------------------- check-out from the phone

def request_checkout(v: Visit, data: dict) -> Visit:
    if v.status != VisitStatus.INSIDE:
        raise ValidationError({"detail": "This visit is not inside."})
    now = timezone.now()
    rating = data.get("rating")
    if rating not in (None, ""):
        try:
            rating = int(rating)
        except (TypeError, ValueError):
            raise ValidationError({"rating": "Pick 1 to 5."})
        if not 1 <= rating <= 5:
            raise ValidationError({"rating": "Pick 1 to 5."})
        v.feedback_rating = rating
    comment = text(data.get("comment"), 300)
    if comment:
        v.feedback_comment = comment
    if rating not in (None, "") or comment:
        v.feedback_at = now
    if not v.checkout_requested_at:  # a double tap keeps the first request (and its place in the guard's list)
        v.checkout_requested_at = now
        v.checkout_held_at, v.checkout_hold_note = None, ""
        v.save()
        log(None, GateAction.CHECKOUT_REQUEST, f"{who(v)} asked to check out from their phone", visit=v)
    else:
        v.save()
    return v


def approve_checkout(actor, v: Visit) -> Visit:
    if v.status != VisitStatus.INSIDE or not v.checkout_requested_at:
        raise ValidationError({"detail": "This visitor has not asked to check out."})
    v.status, v.check_out_at, v.check_out_by, v.checkout_via = VisitStatus.OUT, timezone.now(), actor, "qr"
    v.save()
    log(actor, GateAction.CHECKOUT_APPROVE, f"{who(v)} out after {v.minutes_inside()} min (asked from their phone)", visit=v)
    return v


def hold_checkout(actor, v: Visit, note: str) -> Visit:
    if v.status != VisitStatus.INSIDE or not v.checkout_requested_at:
        raise ValidationError({"detail": "This visitor has not asked to check out."})
    note = text(note, 200)
    v.checkout_requested_at = None
    v.checkout_held_at, v.checkout_hold_note = timezone.now(), note
    v.save()
    log(actor, GateAction.CHECKOUT_HOLD, f"{who(v)}: check-out held{f': {note}' if note else ''}", visit=v)
    return v


# ---------------------------------------------------------------- whom to meet -> where to wait

def answer_path(v: Visit) -> str:
    # Tasks-relative like every Tasks link (/tasks/visitors/... opens /visitors/... in the web app).
    return f"/visitors/answer?visit={v.pk}"


def ask_host(v: Visit) -> None:
    """The visit was approved: the host is asked where the visitor should wait. In-app always; a WhatsApp template
    only when the company has one approved (no free-form WhatsApp), and only inside the WhatsApp hours."""
    host = v.host
    if not host or not host.is_active:
        return  # V4.1: nobody picked ("Not sure"): nobody is asked
    s = conf.get()
    if not s["whom_to_meet"]:
        # V4.1: the company does not use whom to meet / where to wait. A host the guard picked (or who invited the
        # visitor) is still told they arrived, as before V4: in the app only, no question, no WhatsApp.
        from .services import _notify, visit_link
        _notify(host, "visitor_arrived", f"{v.name} is at the gate for you",
                f"{who(v)} · {v.purpose or 'visit'} · pass {v.pass_no}", visit_link(v))
        return
    from notifications.service import notify
    template = s["host_wa_template"]
    first = host.first_name or name_of(host)
    try:
        notify(host, "visitor_arrived", f"{v.name} is at the gate for you"[:200],
               f"{who(v)} · {v.purpose or 'visit'} · pass {v.pass_no}. Tell the guard where they should wait.",
               link=answer_path(v), link_label="Answer", want_email=False, want_whatsapp=bool(template),
               wa_template=(template, [first, v.name, v.company or "-", v.purpose or "visit"]) if template else None,
               wa_url_button=answer_path(v).lstrip("/"), wa_lang=s["host_wa_lang"] or "en", outside_hours="skip")
    except Exception:  # noqa: BLE001 -- a failed notice never blocks the gate
        pass
    v.host_notified_at = timezone.now()
    v.save(update_fields=["host_notified_at"])


def host_answer(actor, v: Visit, data: dict) -> Visit:
    if v.host_id != actor.pk and not can_view_all(actor):
        raise PermissionDenied("Only the person they came to meet can answer.")
    if v.status not in (VisitStatus.INSIDE, VisitStatus.WAITING_HOST):
        raise ValidationError({"detail": "This visit is over."})
    answer = data.get("answer")
    if answer not in ANSWERS:
        raise ValidationError({"answer": "Pick a place, coming, or not available."})
    place = text(data.get("place"), 80) if answer == "place" else ""
    if answer == "place":
        places = conf.get()["waiting_places"]
        match = next((p for p in places if p.lower() == place.lower()), None)
        if not match:
            raise ValidationError({"place": "Pick one of the waiting places."})
        place = match
    changed_place = (answer, place) != (v.host_answer, v.host_place)
    v.host_answer, v.host_place, v.host_note = answer, place, text(data.get("note"), 200)
    v.host_answered_at = timezone.now()
    if changed_place:
        v.sent_to_place_at, v.sent_to_place_by = None, None
    v.save()
    said = f"wait at {place}" if answer == "place" else ("coming to the gate" if answer == "coming" else "not available")
    log(actor, GateAction.HOST_ANSWER, f"{name_of(actor)}: {who(v)} {said}{f' ({v.host_note})' if v.host_note else ''}",
        visit=v)
    _tell_gate(v, f"{name_of(v.host) or name_of(actor)}: {v.name}: {said}")
    return v


def _tell_gate(v: Visit, title: str) -> None:
    from accounts.access import users_with
    from notifications.service import notify
    for u in users_with("visitors.gate"):
        if not u.is_active:
            continue
        try:
            notify(u, "visitor_host_answer", title[:200], v.host_note or "", link=f"/visitors/today?visit={v.pk}",
                   link_label="Open", want_email=False, want_whatsapp=False)
        except Exception:  # noqa: BLE001
            pass


def sent_to_place(actor, v: Visit) -> Visit:
    if v.status != VisitStatus.INSIDE or v.host_answer != "place":
        raise ValidationError({"detail": "The host has not named a waiting place."})
    v.sent_to_place_at, v.sent_to_place_by = timezone.now(), actor
    v.save(update_fields=["sent_to_place_at", "sent_to_place_by"])
    log(actor, GateAction.SENT_TO_PLACE, f"{who(v)} sent to {v.host_place}", visit=v)
    return v


def no_answer(v: Visit, now=None) -> bool:
    """The host was asked and has not answered within the company's minutes (the guard may call them)."""
    if v.status != VisitStatus.INSIDE or not v.host_notified_at or v.host_answered_at:
        return False
    mins = int(conf.get()["host_answer_minutes"] or 5)
    return (now or timezone.now()) - v.host_notified_at >= timedelta(minutes=mins)


# ---------------------------------------------------------------- the QR form's people list

PUBLIC_PEOPLE_MAX = 1000


def host_mode() -> str:
    """What the QR form asks for whom to meet: "none" (the company does not ask, V4.1), else people / departments /
    off (typed)."""
    s = conf.get()
    return s["public_host_list"] if s["whom_to_meet"] else "none"


def public_hosts(q: str = "") -> list[dict]:
    """Whom to meet on the QR form: the company's active people sorted by name, for the dropdown (V4.1; the phone
    filters as the visitor types). Name + department only (never email / phone / username). `q` narrows it."""
    from accounts.models import DepartmentOption, User
    mode = host_mode()
    if mode == "departments":
        return [{"department": name} for _, name in DepartmentOption.choices_list()]
    if mode != "people":
        return []
    qs = User.objects.filter(is_active=True)
    for w in [w for w in str(q or "").split() if w][:3]:
        qs = qs.filter(Q(first_name__icontains=w) | Q(last_name__icontains=w))
    labels = dict(DepartmentOption.choices_list())
    rows = qs.order_by("first_name", "last_name", "pk").values("pk", "first_name", "last_name", "department")
    return [{"id": u["pk"], "name": (f"{u['first_name']} {u['last_name']}".strip() or "Employee"),
             "department": labels.get(u["department"], "")} for u in rows[:PUBLIC_PEOPLE_MAX]]


def public_host(raw_id):
    """A person picked from the QR form's list (only when the company shows people)."""
    from accounts.models import User
    if raw_id in (None, "") or host_mode() != "people":

        return None
    try:
        pk = int(raw_id)
    except (TypeError, ValueError):
        return None
    return User.objects.filter(pk=pk, is_active=True).first()


def gate_can(u) -> bool:
    return can_gate(u) or can_view_all(u)
