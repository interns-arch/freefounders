"""Visitors V3 (PLAN.md §22.10): contractor passes, material gate passes (linked to Assets), patrol rounds, incidents,
reading an ID card with the company's AI, and the reports. Built on the V1 / V2 helpers in services.py."""
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import conf
from .models import (Checkpoint, ContractorEntry, ContractorPass, GateAction, Incident, IncidentPhoto, MaterialItem,
                     MaterialPass, MaterialStatus, PatrolScan)
from .services import (_notify, can_gate, can_invite, can_settings, can_view_all, clean_id, clean_mobile,
                       clean_vehicle_no, company_code, day_start, decode_photo, in_background, is_hard_stop, log,
                       name_of, site_url, store_photo, text, watch_match)


def _user(pk, field, required=False):
    from accounts.models import User
    if pk in (None, ""):
        if required:
            raise ValidationError({field: "Pick a person from the list."})
        return None
    u = User.objects.filter(pk=pk, is_active=True).first()
    if not u:
        raise ValidationError({field: "Pick a person from the list."})
    return u


def _location(pk):
    from hr.models import OfficeLocation
    return OfficeLocation.objects.filter(pk=pk).first() if pk not in (None, "") else None


def _day(raw, field):
    try:
        return datetime.strptime(str(raw or ""), "%Y-%m-%d").date()
    except ValueError:
        raise ValidationError({field: "Pick a date."})


def heads():
    """The security head(s): everyone with the full register (visitors.view_all)."""
    from accounts.access import users_with
    return list(users_with("visitors.view_all"))


# ================================================================ contractors

def contractor_state(c: ContractorPass, today=None) -> str:
    today = today or timezone.localdate()
    if c.revoked_at:
        return "revoked"
    if today < c.valid_from:
        return "upcoming"
    if today > c.valid_to:
        return "expired"
    return "valid"


def open_entry(c: ContractorPass):
    return c.entries.filter(out_at__isnull=True).first()


def can_manage_contractor(u, c: ContractorPass) -> bool:
    return can_view_all(u) or can_gate(u) or c.supervisor_id == u.pk or c.created_by_id == u.pk


def contractor_path(c: ContractorPass) -> str:
    return f"/v/{company_code()}/p/{c.pass_token}"


def send_contractor_pass(c: ContractorPass, actor=None):
    from notifications.channels import whatsapp
    from .services import company_name
    if not c.mobile:
        return
    body = (f"{company_name()}: your contractor pass {c.pass_no}, valid {c.valid_from:%d %b} to {c.valid_to:%d %b}: "
            f"{site_url(contractor_path(c))}\nShow the QR code at the gate each time you come in and go out.")
    mobile, pk = c.mobile, c.pk

    def go():
        r = whatsapp.send_text(mobile, body)
        ContractorPass.objects.filter(pk=pk).update(pass_sent_at=timezone.now(), pass_channels=[
            {"channel": "whatsapp", "status": r.get("status"), "detail": (r.get("detail") or "")[:120]}])
    in_background(go)
    if actor:
        log(actor, GateAction.PASS_SENT, f"Contractor pass {c.pass_no} sent to {c.name}", contractor=c)


def public_contractor_pass(c: ContractorPass) -> dict:
    """The contractor's own pass page (no sign-in): only this pass."""
    from tenancy.profile import brand

    from .services import company_name
    b = brand()
    state = contractor_state(c)
    sup = c.supervisor
    entry = open_entry(c)
    return {
        "kind": "contractor", "company": company_name(), "logo_url": b["logo_url"] if b else None, "name": c.name,
        "visitor_company": c.company, "pass_no": c.pass_no, "qr": f"KPC:{c.pass_token}",
        "status": {"valid": "inside" if entry else "expected", "upcoming": "expected"}.get(state, "no_show" if state == "expired" else "cancelled"),
        "status_display": {"valid": "Inside" if entry else "Valid today", "upcoming": "Not started yet", "expired": "Expired",
                           "revoked": "Revoked"}[state],
        "host": (f"{sup.first_name} {sup.last_name[:1]}".strip() or name_of(sup)) if sup else "", "purpose": c.work,
        "people": c.people, "location": c.location.name if c.location else "",
        "window": f"{c.valid_from:%d %b} – {c.valid_to:%d %b %Y}", "check_in_at": None, "check_out_at": None,
        "permit_no": c.permit_no, "safety_note": c.safety_note,
    }


