"""HR rules: geo-fence validation, attendance computation, leave-day
expansion and the monthly report.

Everything that decides a status runs SERVER-SIDE. The client sends raw
GPS coordinates (and a punch photo when the company asks for one); it never
sends a distance, a status or a "verified" flag.

Face matching was removed (founder, 2026-10-12; PLAN.md §19.18): a punch is the
office geofence + a selfie stored with it. The data stays readable (FaceProfile,
Attendance.face_verified/face_confidence, the FACE_RECOGNITION_ENABLED setting,
switched off for every company by migration hr 0006), but no punch ever needs or
checks a face descriptor.
"""
import math
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from crm.models import Holiday

from .models import (
    Attendance, AttendanceStatus, LeaveRequest, LeaveStatus, OfficeLocation,
)
from tenancy.company_settings import company_env


# ---------------------------------------------------------------- config

def _env(name, default):
    return company_env(name, default)


def cfg():
    return {
        "work_start": _env("HR_WORK_START", "09:30"),
        "work_end": _env("HR_WORK_END", "18:30"),
        "grace_minutes": int(_env("HR_LATE_GRACE_MINUTES", "15")),
        "half_day_hours": float(_env("HR_HALF_DAY_HOURS", "4")),
        "full_day_hours": float(_env("HR_FULL_DAY_HOURS", "8")),
        "week_offs": [int(d) for d in _env("HR_WEEK_OFF_DAYS", "6").split(",") if d.strip().isdigit()],
        "geofence_enabled": _env("GEOFENCE_ENABLED", "false").lower() == "true",
        # Face check is permanently off (PLAN.md §19.18); reported for older clients.
        "face_enabled": False,
        # Punch-in photo (PLAN.md §16.4): off | optional | required. FreeFounders companies get
        # "required" when they are set up; a standalone install keeps it off.
        "photo": _env("ATTENDANCE_PHOTO", "off").lower() if _env("ATTENDANCE_PHOTO", "off").lower() in PHOTO_MODES else "off",
        "photo_retention_days": int(_env("ATTENDANCE_PHOTO_RETENTION_DAYS", "90") or 90),
        # Approvals (PLAN.md §17.2)
        "leave_approval": _env("APPROVAL_LEAVE", "department") if _env("APPROVAL_LEAVE", "department") in ("department", "manager") else "department",
        "approval_remind_hours": int(_env("APPROVAL_REMIND_HOURS", "24") or 0),
    }


PHOTO_MODES = ("off", "optional", "required")
PHOTO_MAX_BYTES = 400 * 1024

# Settings an HR admin edits on the HR Settings screen. Each is stored per company
# (CompanySetting); a blank value falls back to the server's environment variable.
#   key: (environment variable, kind, extra)
EDITABLE = {
    "work_start": ("HR_WORK_START", "time", None),
    "work_end": ("HR_WORK_END", "time", None),
    "grace_minutes": ("HR_LATE_GRACE_MINUTES", "int", (0, 240)),
    "half_day_hours": ("HR_HALF_DAY_HOURS", "float", (0.5, 24)),
    "full_day_hours": ("HR_FULL_DAY_HOURS", "float", (1, 24)),
    "week_offs": ("HR_WEEK_OFF_DAYS", "days", None),
    "geofence_enabled": ("GEOFENCE_ENABLED", "bool", None),
    "photo": ("ATTENDANCE_PHOTO", "choice", PHOTO_MODES),
    "photo_retention_days": ("ATTENDANCE_PHOTO_RETENTION_DAYS", "int", (1, 3650)),
    "leave_approval": ("APPROVAL_LEAVE", "choice", ("department", "manager")),
    "approval_remind_hours": ("APPROVAL_REMIND_HOURS", "int", (0, 720)),
}

# Face check settings that no longer exist (PLAN.md §19.18). An older screen may still send them: "off" (or blank) is
# accepted and ignored, switching face check on is refused.
RETIRED = {"face_enabled", "face_threshold", "face_self_enroll"}
FACE_REMOVED = "Face check was removed: a punch is the office location and a selfie."


