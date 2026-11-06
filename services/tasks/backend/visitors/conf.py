"""The company's visitor settings (Visitors -> Settings, `visitors.settings`), one JSON value per company.

Kept in the company's own CompanySetting table (key VISITORS_SETTINGS); nothing saved = the defaults below.
"""
import json
import re

from tenancy.company_settings import company_env, set_value

KEY = "VISITORS_SETTINGS"
ID_MODES = ("off", "optional", "required")
PHOTO_MODES = ("off", "optional", "required")
WATCH_ACTIONS = ("stop", "warn")     # a watchlist match: the gate cannot let them in / is warned and may
BADGE_FORMATS = ("card", "label")    # printed badge: A6 card on any printer, or a 62 mm label printer
ID_TYPES = ["Aadhaar", "PAN", "Driving licence", "Voter ID", "Passport", "Company ID", "Other"]
DEFAULT_PURPOSES = ["Meeting", "Interview", "Delivery", "Vendor / supplier", "Maintenance / repair", "Personal", "Other"]
HOST_LIST_MODES = ("people", "departments", "off")
DEFAULT_PLACES = ["Reception", "Meeting room 1", "Conference room", "My desk"]
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
    # V3
    "id_scan": False,                # read name + ID type + last 4 from a photo of the ID card with the company's AI
    "patrol_every_hours": 2,         # a checkpoint not scanned for N hours (in the patrol hours) alerts (0 = no alert)
    "patrol_from": 0,                # patrol hours, 0-23; from == to = all day; 20 -> 6 wraps past midnight
    "patrol_to": 0,
    "contractor_max_days": 90,
    # V4 (PLAN.md §22.11)
    # V4.1 (2026-10-29): "Ask visitors whom they are meeting" is optional. Off for a new company; companies that
    # already used Visitors before V4.1 were switched on by migration visitors/0006 (their behaviour is kept).
    "whom_to_meet": False,
    "whom_required": False,          # with whom_to_meet on: the visitor must pick someone (else "Not sure" is fine)
    "public_host_list": "people",    # whom to meet on the QR form: people (name + department) / departments / off
    "code_minutes": 120,             # the 4-digit check-in code works this long (check-out needs no code, V4.1)
    "waiting_places": DEFAULT_PLACES,
    "host_answer_minutes": 5,        # no answer from the host after N minutes: the guard sees "No answer yet"
    "host_wa_template": "",          # Meta-approved utility template for the host (empty = in-app notice only)
    "host_wa_lang": "en",
    "checkout_qr": True,             # the check-out QR (visitors check out from the phone they checked in with)
    "arrival_notice": True,          # PLAN.md §22.14: everyone with the visitor register gets an in-app notice at check-in
    # PLAN.md §22.13: these numbers get a WhatsApp at every check-in (a Meta-approved template; no free-form WhatsApp)
    "alert_wa_numbers": [],
    "alert_wa_template": "",
    "alert_wa_vehicle_template": "",  # §22.15: the same numbers at every vehicle check-in
    "alert_wa_lang": "en",
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
            elif key == "waiting_places":
                items = value if isinstance(value, list) else str(value).split(",")
                places = []
                for p in items:
                    t = " ".join(str(p).split())[:60]
                    if t and t.lower() not in {x.lower() for x in places}:
                        places.append(t)
                if not places:
                    raise ValueError("Add at least one waiting place")
                cur[key] = places[:20]
            elif key == "public_host_list":
                if value not in HOST_LIST_MODES:
                    raise ValueError(f"One of: {', '.join(HOST_LIST_MODES)}")
                cur[key] = value
            elif key == "code_minutes":
                cur[key] = _bounded_int(value, 10, 720, "Code valid for")
            elif key == "host_answer_minutes":
                cur[key] = _bounded_int(value, 1, 60, "Host answer")
            elif key in ("host_wa_template", "host_wa_lang", "alert_wa_template", "alert_wa_lang",
                         "alert_wa_vehicle_template"):
                t = str(value or "").strip()
                name = key.endswith("_template")
                if not re.fullmatch(r"[a-z0-9_]{0,60}" if name else r"[a-zA-Z_]{2,8}", t):
                    raise ValueError("Lower-case letters, digits and _ only (the name as approved by Meta)"
                                     if name else "A language code like en or en_US")
                cur[key] = t
            elif key == "alert_wa_numbers":
                items = value if isinstance(value, list) else str(value).split(",")
                numbers = []
                for item in items:
                    digits = re.sub(r"\D", "", str(item))
                    if not digits:
                        continue
                    if not 10 <= len(digits) <= 15:
                        raise ValueError(f"{item} is not a valid mobile number")
                    if digits not in numbers:
                        numbers.append(digits)
                if len(numbers) > 10:
                    raise ValueError("At most 10 numbers")
                cur[key] = numbers
            elif key in ("host_approval", "photo_vehicle", "open_link", "send_pass", "id_scan", "checkout_qr", "arrival_notice",
                         "whom_to_meet", "whom_required"):
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
            elif key == "patrol_every_hours":
                cur[key] = _bounded_int(value, 0, 24, "Patrol alert")
            elif key in ("patrol_from", "patrol_to"):
                cur[key] = _bounded_int(value, 0, 23, "Patrol hours")
            elif key == "contractor_max_days":
                cur[key] = _bounded_int(value, 1, 366, "Contractor pass days")
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