def create_contractor(actor, data: dict) -> ContractorPass:
    from crm.models import Task
    s = conf.get()
    if not (can_invite(actor) or can_gate(actor) or can_view_all(actor)):
        raise PermissionDenied("Your role does not include this.")
    errors = {}
    name, work = text(data.get("name"), 80), text(data.get("work"), 200)
    if not name:
        errors["name"] = "Enter the contractor's name."
    if not work:
        errors["work"] = "What work are they here for?"
    try:
        mobile = clean_mobile(data.get("mobile"), required=True)
    except ValidationError as exc:
        errors.update(exc.detail)
        mobile = ""
    start = _day(data.get("valid_from"), "valid_from")
    end = _day(data.get("valid_to") or data.get("valid_from"), "valid_to")
    today = timezone.localdate()
    if start < today:
        errors["valid_from"] = "The first day has passed."
    if end < start:
        errors["valid_to"] = "The last day is before the first."
    elif (end - start).days + 1 > s["contractor_max_days"]:
        errors["valid_to"] = f"At most {s['contractor_max_days']} days on one pass."
    if is_hard_stop(watch_match(mobile, name), mobile, s):
        errors["mobile"] = "This person cannot be given a pass. Please talk to your security head."
    if errors:
        raise ValidationError(errors)
    supervisor = actor
    if data.get("supervisor") not in (None, "", actor.pk):
        if not (can_gate(actor) or can_view_all(actor)):
            raise ValidationError({"supervisor": "You can only make passes you supervise."})
        supervisor = _user(data.get("supervisor"), "supervisor")
    task = None
    if data.get("task"):
        task = Task.objects.filter(pk=data["task"]).first()
        if not task or not (can_view_all(actor) or actor.pk in (task.assigned_to_id, task.created_by_id)):
            raise ValidationError({"task": "Pick one of your tasks."})
    id_type, last4 = clean_id(data.get("id_type"), data.get("id_last4"), s["id_proof"] if s["id_proof"] != "required" else "optional")
    try:
        people = max(1, min(200, int(data.get("people") or 1)))
    except (TypeError, ValueError):
        raise ValidationError({"people": "Enter a number."})
    c = ContractorPass(name=name, mobile=mobile, company=text(data.get("company"), 120), people=people, work=work,
                       permit_no=text(data.get("permit_no"), 40), safety_note=text(data.get("safety_note"), 300),
                       supervisor=supervisor, location=_location(data.get("location")), task=task, valid_from=start,
                       valid_to=end, id_type=id_type, id_last4=last4, created_by=actor)
    raw = decode_photo(data.get("photo"))
    if raw:
        store_photo(c.photo, raw)
    c.save()
    c.pass_no = f"C{c.pk:05d}"
    c.save(update_fields=["pass_no"])
    log(actor, GateAction.CONTRACTOR_PASS, f"{c.name}{f' ({c.company})' if c.company else ''}: {c.work}, "
        f"{c.valid_from:%d %b}–{c.valid_to:%d %b}", contractor=c)
    if s["send_pass"] and data.get("send", True) is not False:
        send_contractor_pass(c)
    return c


def contractor_in(actor, c: ContractorPass, data: dict) -> ContractorEntry:
    s = conf.get()
    state = contractor_state(c)
    if state != "valid":
        raise ValidationError({"detail": {"revoked": "This pass was revoked.", "upcoming": f"This pass starts on {c.valid_from:%d %b}.",
                                          "expired": f"This pass ended on {c.valid_to:%d %b}."}[state]})
    if open_entry(c):
        raise ValidationError({"detail": f"{c.name} is already inside."})
    hit = watch_match(c.mobile, c.name)
    if hit and is_hard_stop(hit, c.mobile, s) and not can_settings(actor):
        raise ValidationError({"watchlist": f"{c.name} is on the watchlist ({hit.reason}). Do not let them in."})
    if hit and data.get("watch_ok") is not True:
        raise ValidationError({"watchlist_warn": f"{c.name} matches the watchlist: {hit.reason}. Let them in anyway?"})
    raw = decode_photo(data.get("photo"))
    if raw:
        store_photo(c.photo, raw)
        c.save(update_fields=["photo"])
    if not c.photo and s["photo_visitor"] == "required":
        raise ValidationError({"photo": "Take the contractor's photo (once; it stays on the pass)."})
    try:
        people = max(1, min(200, int(data.get("people") or c.people)))
    except (TypeError, ValueError):
        people = c.people
    first_today = not c.entries.filter(in_at__gte=day_start()).exists()
    e = ContractorEntry.objects.create(contractor=c, in_by=actor, people=people,
                                       location=_location(data.get("location")) or c.location)
    log(actor, GateAction.CONTRACTOR_IN, f"{c.name} ({c.pass_no}) in{f', {people} people' if people > 1 else ''}",
        contractor=c)
    if hit:
        log(actor, GateAction.WATCH_ALERT, f"{c.name} let in although on the watchlist: {hit.reason}", contractor=c)
    if first_today and c.supervisor and c.supervisor != actor:
        _notify(c.supervisor, "visitor_contractor", f"{c.name} is in for {c.work[:60]}",
                f"Contractor pass {c.pass_no}{f' · {people} people' if people > 1 else ''}", "/visitors/contractors")
    return e


