"""Gate logic (PLAN.md §22): check visitors and vehicles in and out, the host's answer, audit rows, alerts, clean-up."""
import base64
import binascii
import re
import secrets
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.permissions import granted

from . import conf
from .models import GateAction, GateLink, GateLog, VehicleEntry, Visit, Visitor, VisitSource, VisitStatus

GATE_PHOTO_MAX = 1536 * 1024
PUBLIC_PHOTO_MAX = 600 * 1024
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ACTIVE = (VisitStatus.WAITING, VisitStatus.WAITING_HOST, VisitStatus.INSIDE)


# ---------------------------------------------------------------- who may do what

def can_gate(u) -> bool:
    return granted(u, "visitors.gate")


def can_view_all(u) -> bool:
    return granted(u, "visitors.view_all")


def can_settings(u) -> bool:
    return granted(u, "visitors.settings")


def can_invite(u) -> bool:
    return granted(u, "visitors.invite")


def visible_visits(u):
    """view_all: everything; the gate: today's and everyone still at the gate or inside; a host: their own."""
    if can_view_all(u):
        return Visit.objects.all()
    q = Q(pk__in=[])
    if can_gate(u):
        start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        q |= Q(created_at__gte=start) | Q(status__in=ACTIVE)
    if can_invite(u):
        q |= Q(host=u)
    return Visit.objects.filter(q)


def visible_vehicles(u):
    if can_view_all(u):
        return VehicleEntry.objects.all()
    if can_gate(u):
        start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        return VehicleEntry.objects.filter(Q(in_at__gte=start) | Q(out_at__isnull=True))
    return VehicleEntry.objects.none()


# ---------------------------------------------------------------- cleaning input

def name_of(u) -> str:
    return (u.get_full_name() or u.username) if u else ""


def clean_mobile(value, required=False) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if not digits:
        if required:
            raise ValidationError({"mobile": "Enter the mobile number."})
        return ""
    if not 8 <= len(digits) <= 15:
        raise ValidationError({"mobile": "Enter a valid mobile number."})
    return digits


def clean_vehicle_no(value, required=False, field="vehicle_no") -> str:
    text = re.sub(r"[\s\-.]", "", str(value or "")).upper()
    if not text:
        if required:
            raise ValidationError({field: "Enter the vehicle number."})
        return ""
    if not re.fullmatch(r"[A-Z0-9]{4,12}", text):
        raise ValidationError({field: "Enter a vehicle number like MH12AB1234."})
    return text


def clean_id(id_type, last4, mode) -> tuple[str, str]:
    """Only the ID type and the last 4 characters are ever kept (never a full ID number, PLAN.md §22.6)."""
    id_type = " ".join(str(id_type or "").split())[:30]
    last4 = str(last4 or "").strip().replace(" ", "")
    if mode == "off":
        return "", ""
    if last4 and not re.fullmatch(r"[A-Za-z0-9]{4}", last4):
        raise ValidationError({"id_last4": "Enter only the last 4 digits of the ID, never the full number."})
    if mode == "required" and not (id_type and last4):
        raise ValidationError({"id_last4": "Enter the ID type and its last 4 digits."})
    return (id_type if last4 else ""), last4.upper()


def text(value, n) -> str:
    return " ".join(str(value or "").split())[:n]


