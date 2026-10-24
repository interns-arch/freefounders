"""Punch-in reminders from the server (founder 2026-10-24, PLAN.md §19.39).

"Attendance reminder every 3 times after every 30 min from reporting time if not marked, leave": a person who has not
punched in by the reporting time (the company's work start) gets reminder 1 at reporting + 30 min, 2 at + 60, 3 at
+ 90, and nothing once they punch in. Count, gap and the first delay are company settings (HR settings → Punch-in
reminders; `cfg()["punch_reminder_*"]`), on by default.

Nobody is reminded on a holiday or weekly off, on approved leave (a LEAVE day or an approved request covering today),
after work end, when HR already marked the day (absent / half day ...), when inactive (exited), or without the
"attendance.punch" permission (the company does not track their attendance).

Each reminder is an AttendanceReminderLog row, unique per (person, day, n): it is written before anything is sent, so
a restart, a second worker or a re-run never sends it twice and never more than the count. The worker runs every 5
minutes; a reminder is due when its slot has passed AND `gap` minutes have passed since the previous one, so a
worker that was down sends one catch-up, then the next one a gap later, not a burst.

Channels: the in-app notification (area Attendance, opens /attendance = Punch in) and the company's WhatsApp when it
is configured and the notification rule "Punch-in reminders" allows it (email off unless switched on there). The phone
app's own local reminders follow the same rule (web reminder.tsx, PLAN.md §19.32/§19.39).
"""
import logging
from datetime import datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone

from .models import Attendance, AttendanceReminderLog, AttendanceStatus, LeaveRequest, LeaveStatus
from . import services

log = logging.getLogger(__name__)

NOTIFICATION_TYPE = "punch_reminder"
LINK = "/hr?tab=today"          # web: /tasks/hr → /attendance (Today, the Punch in button)
# A day row without a check-in still counts as "not punched in" only with these statuses (a fresh row is "present");
# leave, holiday, week off, absent or half day set by HR mean the day is decided.
OPEN_STATUSES = (AttendanceStatus.PRESENT, AttendanceStatus.LATE)


def rule(conf=None) -> dict:
    conf = conf or services.cfg()
    return {
        "enabled": conf["punch_reminders"],
        "count": conf["punch_reminder_count"],
        "gap_minutes": conf["punch_reminder_gap"],
        "first_after_minutes": conf["punch_reminder_first"],
        "reporting_time": conf["work_start"],
    }


def _at(day, t: time) -> datetime:
    return timezone.make_aware(datetime.combine(day, t), timezone.get_current_timezone())


def slots(day, conf=None) -> list[datetime]:
    """When reminders 1..count are due on `day` (aware datetimes)."""
    r = rule(conf)
    start = services._parse_hhmm(r["reporting_time"], time(9, 30))
    first = _at(day, start) + timedelta(minutes=r["first_after_minutes"])
    return [first + timedelta(minutes=r["gap_minutes"] * i) for i in range(r["count"])]


def due_number(now, sent: int, last_sent_at, day_slots, gap_minutes: int) -> int:
    """The reminder number to send now (0 = none): the next one after `sent`, when its slot has passed and, after an
    earlier one, `gap` minutes have passed since it (a late worker catches up with one, not a burst)."""
    n = sent + 1
    if n > len(day_slots) or now < day_slots[n - 1]:
        return 0
    if sent and last_sent_at and now < last_sent_at + timedelta(minutes=gap_minutes):
        return 0
    return n


def day_off_reason(user, day) -> str | None:
    """'holiday' | 'week_off' | 'leave' when nobody (or this person) is expected to punch in on `day`."""
    if services.is_holiday(day):
        return "holiday"
    if services.is_week_off(day):
        return "week_off"
    if user is not None and _on_leave_ids([user.id], day):
        return "leave"
    return None


def _on_leave_ids(user_ids, day) -> set:
    ids = set(Attendance.objects.filter(user_id__in=user_ids, date=day, status=AttendanceStatus.LEAVE)
              .values_list("user_id", flat=True))
    ids |= set(LeaveRequest.objects.filter(user_id__in=user_ids, status=LeaveStatus.APPROVED,
                                           start_date__lte=day, end_date__gte=day).values_list("user_id", flat=True))
    return ids


def sent_today(user_ids, day) -> dict:
    """{user_id: number of reminders sent on `day`}."""
    return dict(AttendanceReminderLog.objects.filter(user_id__in=user_ids, date=day)
                .values("user_id").annotate(n=Max("n")).values_list("user_id", "n"))


def message(n: int, count: int, reporting_time: str) -> str:
    from tenancy.profile import app_name, brand

    name = "Kaampilot" if brand() else app_name()
    return (f"Reminder {n} of {count}: you have not punched in yet today (reporting time {reporting_time}). "
            f"Open {name} to punch in.")


def send_punch_reminders(now=None) -> int:
    """One pass for the current company (or the standalone install). Returns how many reminders went out."""
    from accounts.models import User
    from accounts.permissions import has_capability
    from notifications.service import notify

    conf = services.cfg()
    r = rule(conf)
    if not r["enabled"]:
        return 0
    now = now or timezone.now()
    day = timezone.localtime(now).date()
    if services.is_holiday(day) or services.is_week_off(day):
        return 0
    day_slots = slots(day, conf)
    if now < day_slots[0]:
        return 0
    start = _at(day, services._parse_hhmm(conf["work_start"], time(9, 30)))
    end = _at(day, services._parse_hhmm(conf["work_end"], time(18, 30)))
    if end > start and now >= end:
        return 0  # the working day is over: a punch-in reminder is no longer useful

    people = list(User.objects.filter(is_active=True))
    if not people:
        return 0
    ids = [u.id for u in people]
    decided = set()
    for rec in Attendance.objects.filter(user_id__in=ids, date=day).only("user_id", "check_in", "status"):
        if rec.check_in or rec.status not in OPEN_STATUSES:
            decided.add(rec.user_id)
    decided |= _on_leave_ids(ids, day)
    last = {row["user_id"]: (row["n"], row["at"]) for row in
            AttendanceReminderLog.objects.filter(user_id__in=ids, date=day)
            .values("user_id").annotate(n=Max("n"), at=Max("sent_at"))}

    sent = 0
    for user in people:
        if user.id in decided:
            continue
        done, last_at = last.get(user.id, (0, None))
        n = due_number(now, done, last_at, day_slots, r["gap_minutes"])
        if not n or not has_capability(user, "attendance.punch"):
            continue
        try:
            with transaction.atomic():
                entry = AttendanceReminderLog.objects.create(user=user, date=day, n=n, sent_at=now)
        except IntegrityError:
            continue  # another worker sent this one
        try:
            note = notify(user, NOTIFICATION_TYPE, message(n, r["count"], conf["work_start"]), "", link=LINK,
                          outside_hours="skip", category="attendance")
            entry.channels = [{"channel": "in_app", "status": "sent", "id": note.id}, *(note.channels or [])]
            entry.save(update_fields=["channels"])
        except Exception:  # noqa: BLE001 -- one person's failure must not stop the others; the row stays (no retry burst)
            log.exception("punch reminder %s for user %s failed", n, user.id)
            continue
        sent += 1
    return sent