def contractor_out(actor, c: ContractorPass) -> ContractorEntry:
    e = open_entry(c)
    if not e:
        raise ValidationError({"detail": f"{c.name} is not inside."})
    e.out_at, e.out_by = timezone.now(), actor
    e.save()
    log(actor, GateAction.CONTRACTOR_OUT, f"{c.name} ({c.pass_no}) out after {e.minutes_inside()} min", contractor=c)
    return e


def revoke_contractor(actor, c: ContractorPass, reason="") -> ContractorPass:
    if c.revoked_at:
        raise ValidationError({"detail": "Already revoked."})
    c.revoked_at, c.revoked_by = timezone.now(), actor
    c.save(update_fields=["revoked_at", "revoked_by"])
    log(actor, GateAction.CONTRACTOR_REVOKE, f"Pass {c.pass_no} of {c.name} revoked{f': {reason}' if reason else ''}",
        contractor=c)
    return c


def visible_contractors(u):
    if can_view_all(u) or can_gate(u):
        return ContractorPass.objects.all()
    return ContractorPass.objects.filter(Q(supervisor=u) | Q(created_by=u))


# ================================================================ material gate pass

def _qty(raw, field):
    try:
        q = Decimal(str(raw if raw not in (None, "") else "1"))
    except (InvalidOperation, ValueError):
        raise ValidationError({field: "Enter a number."})
    if q <= 0 or q > Decimal("99999999"):
        raise ValidationError({field: "Enter a quantity above 0."})
    return q.quantize(Decimal("0.01"))


def approvers_for(m: MaterialPass) -> list:
    """The requester's reporting manager (when active), else the security head(s)."""
    mgr = getattr(m.requested_by, "reporting_manager", None) if m.requested_by else None
    if mgr and mgr.is_active and mgr.pk != m.requested_by_id:
        return [mgr]
    return [u for u in heads() if u.pk != m.requested_by_id]


def can_decide(u, m: MaterialPass) -> bool:
    if u.pk == m.requested_by_id and not can_view_all(u):
        return False
    mgr = getattr(m.requested_by, "reporting_manager_id", None) if m.requested_by else None
    return can_view_all(u) or (mgr is not None and mgr == u.pk)


def material_link(m: MaterialPass) -> str:
    return f"/visitors/material?open={m.pk}"


def items_text(m: MaterialPass) -> str:
    rows = list(m.items.all())
    first = ", ".join(f"{i.description} × {i.quantity.normalize():f}" for i in rows[:3])
    return first + (f" +{len(rows) - 3} more" if len(rows) > 3 else "")