def decode_photo(data, max_bytes=GATE_PHOTO_MAX, field="photo") -> bytes | None:
    if not data:
        return None
    raw_text = str(data)
    if raw_text.startswith("data:"):
        raw_text = raw_text.split(",", 1)[-1]
    try:
        raw = base64.b64decode(raw_text, validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError({field: "The photo could not be read. Please take it again."})
    if len(raw) > max_bytes:
        raise ValidationError({field: "The photo is too large."})
    if not (raw[:3] == b"\xff\xd8\xff" or raw[:8] == b"\x89PNG\r\n\x1a\n" or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")):
        raise ValidationError({field: "The photo must be a JPEG, PNG or WebP image."})
    return raw


def store_photo(filefield, raw: bytes, preset=(720, 65)):
    from config.images import compress_image

    out, ext = compress_image(raw, *preset, always=True)
    if not ext and out[:3] != b"\xff\xd8\xff":
        raise ValidationError({"photo": "The photo could not be read. Please take it again."})
    filefield.save("photo.jpg", ContentFile(out), save=False)


def new_short_code() -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not Visit.objects.filter(short_code=code, status__in=ACTIVE).exists():
            return code
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


# ---------------------------------------------------------------- audit + notices

def log(actor, action, summary="", visit=None, vehicle=None, changes=None):
    return GateLog.objects.create(actor=actor, action=action, summary=summary[:300], visit=visit, vehicle=vehicle,
                                  changes=changes or {})


def _notify(user, type_, title, body, link):
    if not user or not user.is_active:
        return
    from notifications.service import notify
    try:
        notify(user, type_, title[:200], body, link=link, want_email=False, link_label="Open")
    except Exception:  # noqa: BLE001 -- a failed notice never blocks the gate
        pass


def visit_link(v) -> str:
    # Tasks-relative like every Tasks link: /tasks/visitors/... opens /visitors/... in the web app.
    return f"/visitors/my?visit={v.pk}"


def who(v) -> str:
    return f"{v.name}{f' ({v.company})' if v.company else ''}"


# ---------------------------------------------------------------- visitors

def _visitor_for(mobile, name, company):
    found = Visitor.objects.filter(mobile=mobile, anonymised=False).first() if mobile else None
    if not found:
        found = Visitor.objects.create(name=name, mobile=mobile, company=company)
    return found


def apply_fields(v: Visit, data: dict, s: dict, *, require_photo: bool):
    """Fields the guard fills (check-in or accepting a QR sign-in)."""
    from accounts.models import User
    from hr.models import OfficeLocation

    if "mobile" in data or not v.mobile:
        v.mobile = clean_mobile(data.get("mobile", v.mobile), required=True)
    v.name = text(data.get("name", v.name), 80)
    if not v.name:
        raise ValidationError({"name": "Enter the visitor's name."})
    for f, n in (("company", 120), ("purpose", 60), ("items", 300), ("notes", 500), ("host_label", 80)):
        if f in data:
            setattr(v, f, text(data.get(f), n))
    if "host" in data:
        hid = data.get("host")
        v.host = User.objects.filter(pk=hid, is_active=True).first() if hid not in (None, "") else None
        if hid not in (None, "") and not v.host:
            raise ValidationError({"host": "Pick a person from the list."})
    if "people" in data:
        try:
            v.people = max(1, min(50, int(data.get("people") or 1)))
        except (TypeError, ValueError):
            raise ValidationError({"people": "Enter a number."})
    if "location" in data:
        lid = data.get("location")
        v.location = OfficeLocation.objects.filter(pk=lid).first() if lid not in (None, "") else None
    if "vehicle_no" in data:
        v.vehicle_no = clean_vehicle_no(data.get("vehicle_no"))
    if "vehicle" in data:
        v.vehicle = VehicleEntry.objects.filter(pk=data.get("vehicle")).first() if data.get("vehicle") else None
    if "id_last4" in data or "id_type" in data:
        v.id_type, v.id_last4 = clean_id(data.get("id_type", v.id_type), data.get("id_last4", v.id_last4), s["id_proof"])
    elif s["id_proof"] == "required" and not v.id_last4:
        raise ValidationError({"id_last4": "Enter the ID type and its last 4 digits."})
    raw = decode_photo(data.get("photo"))
    if raw:
        store_photo(v.photo, raw)
    elif data.get("reuse_photo") and v.visitor_id and v.visitor.photo and not v.photo:
        with v.visitor.photo.open("rb") as fh:
            v.photo.save("photo.jpg", ContentFile(fh.read()), save=False)
    if require_photo and s["photo_visitor"] == "required" and not v.photo:
        raise ValidationError({"photo": "Take the visitor's photo."})


def _admit(v: Visit, actor, s, action):
    """Inside now (host informed), or waiting for the host when the company asks hosts to approve."""
    now = timezone.now()
    v.check_in_by = actor
    if not v.pass_no:
        v.save()
        v.pass_no = f"V{v.pk:05d}"
    if s["host_approval"] and v.host_id:
        v.status = VisitStatus.WAITING_HOST
        v.save()
        log(actor, GateAction.VISIT_WAITING_HOST, f"{who(v)} waiting for {name_of(v.host)}", visit=v)
        _notify(v.host, "visitor_approval", f"{v.name} is at the gate to meet you",
                f"{who(v)} · {v.purpose or 'visit'}. Allow or deny in Visitors.", visit_link(v))
    else:
        v.status, v.check_in_at = VisitStatus.INSIDE, now
        v.save()
        log(actor, action, f"{who(v)} in{f' to meet {name_of(v.host)}' if v.host else ''}", visit=v)
        if v.host:
            _notify(v.host, "visitor_arrived", f"{v.name} is at the gate for you",
                    f"{who(v)} · {v.purpose or 'visit'} · pass {v.pass_no}", visit_link(v))
    vis = v.visitor
    if not vis.anonymised:
        vis.name, vis.company = v.name, v.company or vis.company
        if v.mobile:
            vis.mobile = v.mobile
        if v.photo and v.photo.name != (vis.photo.name if vis.photo else ""):
            try:
                with v.photo.open("rb") as fh:
                    content = fh.read()
                vis.photo.save("photo.jpg", ContentFile(content), save=False)
            except Exception:  # noqa: BLE001
                pass
        if v.id_last4:
            vis.id_type, vis.id_last4 = v.id_type, v.id_last4
        vis.last_visit_at, vis.visits = now, vis.visits + 1
        vis.save()
    return v


def check_in(actor, data: dict) -> Visit:
    s = conf.get()
    mobile = clean_mobile(data.get("mobile"), required=True)
    name = text(data.get("name"), 80)
    if not name:
        raise ValidationError({"name": "Enter the visitor's name."})
    visitor = _visitor_for(mobile, name, text(data.get("company"), 120))
    v = Visit(visitor=visitor, source=VisitSource.GATE, consent_at=timezone.now())
    apply_fields(v, {**data, "mobile": mobile}, s, require_photo=True)
    return _admit(v, actor, s, GateAction.VISIT_IN)


def accept(actor, v: Visit, data: dict) -> Visit:
    if v.status != VisitStatus.WAITING:
        raise ValidationError({"detail": "This visitor is not waiting at the gate."})
    s = conf.get()
    apply_fields(v, data, s, require_photo=True)
    return _admit(v, actor, s, GateAction.OPEN_ACCEPT)


def reject(actor, v: Visit, reason="") -> Visit:
    if v.status not in (VisitStatus.WAITING, VisitStatus.WAITING_HOST):
        raise ValidationError({"detail": "Only a visitor waiting at the gate can be turned away."})
    v.status = VisitStatus.REJECTED
    v.notes = text(f"{v.notes} {reason}".strip(), 500)
    v.save()
    log(actor, GateAction.OPEN_REJECT, f"{who(v)} turned away{f': {reason}' if reason else ''}", visit=v)
    return v


def decide(actor, v: Visit, allow: bool) -> Visit:
    if v.status != VisitStatus.WAITING_HOST:
        raise ValidationError({"detail": "This visitor is not waiting for an answer."})
    if v.host_id != actor.pk and not can_view_all(actor):
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("Only the person they came to meet can answer.")
    now = timezone.now()
    v.host_decision_at, v.host_decision_by = now, actor
    if allow:
        v.status, v.check_in_at = VisitStatus.INSIDE, now
    else:
        v.status = VisitStatus.DENIED
    v.save()
    log(actor, GateAction.HOST_ALLOW if allow else GateAction.HOST_DENY, f"{name_of(actor)} {'allowed' if allow else 'denied'} {who(v)}", visit=v)
    return v


def check_out(actor, v: Visit) -> Visit:
    if v.status != VisitStatus.INSIDE:
        raise ValidationError({"detail": "This visitor is not inside."})
    v.status, v.check_out_at, v.check_out_by = VisitStatus.OUT, timezone.now(), actor
    v.save()
    log(actor, GateAction.VISIT_OUT, f"{who(v)} out after {v.minutes_inside()} min", visit=v)
    return v


def find_pass(code: str):
    raw = str(code or "").strip()
    if raw.upper().startswith("KPV:"):
        return Visit.objects.filter(pass_token=raw[4:]).first()
    if "/" in raw:  # a scanned link: last part
        raw = raw.rstrip("/").rsplit("/", 1)[-1]
    up = raw.upper()
    return (Visit.objects.filter(pass_token=raw).first() or Visit.objects.filter(pass_no=up).order_by("-pk").first()
            or Visit.objects.filter(short_code=up, status__in=ACTIVE).order_by("-pk").first())


EDITABLE = ("name", "company", "purpose", "host", "host_label", "people", "items", "notes", "vehicle_no", "location",
            "id_type", "id_last4")


def edit_visit(actor, v: Visit, data: dict) -> Visit:
    def snap():
        return {"name": v.name, "company": v.company, "purpose": v.purpose, "host": name_of(v.host),
                "host_label": v.host_label, "people": v.people, "items": v.items, "notes": v.notes,
                "vehicle_no": v.vehicle_no, "location": v.location.name if v.location else "",
                "id_type": v.id_type, "id_last4": v.id_last4}
    before = snap()
    apply_fields(v, {k: data[k] for k in EDITABLE if k in data} | ({"photo": data["photo"]} if data.get("photo") else {}),
                 conf.get(), require_photo=False)
    v.save()
    after = snap()
    changes = {k: [before[k], after[k]] for k in before if before[k] != after[k]}
    if data.get("photo"):
        changes["photo"] = ["", "new photo"]
    if changes:
        log(actor, GateAction.VISIT_EDIT, f"{who(v)}: {', '.join(changes)} changed", visit=v, changes=changes)
    return v


# ---------------------------------------------------------------- vehicles

VEHICLE_FIELDS = (("driver_name", 80), ("purpose", 120), ("company", 120), ("items", 300), ("parking_slot", 30),
                  ("notes", 500))


def vehicle_in(actor, data: dict) -> VehicleEntry:
    from hr.models import OfficeLocation

    s = conf.get()
    e = VehicleEntry(in_by=actor, number=clean_vehicle_no(data.get("number"), required=True, field="number"))
    e.type = data.get("type") if data.get("type") in dict(VehicleEntry._meta.get_field("type").choices) else "car"
    for f, n in VEHICLE_FIELDS:
        setattr(e, f, text(data.get(f), n))
    e.driver_mobile = clean_mobile(data.get("driver_mobile"))
    if data.get("location"):
        e.location = OfficeLocation.objects.filter(pk=data["location"]).first()
    raw = decode_photo(data.get("photo"))
    if raw:
        store_photo(e.photo_in, raw, (1280, 70))
    elif s["photo_vehicle"]:
        raise ValidationError({"photo": "Take a photo of the vehicle and its number plate."})
    if VehicleEntry.objects.filter(number=e.number, out_at__isnull=True).exists():
        raise ValidationError({"number": f"{e.number} is already inside. Check it out first."})
    e.save()
    visit = Visit.objects.filter(pk=data.get("visit")).first() if data.get("visit") else None
    if visit:
        visit.vehicle, visit.vehicle_no = e, e.number
        visit.save(update_fields=["vehicle", "vehicle_no"])
    log(actor, GateAction.VEHICLE_IN, f"{e.number} ({e.get_type_display()}) in{f', driver {e.driver_name}' if e.driver_name else ''}", vehicle=e)
    return e


def vehicle_out(actor, e: VehicleEntry, data: dict) -> VehicleEntry:
    if e.out_at:
        raise ValidationError({"detail": "This vehicle is already out."})
    raw = decode_photo(data.get("photo"))
    if raw:
        store_photo(e.photo_out, raw, (1280, 70))
    if data.get("notes"):
        e.notes = text(f"{e.notes} {data['notes']}", 500)
    e.out_at, e.out_by = timezone.now(), actor
    e.save()
    log(actor, GateAction.VEHICLE_OUT, f"{e.number} out after {e.minutes_inside()} min", vehicle=e)
    return e


def edit_vehicle(actor, e: VehicleEntry, data: dict) -> VehicleEntry:
    before = {f: getattr(e, f) for f, _ in VEHICLE_FIELDS} | {"number": e.number, "driver_mobile": e.driver_mobile}
    for f, n in VEHICLE_FIELDS:
        if f in data:
            setattr(e, f, text(data[f], n))
    if "number" in data:
        e.number = clean_vehicle_no(data["number"], required=True, field="number")
    if "driver_mobile" in data:
        e.driver_mobile = clean_mobile(data["driver_mobile"])
    e.save()
    after = {f: getattr(e, f) for f in before}
    changes = {k: [before[k], after[k]] for k in before if before[k] != after[k]}
    if changes:
        log(actor, GateAction.VEHICLE_EDIT, f"{e.number}: {', '.join(changes)} changed", vehicle=e, changes=changes)
    return e


# ---------------------------------------------------------------- the open QR link

def new_token_value() -> str:
    from .models import new_token
    return new_token()


def the_link() -> GateLink:
    link = GateLink.objects.order_by("id").first()
    return link or GateLink.objects.create()


def company_code() -> str:
    from tenancy import schemas
    cur = schemas.current()
    return cur[3:] if cur else "main"


def public_submit(link: GateLink, data: dict, ip_hash: str) -> Visit:
    s = conf.get()
    name = text(data.get("name"), 80)
    errors = {}
    if not name:
        errors["name"] = "Enter your name."
    try:
        mobile = clean_mobile(data.get("mobile"), required=True)
    except ValidationError as exc:
        errors.update(exc.detail)
        mobile = ""
    if data.get("consent") is not True:
        errors["consent"] = "Please agree to continue."
    raw = None
    if s["public_photo"] != "off":
        try:
            raw = decode_photo(data.get("photo"), PUBLIC_PHOTO_MAX)
        except ValidationError as exc:
            errors.update(exc.detail)
        if s["public_photo"] == "required" and not raw and "photo" not in errors:
            errors["photo"] = "Take a selfie to continue."
    try:
        vehicle_no = clean_vehicle_no(data.get("vehicle_no"))
    except ValidationError as exc:
        errors.update(exc.detail)
        vehicle_no = ""
    if errors:
        raise ValidationError(errors)
    try:
        people = max(1, min(50, int(data.get("people") or 1)))
    except (TypeError, ValueError):
        people = 1
    host_text = text(data.get("host_name"), 80)
    host = _match_host(host_text)
    visitor = _visitor_for(mobile, name, text(data.get("company"), 120))
    v = Visit(visitor=visitor, name=name, mobile=mobile, company=text(data.get("company"), 120),
              purpose=text(data.get("purpose"), 60), people=people, host=host, host_label="" if host else host_text,
              vehicle_no=vehicle_no, status=VisitStatus.WAITING, source=VisitSource.OPEN_LINK,
              short_code=new_short_code(), consent_at=timezone.now(), ip_hash=ip_hash, gate_link=link)
    if raw:
        store_photo(v.photo, raw)
    v.save()
    return v


def _match_host(typed: str):
    """The person the visitor typed, only when exactly one active person matches (the guard picks otherwise)."""
    from django.db.models import Value
    from django.db.models.functions import Concat

    from accounts.models import User
    if len(typed) < 3:
        return None
    rows = list(User.objects.filter(is_active=True).annotate(full=Concat("first_name", Value(" "), "last_name"))
                .filter(Q(full__iexact=typed) | Q(username__iexact=typed) | Q(first_name__iexact=typed))[:2])
    return rows[0] if len(rows) == 1 else None


# ---------------------------------------------------------------- worker jobs

def overstay_alerts(now=None) -> int:
    from accounts.access import users_with

    s = conf.get()
    hours = int(s["overstay_hours"] or 0)
    if hours <= 0:
        return 0
    now = now or timezone.now()
    late = list(Visit.objects.filter(status=VisitStatus.INSIDE, overstay_alerted_at__isnull=True,
                                     check_in_at__lte=now - timedelta(hours=hours)).select_related("host"))
    if not late:
        return 0
    guards = list(users_with("visitors.gate"))
    for v in late:
        title = f"{v.name} is still inside after {hours} h"
        body = f"{who(v)} came in at {timezone.localtime(v.check_in_at):%H:%M} (pass {v.pass_no})."
        for u in {*guards, *([v.host] if v.host else [])}:
            _notify(u, "visitor_overstay", title, body, "/visitors/today")
        v.overstay_alerted_at = now
        v.save(update_fields=["overstay_alerted_at"])
    return len(late)


def retention_cleanup(now=None) -> int:
    """Past the company's retention days: photos and ID digits deleted, names and numbers anonymised (DPDP)."""
    s = conf.get()
    cutoff = (now or timezone.now()) - timedelta(days=int(s["retention_days"]))
    n = 0
    for v in Visit.objects.filter(anonymised=False, created_at__lt=cutoff):
        if v.photo:
            v.photo.delete(save=False)
        v.name, v.mobile, v.company, v.id_type, v.id_last4 = "Visitor (removed)", "", "", "", ""
        v.items, v.notes, v.ip_hash, v.vehicle_no, v.anonymised = "", "", "", "", True
        v.save()
        n += 1
    for vis in Visitor.objects.filter(anonymised=False, last_visit_at__lt=cutoff):
        if vis.photo:
            vis.photo.delete(save=False)
        vis.name, vis.mobile, vis.company, vis.id_type, vis.id_last4, vis.anonymised = "Visitor (removed)", "", "", "", "", True
        vis.save()
    for e in VehicleEntry.objects.filter(anonymised=False, in_at__lt=cutoff):
        for f in (e.photo_in, e.photo_out):
            if f:
                f.delete(save=False)
        e.driver_name, e.driver_mobile, e.anonymised = "", "", True
        e.save()
    GateLog.objects.filter(at__lt=cutoff).exclude(summary="").update(summary="", changes={})
    return n


def run_jobs() -> None:
    from tenancy.profile import module_on
    if not module_on("visitors"):
        return
    overstay_alerts()
    retention_cleanup()