def clean_setting(key, value) -> str:
    """The stored text for one editable setting, or ValueError with a message for the admin."""
    env, kind, extra = EDITABLE[key]
    if value is None or value == "":
        return ""
    if kind == "time":
        text = str(value).strip()
        h, _, m = text.partition(":")
        if not (h.isdigit() and m.isdigit() and 0 <= int(h) < 24 and 0 <= int(m) < 60):
            raise ValueError("Use a time like 09:30")
        return f"{int(h):02d}:{int(m):02d}"
    if kind in ("int", "float"):
        try:
            number = int(value) if kind == "int" else float(value)
        except (TypeError, ValueError):
            raise ValueError("Enter a number")
        lo, hi = extra
        if not lo <= number <= hi:
            raise ValueError(f"Between {lo} and {hi}")
        return str(number)
    if kind == "bool":
        if isinstance(value, bool):
            return "true" if value else "false"
        if str(value).lower() in ("true", "false"):
            return str(value).lower()
        raise ValueError("On or off")
    if kind == "days":
        days = value if isinstance(value, list) else str(value).split(",")
        try:
            out = sorted({int(d) for d in days if str(d).strip() != ""})
        except ValueError:
            raise ValueError("Days are 0 (Monday) to 6 (Sunday)")
        if any(d < 0 or d > 6 for d in out):
            raise ValueError("Days are 0 (Monday) to 6 (Sunday)")
        return ",".join(map(str, out)) or "none"
    if kind == "choice":
        if str(value) not in extra:
            raise ValueError(f"One of: {', '.join(extra)}")
        return str(value)
    raise ValueError("Unknown setting")