def create_material(actor, data: dict) -> MaterialPass:
    if not (can_invite(actor) or can_gate(actor) or can_view_all(actor)):
        raise PermissionDenied("Your role does not include this.")
    errors = {}
    purpose = text(data.get("purpose"), 200)
    if not purpose:
        errors["purpose"] = "Why is it going out (or coming in)?"
    direction = data.get("direction") if data.get("direction") in ("out", "in") else "out"
    returnable = data.get("returnable") is True
    expected = None
    if returnable:
        try:
            expected = _day(data.get("expected_return"), "expected_return")
            if expected < timezone.localdate():
                errors["expected_return"] = "The return date has passed."
        except ValidationError as exc:
            errors.update(exc.detail)
    rows = data.get("items")
    if not isinstance(rows, list) or not rows:
        errors["items"] = "Add at least one item."
        rows = []
    if len(rows) > 50:
        errors["items"] = "At most 50 items on one pass."
    items = []
    for i, r in enumerate(rows[:50]):
        r = r if isinstance(r, dict) else {}
        desc = text(r.get("description"), 200)
        if not desc:
            errors[f"items.{i}.description"] = "What is it?"
        try:
            qty = _qty(r.get("quantity"), f"items.{i}.quantity")
        except ValidationError as exc:
            errors.update(exc.detail)
            qty = Decimal("1")
        asset_id = str(r.get("asset_id") or "")[:40]
        if asset_id and not re.fullmatch(r"[0-9a-fA-F-]{8,40}", asset_id):
            errors[f"items.{i}.asset_id"] = "Pick the asset from the list."
        items.append(MaterialItem(description=desc, quantity=qty, unit=text(r.get("unit"), 20) or "nos",
                                  asset_id=asset_id, asset_tag=text(r.get("asset_tag"), 60)))
    try:
        vehicle = clean_vehicle_no(data.get("vehicle_no"))
    except ValidationError as exc:
        errors.update(exc.detail)
        vehicle = ""
    if errors:
        raise ValidationError(errors)
    with transaction.atomic():
        m = MaterialPass.objects.create(direction=direction, purpose=purpose, returnable=returnable,
                                        expected_return=expected, carrier_name=text(data.get("carrier_name"), 80),
                                        carrier_company=text(data.get("carrier_company"), 120), vehicle_no=vehicle,
                                        location=_location(data.get("location")), requested_by=actor,
                                        notes=text(data.get("notes"), 500))
        m.pass_no = f"M{m.pk:05d}"
        for it in items:
            it.material = m
        MaterialItem.objects.bulk_create(items)
        # The security head asking for their own pass needs nobody else's yes.
        if can_view_all(actor):
            m.status, m.decided_by, m.decided_at = MaterialStatus.APPROVED, actor, timezone.now()
        m.save()
    log(actor, GateAction.MATERIAL_REQUEST, f"{m.pass_no} {m.get_direction_display().lower()}: {items_text(m)}",
        material=m)
    if m.status == MaterialStatus.PENDING:
        for u in approvers_for(m):
            _notify(u, "visitor_material_approval", f"{name_of(actor)} asks for a material gate pass",
                    f"{m.pass_no} · {m.get_direction_display()} · {items_text(m)} · {purpose}", material_link(m))
    return m


def decide_material(actor, m: MaterialPass, approve: bool, note="") -> MaterialPass:
    if m.status != MaterialStatus.PENDING:
        raise ValidationError({"detail": "This pass is not waiting for approval."})
    if not can_decide(actor, m):
        raise PermissionDenied("Only the requester's manager or the security head can decide.")
    m.status = MaterialStatus.APPROVED if approve else MaterialStatus.REJECTED
    m.decided_by, m.decided_at, m.decision_note = actor, timezone.now(), text(note, 300)
    m.save()
    log(actor, GateAction.MATERIAL_DECIDE, f"{m.pass_no} {'approved' if approve else 'rejected'}"
        f"{f': {m.decision_note}' if m.decision_note else ''}", material=m)
    if m.requested_by and m.requested_by != actor:
        _notify(m.requested_by, "visitor_material", f"Material pass {m.pass_no} {'approved' if approve else 'rejected'}",
                f"{items_text(m)}{f' · {m.decision_note}' if m.decision_note else ''}", material_link(m))
    return m


def _assets_event(m: MaterialPass, kind: str, actor):
    """The Platform records the movement on each asset in the Assets app (PLAN.md §17.4 outbox)."""
    from tenancy.outbox import emit
    assets = [{"id": i.asset_id, "tag": i.asset_tag} for i in m.items.all() if i.asset_id]
    if not assets:
        return
    emit("material.moved", {"kind": kind, "passNo": m.pass_no, "direction": m.direction, "purpose": m.purpose,
                            "returnable": m.returnable, "expectedReturn": m.expected_return.isoformat() if m.expected_return else None,
                            "carrier": m.carrier_name or m.carrier_company, "by": name_of(actor), "assets": assets,
                            "url": material_link(m)})


