"""Roster and shift library API (PLAN.md §28.6). Everything is under /api/hr/ (the Attendance plan area, §24.1) and
runs inside the request's company schema.

Who: `hr.roster` (team / department / company, PLAN.md §28.5) edits the roster of the people in that scope; HR
settings counts as company scope. The shift library is edited only at company scope. Everyone reads the shift list
and their own roster (`mine`). Nobody but the Owner changes their own roster (the own-records rule).
"""
import csv
import io
import re
from datetime import date, datetime, time, timedelta
from itertools import islice

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import SELF_EDIT_MESSAGE, editing_own_records, has_capability

from . import roster
from .models import SHIFT_COLOURS, LeaveRequest, LeaveStatus, PersonShift, RosterEntry, Shift

MAX_DAYS = 62
IMPORT_MAX_BYTES = 2 * 1024 * 1024
IMPORT_MAX_ROWS = 2000
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


# ------------------------------------------------------------------ scope

def edit_scope(user) -> str | None:
    """How far this user plans the roster: 'team' / 'department' / 'company', None = not at all."""
    from accounts.access import scope_of
    if has_capability(user, "hr.settings"):
        return "company"
    return scope_of(user, "hr.roster")


def _scope_or_403(user) -> str:
    scope = edit_scope(user)
    if scope is None:
        raise PermissionDenied("Your role does not include the roster.")
    return scope


def _people(user, scope, params):
    from .team import people_in_scope
    qs = people_in_scope(user, scope).select_related("reporting_manager")
    if params.get("department"):
        qs = qs.filter(department=params["department"])
    if str(params.get("manager") or "").isdigit():
        qs = qs.filter(reporting_manager_id=int(params["manager"]))
    q = (params.get("q") or "").strip()
    if q:
        from django.db.models import Q
        name = Q()
        for word in q.split():
            name &= Q(first_name__icontains=word) | Q(last_name__icontains=word)
        qs = qs.filter(Q(username__icontains=q) | Q(employee_code__icontains=q) | name)
    return list(qs.distinct().order_by("first_name", "last_name", "username"))


