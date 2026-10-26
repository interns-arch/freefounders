"""The company's visitor settings (Visitors -> Settings, `visitors.settings`), one JSON value per company.

Kept in the company's own CompanySetting table (key VISITORS_SETTINGS); nothing saved = the defaults below.
"""
import json

from tenancy.company_settings import company_env, set_value

KEY = "VISITORS_SETTINGS"
ID_MODES = ("off", "optional", "required")
PHOTO_MODES = ("off", "optional", "required")
WATCH_ACTIONS = ("stop", "warn")     # a watchlist match: the gate cannot let them in / is warned and may
BADGE_FORMATS = ("card", "label")    # printed badge: A6 card on any printer, or a 62 mm label printer
ID_TYPES = ["Aadhaar", "PAN", "Driving licence", "Voter ID", "Passport", "Company ID", "Other"]
DEFAULT_PURPOSES = ["Meeting", "Interview", "Delivery", "Vendor / supplier", "Maintenance / repair", "Personal", "Other"]
DEFAULT_CONSENT = (
    "I agree that my name, mobile number and photo are recorded for the security of the premises. They are kept "
    "for a limited time and then deleted."
)

DEFAULTS = {
    "purposes": DEFAULT_PURPOSES,
    # Founder (2026-10-26): the guard maintains the record, so the guard lets visitors in and the host is informed.
    "host_approval": False,
    "photo_visitor": "required",     # the guard's photo of the visitor at check-in
    "photo_vehicle": True,           # a photo of the vehicle / number plate at vehicle check-in
    "public_photo": "optional",      # selfie on the open QR link
    "id_proof": "optional",          # ID type + last 4 digits only
    "overstay_hours": 4,             # 0 = no overstay alert
    "retention_days": 180,
    "open_link": True,               # the open QR sign-in (one QR for the whole company)
    "consent_text": DEFAULT_CONSENT,
    # V2
    "send_pass": True,               # the pass link goes to the visitor by WhatsApp (and email when given)
    "watch_action": "stop",          # a mobile number on the watchlist: "stop" refuses check-in, "warn" asks the guard
    "badge_format": "card",
    "delivery_reminder_hours": 24,   # a parcel still at the gate after N hours: one reminder (0 = none)
}


def get() -> dict:
    raw = company_env(KEY, "")
    try:
        saved = json.loads(raw) if raw else {}
    except ValueError:
        saved = {}
    out = dict(DEFAULTS)
    if isinstance(saved, dict):
        out.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return out


def _bounded_int(value, lo, hi, label):
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label}: enter a whole number")
    if not lo <= n <= hi:
        raise ValueError(f"{label}: between {lo} and {hi}")
    return n


def clean(data: dict) -> tuple[dict, dict]:
    """(new settings, errors) from a PUT body: only the keys sent change."""
    cur, errors = get(), {}
    for key, value in (data or {}).items():
        try:
            if key == "purposes":
                items = value if isinstance(value, list) else str(value).split(",")
                purposes = []
                for p in items:
                    text = " ".join(str(p).split())[:60]
                    if text and text.lower() not in {x.lower() for x in purposes}:
                        purposes.append(text)
                if not purposes:
                    raise ValueError("Add at least one purpose")
                cur[key] = purposes[:30]
            elif key in ("host_approval", "photo_vehicle", "open_link", "send_pass"):
                if not isinstance(value, bool):
                    raise ValueError("On or off")
                cur[key] = value
            elif key in ("photo_visitor", "public_photo"):
                if value not in PHOTO_MODES:
                    raise ValueError(f"One of: {', '.join(PHOTO_MODES)}")
                cur[key] = value
            elif key == "id_proof":
                if value not in ID_MODES:
                    raise ValueError(f"One of: {', '.join(ID_MODES)}")
                cur[key] = value
            elif key == "watch_action":
                if value not in WATCH_ACTIONS:
                    raise ValueError(f"One of: {', '.join(WATCH_ACTIONS)}")
                cur[key] = value
            elif key == "badge_format":
                if value not in BADGE_FORMATS:
                    raise ValueError(f"One of: {', '.join(BADGE_FORMATS)}")
                cur[key] = value
            elif key == "delivery_reminder_hours":
                cur[key] = _bounded_int(value, 0, 168, "Parcel reminder")
            elif key == "overstay_hours":
                cur[key] = _bounded_int(value, 0, 72, "Overstay")
            elif key == "retention_days":
                cur[key] = _bounded_int(value, 30, 3650, "Keep records")
            elif key == "consent_text":
                text = " ".join(str(value or "").split())
                if len(text) > 600:
                    raise ValueError("At most 600 characters")
                cur[key] = text or DEFAULT_CONSENT
            else:
                raise ValueError("Not a visitor setting")
        except ValueError as exc:
            errors[key] = str(exc)
    return cur, errors


def save(values: dict) -> None:
    set_value(KEY, json.dumps({k: values[k] for k in DEFAULTS}))