def gate_material(actor, m: MaterialPass, note="") -> MaterialPass:
    if m.status == MaterialStatus.PENDING:
        raise ValidationError({"detail": "Not approved yet: do not let it through."})
    if m.status != MaterialStatus.APPROVED:
        raise ValidationError({"detail": f"This pass is {m.get_status_display().lower()}: do not let it through."})
    m.status, m.gate_by, m.gate_at, m.gate_note = MaterialStatus.PASSED, actor, timezone.now(), text(note, 300)
    m.save()
    log(actor, GateAction.MATERIAL_GATE, f"{m.pass_no} {m.get_direction_display().lower()} at the gate: {items_text(m)}",
        material=m)
    _assets_event(m, "passed", actor)
    if m.requested_by:
        _notify(m.requested_by, "visitor_material", f"Material pass {m.pass_no} passed the gate", items_text(m),
                material_link(m))
    return m


def return_material(actor, m: MaterialPass, data: dict) -> MaterialPass:
    """Returnable goods coming back, all or some (data.items = {item id: quantity back now}; empty = everything)."""
    if not m.returnable or m.status != MaterialStatus.PASSED:
        raise ValidationError({"detail": "Only returnable goods that went out can come back."})
    back = data.get("items") if isinstance(data.get("items"), dict) else None
    for it in m.items.all():
        left = it.quantity - it.returned_qty
        if back is None:
            qty = left
        else:
            given = back.get(str(it.pk))
            qty = min(left, _qty(given, "items")) if given not in (None, "", 0, "0") else Decimal("0")
        if qty > 0:
            it.returned_qty += qty
            it.save(update_fields=["returned_qty"])
    complete = all(i.returned_qty >= i.quantity for i in m.items.all())
    if complete:
        m.status, m.returned_by, m.returned_at = MaterialStatus.RETURNED, actor, timezone.now()
        m.save()
    log(actor, GateAction.MATERIAL_RETURN, f"{m.pass_no}: {'everything back' if complete else 'part back'}", material=m)
    if complete:
        _assets_event(m, "returned", actor)
    return m


def cancel_material(actor, m: MaterialPass) -> MaterialPass:
    if m.status not in (MaterialStatus.PENDING, MaterialStatus.APPROVED):
        raise ValidationError({"detail": "Only a pass that has not passed the gate can be cancelled."})
    if actor.pk != m.requested_by_id and not can_view_all(actor):
        raise PermissionDenied("Only the person who asked can cancel.")
    m.status = MaterialStatus.CANCELLED
    m.save(update_fields=["status"])
    log(actor, GateAction.MATERIAL_DECIDE, f"{m.pass_no} cancelled", material=m)
    return m


def visible_material(u):
    """The register and the gate: all (a guard who scans an unapproved pass is told so); others: their own and their
    reports' passes."""
    if can_view_all(u) or can_gate(u):
        return MaterialPass.objects.all()
    return MaterialPass.objects.filter(Q(requested_by=u) | Q(requested_by__reporting_manager=u))


def material_overdue(now=None) -> int:
    today = timezone.localdate(now)
    late = list(MaterialPass.objects.filter(returnable=True, status=MaterialStatus.PASSED, expected_return__lt=today,
                                            overdue_alerted_at__isnull=True).select_related("requested_by"))
    people = heads()
    for m in late:
        for u in {*people, *([m.requested_by] if m.requested_by else [])}:
            _notify(u, "visitor_material", f"Material {m.pass_no} is not back yet",
                    f"Expected back on {m.expected_return:%d %b}: {items_text(m)}", material_link(m))
        m.overdue_alerted_at = now or timezone.now()
        m.save(update_fields=["overdue_alerted_at"])
    return len(late)


# ================================================================ patrol

def in_patrol_hours(now=None) -> bool:
    s = conf.get()
    a, b = int(s["patrol_from"]), int(s["patrol_to"])
    if a == b:
        return True
    h = timezone.localtime(now).hour
    return a <= h < b if a < b else (h >= a or h < b)


def checkpoint_overdue(cp: Checkpoint, now=None) -> bool:
    hours = int(conf.get()["patrol_every_hours"] or 0)
    if hours <= 0 or not cp.active:
        return False
    now = now or timezone.now()
    return (cp.last_scan_at is None) or (now - cp.last_scan_at > timedelta(hours=hours))


