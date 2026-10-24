"""Settings → Integrations (PLAN.md §19.40): the company's own WhatsApp, Gmail and AI values, which were set with
`manage.py company_setting` before. Owner / Admin only.

GET  /api/integrations/  → groups of fields; a secret is never returned, only whether it is set and its last 4 characters
PUT  /api/integrations/  {"values": {"NAME": "value" | null}}  → "" or null removes the company's value (the server's
                          environment value, if any, applies again). Every change is recorded (who, when; never the value).
"""
import os

from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.permissions import IsAdmin

from .company_settings import SECRET_KEYS, company_env, remove_value, set_value
from .models import CompanySetting, SettingChange

BOOL, TEXT, SECRET = "bool", "text", "secret"

GROUPS = [
    {"key": "whatsapp", "label": "WhatsApp", "description": "Messages and reminders through the WhatsApp Cloud API (Meta).", "fields": [
        ("WHATSAPP_ENABLED", "Send WhatsApp messages", BOOL),
        ("WHATSAPP_PHONE_NUMBER_ID", "Phone number ID", TEXT),
        ("WHATSAPP_ACCESS_TOKEN", "Access token", SECRET),
        ("WHATSAPP_APP_SECRET", "App secret (checks incoming messages)", SECRET),
        ("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "Webhook verify token", SECRET),
        ("WHATSAPP_TEMPLATE_NAME", "Message template name", TEXT),
        ("WHATSAPP_TEMPLATE_LANG", "Template language (e.g. en)", TEXT),
    ]},
    {"key": "gmail", "label": "Gmail", "description": "Email notifications sent from your Gmail, and leads read from the inbox.", "fields": [
        ("GMAIL_ENABLED", "Send email through Gmail", BOOL),
        ("GMAIL_SENDER", "Sender address", TEXT),
        ("GMAIL_CLIENT_ID", "OAuth client ID", TEXT),
        ("GMAIL_CLIENT_SECRET", "OAuth client secret", SECRET),
        ("GMAIL_REFRESH_TOKEN", "Refresh token", SECRET),
        ("GMAIL_POLL_ENABLED", "Read new leads from the inbox", BOOL),
        ("GMAIL_POLL_QUERY", "Inbox search for leads", TEXT),
    ]},
    {"key": "ai", "label": "AI", "description": "Task drafts, voice notes and lead reading with your own AI key.", "fields": [
        ("AI_ENABLED", "Use AI", BOOL),
        ("AI_PROVIDER", "Provider (anthropic, openai, nvidia…)", TEXT),
        ("AI_MODEL", "Model", TEXT),
        ("AI_BASE_URL", "API address (only for a custom provider)", TEXT),
        ("AI_API_KEY", "API key", SECRET),
        ("ANTHROPIC_API_KEY", "Anthropic API key (mistake analysis)", SECRET),
        ("NVIDIA_API_KEY", "NVIDIA API key", SECRET),
    ]},
]
FIELDS = {name: kind for g in GROUPS for name, _label, kind in g["fields"]}
assert all((kind == SECRET) == (name in SECRET_KEYS) for name, kind in FIELDS.items())


def mask(value: str) -> str:
    """"••••abcd": the last 4 characters of a long secret, nothing of a short one."""
    return "••••" + value[-4:] if len(value) >= 12 else "••••"


def _payload():
    saved = {row.key: row for row in CompanySetting.objects.filter(key__in=FIELDS)}
    last = {}
    for change in SettingChange.objects.filter(key__in=FIELDS).order_by("-id")[:500]:
        last.setdefault(change.key, change)
    groups = []
    for g in GROUPS:
        fields = []
        for name, label, kind in g["fields"]:
            row = saved.get(name)
            own = bool(row and row.value)
            server = bool(os.environ.get(name, "").strip())
            item = {"key": name, "label": label, "kind": kind,
                    "source": "company" if own else ("server" if server else None)}
            current = company_env(name, "") if own else ""
            if kind == SECRET:
                item["set"] = own or server
                item["masked"] = mask(current) if own else ("Set on the server" if server else "")
            else:
                item["value"] = current
            change = last.get(name)
            item["changed"] = ({"by": change.actor_name, "at": change.at.isoformat(), "action": change.action}
                               if change else None)
            fields.append(item)
        groups.append({"key": g["key"], "label": g["label"], "description": g["description"], "fields": fields})
    return {"groups": groups}


@api_view(["GET", "PUT"])
@permission_classes([IsAdmin])
def integrations(request):
    if request.method == "GET":
        return Response(_payload())
    values = request.data.get("values") if isinstance(request.data, dict) else None
    if not isinstance(values, dict) or not values:
        raise ValidationError({"values": "Send the settings to change."})
    unknown = sorted(k for k in values if k not in FIELDS)
    if unknown:
        raise ValidationError({"values": f"Not a setting here: {', '.join(unknown)}"})
    clean = {}
    for name, raw in values.items():
        value = "" if raw is None else str(raw).strip()
        if len(value) > 4000:
            raise ValidationError({name: "Too long."})
        if FIELDS[name] == BOOL and value and value.lower() not in ("true", "false"):
            raise ValidationError({name: "Use true or false."})
        clean[name] = value.lower() if FIELDS[name] == BOOL else value
    actor = request.user
    who = (actor.get_full_name() or actor.username)[:150]
    for name, value in clean.items():
        if value:
            set_value(name, value)
        else:
            remove_value(name)
        SettingChange.objects.create(key=name, action="set" if value else "removed", actor_id=actor.pk, actor_name=who)
    return Response(_payload())