def decode_photo(data) -> bytes | None:
    """A punch photo sent as a data URL or base64. JPEG, PNG or WebP by content; at most 400 KB."""
    import base64
    import binascii

    if not data:
        return None
    text = str(data)
    if text.startswith("data:"):
        text = text.split(",", 1)[-1]
    try:
        raw = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise HRError("The photo could not be read. Please try again.")
    if len(raw) > PHOTO_MAX_BYTES:
        raise HRError("The photo is too large. Please try again.")
    if not (raw[:3] == b"\xff\xd8\xff" or raw[:8] == b"\x89PNG\r\n\x1a\n" or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")):
        raise HRError("The photo must be a JPEG, PNG or WebP image.")
    return raw


def _attach_photo(record, field: str, photo):
    """Applies the company's photo rule to one punch."""
    from django.core.files.base import ContentFile

    mode = cfg()["photo"]
    raw = decode_photo(photo) if mode != "off" else None
    if mode == "required" and not raw:
        raise HRError("Take a photo to mark your attendance.")
    if raw:
        # Stored as a JPEG of at most 720 px without metadata (PLAN.md §19.20); a PNG/WebP is always converted, since the
        # photo is served as image/jpeg.
        from config.images import SELFIE, compress_image
        raw, _ = compress_image(raw, *SELFIE, always=raw[:3] != b"\xff\xd8\xff")
        getattr(record, field).save("punch.jpg", ContentFile(raw), save=False)


def purge_attendance_photos() -> int:
    """Deletes punch photos older than the company's retention period (PLAN.md §16.4). Returns how many."""
    from django.db.models import Q

    cutoff = timezone.localdate() - timedelta(days=cfg()["photo_retention_days"])
    removed = 0
    for rec in Attendance.objects.filter(date__lt=cutoff).filter(~Q(check_in_photo="") | ~Q(check_out_photo="")):
        for field in ("check_in_photo", "check_out_photo"):
            f = getattr(rec, field)
            if f:
                f.delete(save=False)
                removed += 1
        rec.save(update_fields=["check_in_photo", "check_out_photo"])
    return removed


def _parse_hhmm(value: str, fallback: time) -> time:
    try:
        h, m = value.split(":")
        return time(int(h), int(m))
    except (ValueError, AttributeError):
        return fallback


class HRError(Exception):
    """Rejected check-in/out -- message is safe to show the employee."""


# ------------------------------------------------------------- geofence

def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def validate_location(lat, lng):
    """Returns (office, distance_m). Raises HRError when outside every fence.
    With geofencing disabled the coordinates are stored but never enforced."""
    conf = cfg()
    if not conf["geofence_enabled"]:
        return None, None
    offices = list(OfficeLocation.objects.filter(active=True))
    if not offices:
        raise HRError("No office location is configured yet — ask an admin to add one.")
    if lat is None or lng is None:
        raise HRError("Location is required for attendance. Please enable GPS and try again.")
    best, best_d = None, None
    for office in offices:
        d = haversine_m(float(lat), float(lng), office.latitude, office.longitude)
        if best_d is None or d < best_d:
            best, best_d = office, d
    if best_d > best.radius_m:
        raise HRError(
            f"You are {int(best_d)} m from {best.name} (allowed {best.radius_m} m). "
            "Move closer to the office to mark attendance."
        )
    return best, best_d


# ----------------------------------------------------- attendance rules

def is_week_off(day: date) -> bool:
    return day.weekday() in cfg()["week_offs"]


def is_holiday(day: date) -> bool:
    return Holiday.objects.filter(date=day).exists()


def check_in(user, lat=None, lng=None, descriptor=None, photo=None) -> Attendance:
    """`descriptor` (a face signature from an older client) is ignored: there is no face check."""
    conf = cfg()
    today = timezone.localdate()
    existing = Attendance.objects.filter(user=user, date=today).first()
    if existing and existing.check_in:
        raise HRError("You have already checked in today.")
    if existing and existing.status == AttendanceStatus.LEAVE:
        raise HRError("You are on approved leave today.")

    office, _ = validate_location(lat, lng)

    now = timezone.localtime()
    start = _parse_hhmm(conf["work_start"], time(9, 30))
    late_cutoff = (datetime.combine(today, start) + timedelta(minutes=conf["grace_minutes"])).time()
    late = now.time() > late_cutoff

    record = existing or Attendance(user=user, date=today)
    record.check_in = timezone.now()
    record.check_in_lat, record.check_in_lng = lat, lng
    record.location = office
    record.is_late = late
    record.status = AttendanceStatus.LATE if late else AttendanceStatus.PRESENT
    record.face_verified = False
    record.face_confidence = None
    _attach_photo(record, "check_in_photo", photo)
    record.save()
    return record


def check_out(user, lat=None, lng=None, descriptor=None, photo=None) -> Attendance:
    conf = cfg()
    today = timezone.localdate()
    record = Attendance.objects.filter(user=user, date=today).first()
    if not record or not record.check_in:
        raise HRError("You have not checked in today.")
    if record.check_out:
        raise HRError("You have already checked out today.")

    validate_location(lat, lng)

    record.check_out = timezone.now()
    record.check_out_lat, record.check_out_lng = lat, lng
    record.working_minutes = max(0, int((record.check_out - record.check_in).total_seconds() // 60))

    end = _parse_hhmm(conf["work_end"], time(18, 30))
    record.is_early_checkout = timezone.localtime(record.check_out).time() < end
    hours = record.working_minutes / 60
    if hours < conf["half_day_hours"]:
        record.status = AttendanceStatus.HALF_DAY
    elif record.is_late:
        record.status = AttendanceStatus.LATE
    else:
        record.status = AttendanceStatus.PRESENT
    _attach_photo(record, "check_out_photo", photo)
    record.save()
    return record


# ---------------------------------------------------------------- leave

def leave_working_days(start: date, end: date):
    """Dates in the range that are actual working days (no week-offs/holidays)."""
    days, cur = [], start
    while cur <= end:
        if not is_week_off(cur) and not is_holiday(cur):
            days.append(cur)
        cur += timedelta(days=1)
    return days


def apply_leave_to_attendance(leave: LeaveRequest):
    """Approved leave -> LEAVE attendance rows, so reports and check-in agree."""
    for day in leave_working_days(leave.start_date, leave.end_date):
        record, _ = Attendance.objects.get_or_create(
            user=leave.user, date=day,
            defaults={"status": AttendanceStatus.LEAVE, "leave_request": leave},
        )
        if not record.check_in:
            record.status = AttendanceStatus.LEAVE
            record.leave_request = leave
            record.save(update_fields=["status", "leave_request"])


def revoke_leave_attendance(leave: LeaveRequest):
    Attendance.objects.filter(leave_request=leave, check_in__isnull=True).delete()


def leave_balances(user, year=None):
    from .models import LeaveType
    year = year or timezone.localdate().year
    out = []
    for lt in LeaveType.objects.filter(active=True):
        used = sum(
            l.days for l in LeaveRequest.objects.filter(
                user=user, leave_type=lt, status=LeaveStatus.APPROVED,
                start_date__year=year)
        )
        pending = sum(
            l.days for l in LeaveRequest.objects.filter(
                user=user, leave_type=lt, status=LeaveStatus.PENDING,
                start_date__year=year)
        )
        out.append({
            "leave_type": lt.id, "name": lt.name, "paid": lt.paid,
            "quota": lt.annual_quota, "used": used, "pending": pending,
            "balance": max(0, lt.annual_quota - used),
        })
    return out


# --------------------------------------------------------------- report

def monthly_report(user, year: int, month: int) -> dict:
    """Day-by-day + totals for one employee/month. Days with no record are
    classified as week-off / holiday / absent (never 'absent' in the future)."""
    first = date(year, month, 1)
    last = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
    records = {a.date: a for a in Attendance.objects.filter(user=user, date__range=(first, last))}
    holidays = {h.date: h.name for h in Holiday.objects.filter(date__range=(first, last))}
    today = timezone.localdate()

    days, totals = [], {s.value: 0 for s in AttendanceStatus}
    total_minutes = 0
    cur = first
    while cur <= last:
        rec = records.get(cur)
        if rec:
            status = rec.status
            total_minutes += rec.working_minutes
            entry = {
                "date": cur.isoformat(), "status": status,
                "check_in": rec.check_in, "check_out": rec.check_out,
                "working_minutes": rec.working_minutes,
                "is_late": rec.is_late, "is_early_checkout": rec.is_early_checkout,
                "missing_checkout": rec.missing_checkout,
                "attendance_id": rec.id,
                "has_check_in_photo": bool(rec.check_in_photo),
                "has_check_out_photo": bool(rec.check_out_photo),
            }
        else:
            if cur in holidays:
                status = AttendanceStatus.HOLIDAY
            elif is_week_off(cur):
                status = AttendanceStatus.WEEK_OFF
            elif cur > today:
                status = None
            else:
                status = AttendanceStatus.ABSENT
            entry = {"date": cur.isoformat(), "status": status, "check_in": None,
                     "check_out": None, "working_minutes": 0, "is_late": False,
                     "is_early_checkout": False, "missing_checkout": False}
            if cur in holidays:
                entry["holiday"] = holidays[cur]
        if status:
            totals[status] = totals.get(status, 0) + 1
        days.append(entry)
        cur += timedelta(days=1)

    return {
        "year": year, "month": month, "days": days, "totals": totals,
        "total_hours": round(total_minutes / 60, 1),
    }


def today_summary(users):
    """Admin/manager 'today' tiles for a set of employees."""
    today = timezone.localdate()
    records = {a.user_id: a for a in Attendance.objects.filter(user__in=users, date=today)}
    counts = {"present": 0, "late": 0, "leave": 0, "absent": 0, "half_day": 0, "not_checked_in": 0}
    rows = []
    for u in users:
        rec = records.get(u.id)
        if rec:
            status = rec.status
            counts[status] = counts.get(status, 0) + 1
            if status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE) and not rec.check_in:
                counts["not_checked_in"] += 1
        else:
            status = (AttendanceStatus.HOLIDAY if is_holiday(today)
                      else AttendanceStatus.WEEK_OFF if is_week_off(today)
                      else "not_checked_in")
            counts[status] = counts.get(status, 0) + 1
        rows.append({
            "user_id": u.id, "name": u.get_full_name() or u.username,
            "department": u.get_department_display(), "status": status,
            "check_in": rec.check_in if rec else None,
            "check_out": rec.check_out if rec else None,
            "working_minutes": rec.working_minutes if rec else 0,
            "attendance_id": rec.id if rec else None,
            "has_check_in_photo": bool(rec and rec.check_in_photo),
            "has_check_out_photo": bool(rec and rec.check_out_photo),
        })
    return {"date": today.isoformat(), "counts": counts, "rows": rows}