def save_checkpoint(actor, data: dict, cp: Checkpoint | None = None) -> Checkpoint:
    name = text(data.get("name"), 80) if "name" in data or cp is None else cp.name
    if not name:
        raise ValidationError({"name": "Name the checkpoint (e.g. Back gate, Store room)."})
    cp = cp or Checkpoint()
    cp.name = name
    if "location" in data:
        cp.location = _location(data.get("location"))
    if "order" in data:
        try:
            cp.order = max(0, min(999, int(data.get("order") or 0)))
        except (TypeError, ValueError):
            raise ValidationError({"order": "Enter a number."})
    if isinstance(data.get("active"), bool):
        cp.active = data["active"]
    if data.get("regenerate"):
        from .models import new_token
        cp.token = new_token()
    cp.save()
    log(actor, GateAction.CHECKPOINT, f"Checkpoint {cp.name} {'saved' if cp.active else 'switched off'}")
    return cp


def patrol_scan(actor, code: str, data: dict) -> PatrolScan:
    raw = str(code or "").strip()
    token = raw[4:] if raw.upper().startswith("KPP:") else raw.rstrip("/").rsplit("/", 1)[-1]
    cp = Checkpoint.objects.filter(token=token).first()
    if not cp:
        raise ValidationError({"code": "This is not one of your patrol checkpoints."})
    if not cp.active:
        raise ValidationError({"code": f"Checkpoint {cp.name} is switched off."})
    lat, lng = data.get("latitude"), data.get("longitude")
    try:
        lat = Decimal(str(lat)).quantize(Decimal("0.000001")) if lat not in (None, "") else None
        lng = Decimal(str(lng)).quantize(Decimal("0.000001")) if lng not in (None, "") else None
    except (InvalidOperation, ValueError):
        lat = lng = None
    ok = data.get("all_ok") is not False
    scan = PatrolScan.objects.create(checkpoint=cp, guard=actor, note=text(data.get("note"), 300), all_ok=ok,
                                     latitude=lat, longitude=lng)
    cp.last_scan_at, cp.missed_alerted_at = scan.at, None
    cp.save(update_fields=["last_scan_at", "missed_alerted_at"])
    log(actor, GateAction.PATROL, f"{cp.name}: {'all OK' if ok else 'problem'}{f' · {scan.note}' if scan.note else ''}")
    if not ok:
        for u in heads():
            _notify(u, "visitor_patrol", f"Patrol: problem at {cp.name}", f"{name_of(actor)}: {scan.note or 'see the patrol log'}",
                    "/visitors/patrol")
    return scan


def patrol_alerts(now=None) -> int:
    """A checkpoint not scanned for N hours (during patrol hours): one alert per gap to the security head(s)."""
    now = now or timezone.now()
    if not in_patrol_hours(now):
        return 0
    hours = int(conf.get()["patrol_every_hours"] or 0)
    if hours <= 0:
        return 0
    late = [cp for cp in Checkpoint.objects.filter(active=True, missed_alerted_at__isnull=True) if checkpoint_overdue(cp, now)]
    if not late:
        return 0
    people = heads()
    names = ", ".join(cp.name for cp in late[:6]) + (f" +{len(late) - 6}" if len(late) > 6 else "")
    for u in people:
        _notify(u, "visitor_patrol", f"Patrol missed: {names}", f"Not checked for more than {hours} h.", "/visitors/patrol")
    Checkpoint.objects.filter(pk__in=[cp.pk for cp in late]).update(missed_alerted_at=now)
    return len(late)


# ================================================================ incidents

MAX_INCIDENT_PHOTOS = 4