def _day(text, field):
    try:
        return datetime.strptime(str(text)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ValidationError({field: "Use YYYY-MM-DD."})


def _range(params):
    today = timezone.localdate()
    first = _day(params.get("from"), "from") if params.get("from") else today - timedelta(days=today.weekday())
    last = _day(params.get("to"), "to") if params.get("to") else first + timedelta(days=6)
    if last < first:
        raise ValidationError({"to": "The end date is before the start date."})
    if (last - first).days >= MAX_DAYS:
        raise ValidationError({"to": f"Pick at most {MAX_DAYS} days."})
    return first, last


# ------------------------------------------------------------------ shifts

def shift_data(s: Shift) -> dict:
    return {"id": s.id, "name": s.name, "code": s.code, "start": s.start.strftime("%H:%M") if s.start else "",
            "end": s.end.strftime("%H:%M") if s.end else "", "break_minutes": s.break_minutes,
            "grace_minutes": s.grace_minutes, "half_day_hours": s.half_day_hours, "colour": s.colour,
            "is_off": s.is_off, "active": s.active, "order": s.order, "overnight": s.overnight,
            "label": roster.shift_label(s)}


def _hhmm(value, field):
    text = str(value or "").strip()
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValidationError({field: "Use a time like 09:30."})
    return time(int(m.group(1)), int(m.group(2)))


def _clean_shift(data, instance=None) -> dict:
    out = {}
    get = data.get
    if instance is None or "name" in data:
        name = " ".join(str(get("name") or "").split())[:60]
        if not name:
            raise ValidationError({"name": "Give the shift a name."})
        out["name"] = name
    if instance is None or "code" in data:
        code = re.sub(r"\s+", "", str(get("code") or "")).upper()[:4]
        if not code:
            raise ValidationError({"code": "A short code, 1–4 letters (G, M, N, OFF)."})
        clash = Shift.objects.filter(code__iexact=code, active=True)
        if instance is not None:
            clash = clash.exclude(pk=instance.pk)
        if clash.exists():
            raise ValidationError({"code": f"Another shift already uses {code}."})
        out["code"] = code
    is_off = bool(get("is_off")) if "is_off" in data else (instance.is_off if instance else False)
    out["is_off"] = is_off
    if is_off:
        out["start"] = out["end"] = None
    else:
        if instance is None or "start" in data or (instance and instance.is_off):
            out["start"] = _hhmm(get("start"), "start")
        if instance is None or "end" in data or (instance and instance.is_off):
            out["end"] = _hhmm(get("end"), "end")
        start = out.get("start", instance.start if instance else None)
        end = out.get("end", instance.end if instance else None)
        if start and end and start == end:
            raise ValidationError({"end": "The shift must end at another time than it starts."})
    for field, lo, hi, kind in (("break_minutes", 0, 600, int), ("grace_minutes", 0, 240, int),
                                ("half_day_hours", 0.5, 24, float), ("order", 0, 10000, int)):
        if field in data:
            value = get(field)
            if value in (None, "") and field in ("grace_minutes", "half_day_hours"):
                out[field] = None      # the company's HR rule
                continue
            try:
                number = kind(value if value not in (None, "") else 0)
            except (TypeError, ValueError):
                raise ValidationError({field: "Enter a number."})
            if not lo <= number <= hi:
                raise ValidationError({field: f"Between {lo} and {hi}."})
            out[field] = number
    if "colour" in data:
        if get("colour") not in SHIFT_COLOURS:
            raise ValidationError({"colour": f"One of: {', '.join(SHIFT_COLOURS)}."})
        out["colour"] = get("colour")
    if "active" in data:
        out["active"] = bool(get("active"))
    return out


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def shifts(request):
    if request.method == "GET":
        qs = Shift.objects.all()
        if request.query_params.get("all") not in ("1", "true"):
            qs = qs.filter(active=True)
        return Response([shift_data(s) for s in qs])
    if edit_scope(request.user) != "company":
        raise PermissionDenied("Only HR for the whole company edits the shift list.")
    shift = Shift.objects.create(**_clean_shift(request.data))
    return Response(shift_data(shift), status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def shift_detail(request, pk):
    if edit_scope(request.user) != "company":
        raise PermissionDenied("Only HR for the whole company edits the shift list.")
    shift = Shift.objects.filter(pk=pk).first()
    if shift is None:
        raise ValidationError({"detail": "No such shift."})
    data = _clean_shift(request.data, shift)
    if data.get("active") is False and PersonShift.objects.filter(shift=shift).exists():
        raise ValidationError({"detail": "Some people have this as their default shift: change theirs first."})
    for k, v in data.items():
        setattr(shift, k, v)
    shift.save()
    return Response(shift_data(shift))


# ------------------------------------------------------------------ the roster

def _leaves(user_ids, first, last) -> list[dict]:
    out = []
    for lv in (LeaveRequest.objects.filter(user_id__in=user_ids, status__in=[LeaveStatus.APPROVED, LeaveStatus.PENDING],
                                           start_date__lte=last, end_date__gte=first).select_related("leave_type")):
        cur = max(lv.start_date, first)
        while cur <= min(lv.end_date, last):
            out.append({"user": lv.user_id, "date": cur.isoformat(), "type": lv.leave_type.name,
                        "half_day": lv.half_day, "status": lv.status})
            cur += timedelta(days=1)
    return out


def roster_data(viewer, scope, params) -> dict:
    from crm.models import Holiday
    from .team import department_names, departments_of
    first, last = _range(params)
    people = _people(viewer, scope, params)
    ids = [u.id for u in people]
    names = department_names()
    book = roster.Book(ids, first - timedelta(days=1), last)
    holidays = {h.date: h.name for h in Holiday.objects.filter(date__range=(first, last))}
    days, cur = [], first
    while cur <= last:
        days.append({"date": cur.isoformat(), "weekday": WEEKDAYS[cur.weekday()], "holiday": holidays.get(cur),
                     "week_off": cur.weekday() in book.week_offs})
        cur += timedelta(days=1)
    entries = [{"user": uid, "date": d.isoformat(), "shift": s.id}
               for (uid, d), s in book.entries.items() if first <= d <= last]
    managers = {}
    for u in people:
        if u.reporting_manager_id and u.reporting_manager:
            m = u.reporting_manager
            managers[m.id] = m.get_full_name() or m.username
    return {
        "from": first.isoformat(), "to": last.isoformat(), "days": days,
        "people": [{"user_id": u.id, "name": u.get_full_name() or u.username, "employee_code": u.employee_code,
                    "department": names.get(u.department, u.department or ""), "department_code": u.department,
                    "designation": u.designation, "manager_id": u.reporting_manager_id,
                    "default_shift": book.defaults[u.id].id if u.id in book.defaults else None,
                    "is_self": u.id == viewer.id}
                   for u in people],
        "entries": entries,
        "leaves": _leaves(ids, first, last),
        "shifts": [shift_data(s) for s in Shift.objects.all()],
        "office": {"start": book.conf["work_start"], "end": book.conf["work_end"],
                   "week_offs": sorted(book.week_offs)},
        "warnings": roster.rest_warnings(book, ids, first, last),
        "min_rest_hours": roster.min_rest_hours(),
        "scope": scope,
        "can_edit_shifts": scope == "company",
        "can_edit_self": not editing_own_records(viewer, viewer),
        "departments": departments_of(people, names),
        "managers": sorted(({"id": k, "name": v} for k, v in managers.items()), key=lambda m: m["name"].lower()),
    }


def _export(viewer, scope, params, fmt):
    from config.exports import export_file
    data = roster_data(viewer, scope, params)
    by_id = {s["id"]: s for s in data["shifts"]}
    cells = {(e["user"], e["date"]): by_id[e["shift"]]["code"] for e in data["entries"]}
    header = ["Employee ID", "Name", "Department", "Default shift"] + [f"{d['date']} {d['weekday']}" for d in data["days"]]
    rows = []
    for p in data["people"]:
        default = by_id.get(p["default_shift"], {}).get("code", "") if p["default_shift"] else ""
        rows.append([p["employee_code"], p["name"], p["department"], default]
                    + [cells.get((p["user_id"], d["date"]), "") for d in data["days"]])
    return export_file(fmt, f"Roster {data['from']} to {data['to']}", f"roster-{data['from']}-to-{data['to']}",
                       header, rows)


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def roster_view(request):
    scope = _scope_or_403(request.user)
    if request.method == "GET":
        fmt = request.query_params.get("export")
        if fmt:
            return _export(request.user, scope, request.query_params, fmt)
        return Response(roster_data(request.user, scope, request.query_params))
    return Response(save(request.user, scope, request.data))


def save(actor, scope, data) -> dict:
    """Applies {changes: [{user, date, shift|null}], defaults: [{user, shift|null}]} all or nothing; tells each person
    whose upcoming shift changed (in-app only)."""
    from .team import people_in_scope
    changes = data.get("changes") or []
    defaults = data.get("defaults") or []
    if not isinstance(changes, list) or not isinstance(defaults, list):
        raise ValidationError({"detail": "changes and defaults are lists."})
    if len(changes) > 5000 or len(defaults) > 2000:
        raise ValidationError({"detail": "Too many changes at once: save a smaller part."})
    shifts_by_id = {s.id: s for s in Shift.objects.all()}
    wanted_users = {int(c.get("user")) for c in [*changes, *defaults]
                    if isinstance(c, dict) and str(c.get("user", "")).isdigit()}
    allowed = {u.id: u for u in people_in_scope(actor, scope).filter(pk__in=wanted_users)}

    def person(item):
        uid = item.get("user") if isinstance(item, dict) else None
        if not str(uid or "").isdigit() or int(uid) not in allowed:
            raise PermissionDenied("You cannot plan the roster of this person.")
        if editing_own_records(actor, int(uid)):
            raise PermissionDenied(SELF_EDIT_MESSAGE.replace("attendance/salary", "roster"))
        return allowed[int(uid)]

    def shift_of(item, field="shift", allow_off=True):
        sid = item.get(field)
        if sid in (None, ""):
            return None
        shift = shifts_by_id.get(int(sid)) if str(sid).isdigit() else None
        if shift is None or not shift.active:
            raise ValidationError({"detail": "Pick an active shift."})
        if shift.is_off and not allow_off:
            raise ValidationError({"detail": "A default shift must be a working shift; use Off on the roster days."})
        return shift

    rows = {}
    for c in changes:
        u = person(c)
        rows[(u.id, _day(c.get("date"), "date"))] = (u, shift_of(c))
    default_rows = {}
    for d in defaults:
        u = person(d)
        default_rows[u.id] = (u, shift_of(d, allow_off=False))

    if rows:
        days = [d for (_u, d) in rows]
        first, last = min(days), max(days)
        on_leave = {(x["user"], x["date"]) for x in _leaves(list({u for (u, _d) in rows}), first, last)
                    if x["status"] == LeaveStatus.APPROVED and not x["half_day"]}
        for (uid, d), (u, _s) in rows.items():
            if (uid, d.isoformat()) in on_leave:
                raise ValidationError({"detail": f"{u.get_full_name() or u.username} is on leave on {d:%d-%m-%Y}: "
                                                 "the leave decides that day."})

    before = {}
    if rows:
        uids = list({uid for (uid, _d) in rows})
        days = [d for (_u, d) in rows]
        before_book = roster.Book(uids, min(days), max(days))
    with transaction.atomic():
        for uid, (u, shift) in default_rows.items():
            if shift is None:
                PersonShift.objects.filter(user=u).delete()
            else:
                PersonShift.objects.update_or_create(user=u, defaults={"shift": shift, "updated_by": actor})
        existing = {}
        if rows:
            for e in RosterEntry.objects.filter(user_id__in=[uid for (uid, _d) in rows],
                                                date__in=list({d for (_u, d) in rows})):
                existing[(e.user_id, e.date)] = e
        changed = []
        for key, (u, shift) in rows.items():
            old = existing.get(key)
            before[key] = before_book.plan(*key)
            if shift is None:
                if old is not None:
                    old.delete()
                    changed.append(key)
            elif old is None:
                RosterEntry.objects.create(user=u, date=key[1], shift=shift, updated_by=actor)
                changed.append(key)
            elif old.shift_id != shift.id:
                old.shift = shift
                old.updated_by = actor
                old.save(update_fields=["shift", "updated_by", "updated_at"])
                changed.append(key)
    notified = _tell_people(actor, changed, before, allowed)
    return {"saved": len(changed), "defaults": len(default_rows), "notified": notified}


def _day_text(d: date) -> str:
    return f"{WEEKDAYS[d.weekday()]} {d.day} {d:%b}"


def _plan_text(plan) -> str:
    if plan.off:
        return "Off"
    name = plan.shift.name if plan.shift is not None else "Office hours"
    return f"{name} {plan.start_text()}–{plan.end_text()}" if plan.has_times else name


def _tell_people(actor, changed, before, users) -> int:
    """One in-app notification per person whose shift changed from today on: "Your shift on Mon 3 Nov changed to
    Night 22:00–06:00" (a few days in one message). No WhatsApp: no template fits (PLAN.md §28.5)."""
    from notifications.service import notify
    today = timezone.localdate()
    by_user = {}
    for uid, d in changed:
        if d >= today and uid != actor.id:
            by_user.setdefault(uid, []).append(d)
    sent = 0
    for uid, days in by_user.items():
        days.sort()
        book = roster.Book([uid], days[0], days[-1])
        parts = []
        for d in days:
            now_plan = book.plan(uid, d)
            if _plan_text(now_plan) != _plan_text(before.get((uid, d), now_plan)) or (uid, d) not in before:
                parts.append((d, _plan_text(now_plan)))
        if not parts:
            continue
        if len(parts) == 1:
            title = f"Your shift on {_day_text(parts[0][0])} changed to {parts[0][1]}"
        else:
            shown = ", ".join(f"{_day_text(d)}: {t}" for d, t in parts[:3])
            more = f" and {len(parts) - 3} more" if len(parts) > 3 else ""
            title = f"Your shifts changed — {shown}{more}"
        try:
            notify(users[uid], "roster_changed", title[:250], "", link="/hr?tab=today", category="attendance",
                   want_whatsapp=False, want_email=False)
            sent += 1
        except Exception:  # noqa: BLE001 -- a failed note never undoes the saved roster
            import logging
            logging.getLogger(__name__).exception("roster note for user %s failed", uid)
    return sent


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_roster(request):
    """The person's own next days (default 14, at most 62): shift, off day, holiday, leave."""
    from crm.models import Holiday
    try:
        n = max(1, min(MAX_DAYS, int(request.query_params.get("days") or 14)))
    except ValueError:
        n = 14
    first = _day(request.query_params["from"], "from") if request.query_params.get("from") else timezone.localdate()
    last = first + timedelta(days=n - 1)
    uid = request.user.id
    book = roster.Book([uid], first, last)
    holidays = {h.date: h.name for h in Holiday.objects.filter(date__range=(first, last))}
    leaves = {x["date"]: x for x in _leaves([uid], first, last)}
    days, cur = [], first
    while cur <= last:
        plan = book.plan(uid, cur)
        s = plan.shift
        days.append({
            "date": cur.isoformat(), "weekday": WEEKDAYS[cur.weekday()], "off": plan.off,
            "holiday": holidays.get(cur), "leave": leaves.get(cur.isoformat()),
            "source": plan.source, "start": plan.start_text(), "end": plan.end_text(), "overnight": plan.overnight,
            "code": s.code if s is not None else "", "name": s.name if s is not None else "Office hours",
            "colour": s.colour if s is not None else "",
        })
        cur += timedelta(days=1)
    return Response({"from": first.isoformat(), "to": last.isoformat(), "days": days,
                     "uses_roster": any(d["source"] != "office" for d in days)})


# ------------------------------------------------------------------ import (same template as the export)

def _read_table(upload):
    name = (getattr(upload, "name", "") or "").lower()
    if upload.size > IMPORT_MAX_BYTES:
        raise ValidationError({"file": "The file is larger than 2 MB."})
    raw = upload.read()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        try:
            wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        except Exception:
            raise ValidationError({"file": "This XLSX file could not be read."})
        rows_in = wb.worksheets[0].iter_rows(values_only=True, max_col=4 + MAX_DAYS)
    elif name.endswith(".csv"):
        rows_in = (r[:4 + MAX_DAYS] for r in csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    else:
        raise ValidationError({"file": "Upload an .xlsx or .csv file."})
    limit = IMPORT_MAX_ROWS + 2
    try:
        table = [list(r) for r in islice(rows_in, limit)]
    except Exception:
        raise ValidationError({"file": "This file could not be read."})
    if len(table) >= limit:
        raise ValidationError({"file": f"At most {IMPORT_MAX_ROWS} people per file."})
    if not table:
        raise ValidationError({"file": "The file is empty."})
    return table


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def roster_import(request):
    """The exported roster file, edited: Employee ID, Name, Department, Default shift, then one column per date
    (YYYY-MM-DD …) with a shift code (blank = no change; "-" = clear the day). Dry run unless dry_run=false."""
    scope = _scope_or_403(request.user)
    upload = request.FILES.get("file")
    if not upload:
        raise ValidationError({"file": "Choose the roster file."})
    table = _read_table(upload)
    header = [str(h or "").strip() for h in table[0]]
    if not header or header[0].lower() not in ("employee id", "employee_id", "employee"):
        raise ValidationError({"file": "The first row must be the template's column names: download the roster first."})
    date_cols = []
    for i, h in enumerate(header):
        if re.match(r"^\d{4}-\d{2}-\d{2}", h):
            date_cols.append((i, _day(h, "file")))
    default_col = next((i for i, h in enumerate(header) if h.lower().startswith("default")), None)
    codes = {s.code.upper(): s for s in Shift.objects.filter(active=True)}
    users = {}
    for u in User.objects.filter(is_active=True):
        for key in (u.employee_code, u.username):
            if key:
                users.setdefault(str(key).strip().lower(), u)
    changes, defaults, problems = [], [], []
    for line, row in enumerate(table[1:], start=2):
        if not any(str(v or "").strip() for v in row):
            continue
        code = str(row[0] or "").strip()
        u = users.get(code.lower())
        if u is None:
            problems.append({"line": line, "error": f"No active person with employee ID {code or '(blank)'}."})
            continue
        if default_col is not None and default_col < len(row):
            text = str(row[default_col] or "").strip().upper()
            if text:
                s = codes.get(text)
                if s is None or s.is_off:
                    problems.append({"line": line, "error": f"Default shift {text} is not a working shift code."})
                else:
                    defaults.append({"user": u.id, "shift": s.id})
        for i, d in date_cols:
            text = str(row[i] or "").strip().upper() if i < len(row) else ""
            if not text:
                continue
            if text == "-":
                changes.append({"user": u.id, "date": d.isoformat(), "shift": None})
                continue
            s = codes.get(text)
            if s is None:
                problems.append({"line": line, "error": f"{d:%d-%m-%Y}: unknown shift code {text}."})
                continue
            changes.append({"user": u.id, "date": d.isoformat(), "shift": s.id})
    result = {"dry_run": True, "changes": len(changes), "defaults": len(defaults), "problems": problems}
    dry = str(request.data.get("dry_run", "true")).lower() not in ("false", "0", "no")
    if not dry:
        if problems:
            raise ValidationError({"detail": "Fix the rows with problems first.", "problems": problems})
        result.update(save(request.user, scope, {"changes": changes, "defaults": defaults}), dry_run=False)
    return Response(result)