def report_incident(actor, data: dict) -> Incident:
    from .models import IncidentKind, IncidentSeverity, Visit
    title = text(data.get("title"), 120)
    if not title:
        raise ValidationError({"title": "What happened? (one line)"})
    kind = data.get("kind") if data.get("kind") in IncidentKind.values else IncidentKind.OTHER
    sev = data.get("severity") if data.get("severity") in IncidentSeverity.values else IncidentSeverity.MEDIUM
    occurred = timezone.now()
    if data.get("occurred_at"):
        try:
            occurred = datetime.fromisoformat(str(data["occurred_at"]).replace("Z", "+00:00"))
            if timezone.is_naive(occurred):
                occurred = timezone.make_aware(occurred)
        except ValueError:
            raise ValidationError({"occurred_at": "Pick the date and time."})
        if occurred > timezone.now() + timedelta(minutes=5):
            raise ValidationError({"occurred_at": "This is in the future."})
    photos = data.get("photos") or []
    if not isinstance(photos, list) or len(photos) > MAX_INCIDENT_PHOTOS:
        raise ValidationError({"photos": f"At most {MAX_INCIDENT_PHOTOS} photos."})
    raws = [decode_photo(p) for p in photos]
    visit = Visit.objects.filter(pk=data.get("visit")).first() if data.get("visit") else None
    with transaction.atomic():
        inc = Incident.objects.create(kind=kind, severity=sev, title=title, description=str(data.get("description") or "")[:4000],
                                      place=text(data.get("place"), 120), location=_location(data.get("location")),
                                      occurred_at=occurred, reported_by=actor, visit=visit)
        for raw in raws:
            if raw:
                ph = IncidentPhoto(incident=inc)
                store_photo(ph.photo, raw, (1280, 70))
                ph.save()
    log(actor, GateAction.INCIDENT, f"{inc.get_severity_display()} · {inc.get_kind_display()}: {title}", incident=inc)
    if sev != IncidentSeverity.LOW:
        for u in heads():
            if u != actor:
                _notify(u, "visitor_incident", f"{'URGENT: ' if sev == IncidentSeverity.HIGH else ''}Incident: {title}",
                        f"{inc.get_kind_display()} · {inc.place or (inc.location.name if inc.location else '')} · "
                        f"reported by {name_of(actor)}", f"/visitors/incidents?open={inc.pk}")
    return inc


def close_incident(actor, inc: Incident, action_taken: str) -> Incident:
    if inc.status == "closed":
        raise ValidationError({"detail": "Already closed."})
    action = str(action_taken or "").strip()[:4000]
    if not action:
        raise ValidationError({"action_taken": "What was done about it?"})
    inc.status, inc.action_taken, inc.closed_by, inc.closed_at = "closed", action, actor, timezone.now()
    inc.save()
    log(actor, GateAction.INCIDENT_CLOSE, f"{inc.title}: closed", incident=inc)
    if inc.reported_by and inc.reported_by != actor:
        _notify(inc.reported_by, "visitor_incident", f"Incident closed: {inc.title}", action[:300],
                f"/visitors/incidents?open={inc.pk}")
    return inc


def visible_incidents(u):
    if can_view_all(u):
        return Incident.objects.all()
    if can_gate(u):
        return Incident.objects.filter(Q(reported_by=u) | Q(status="open") | Q(occurred_at__gte=day_start() - timedelta(days=7)))
    return Incident.objects.filter(reported_by=u)


# ================================================================ ID card (AI)

ID_PROMPT = (
    "You read Indian identity cards (Aadhaar, PAN, driving licence, voter ID, passport, company ID). Reply with one JSON "
    'object: {"name": "<name as printed>", "id_type": "<one of: Aadhaar, PAN, Driving licence, Voter ID, Passport, '
    'Company ID, Other>", "last4": "<the LAST 4 characters of the ID number only>"}. Never write the full ID number, '
    "the address, the date of birth or anything else. Unknown: empty string."
)


def read_id_card(actor, photo) -> dict:
    from config import llm
    s = conf.get()
    if not s["id_scan"]:
        raise ValidationError({"detail": "Reading ID cards is switched off in Visitors → Settings."})
    if not llm.enabled():
        raise ValidationError({"detail": "The company's AI is not set up, so ID cards cannot be read. Type the details."})
    raw = decode_photo(photo)
    if not raw:
        raise ValidationError({"photo": "Take a photo of the ID card."})
    out = llm.read_image_json(ID_PROMPT, raw, "image/jpeg", max_tokens=200, timeout=40) or {}
    # Whatever came back, only the name, the type and 4 characters are kept: never a full number.
    name = text(out.get("name"), 80)
    id_type = text(out.get("id_type"), 30)
    if id_type not in conf.ID_TYPES:
        id_type = "Other" if id_type else ""
    last4 = re.sub(r"[^A-Za-z0-9]", "", str(out.get("last4") or ""))[-4:].upper()
    if len(last4) != 4:
        last4 = ""
    log(actor, GateAction.ID_SCAN, "ID card read for a check-in" if (name or last4) else "ID card could not be read")
    return {"name": name, "id_type": id_type if last4 else "", "id_last4": last4, "found": bool(name or last4)}


# ================================================================ worker

def run_jobs() -> None:
    material_overdue()
    patrol_alerts()
