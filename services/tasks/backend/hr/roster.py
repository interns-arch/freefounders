"""Roster management (founder 2026-10-30, PLAN.md §28): a person's shift for a date.

One rule for every attendance decision (punch late / early / half day, absent and "Not checked in", punch-in
reminders, regularization, leave days, payroll working days):

    1. the roster entry for that date (a working shift, or the Off shift)
    2. else the person's default shift (hours only; the company week-offs still make the weekday an off day)
    3. else the company office hours (HR settings) -- exactly the behaviour before rosters

Off day = a roster Off entry, or no roster entry on a company week-off weekday. A rostered working shift on a company
week-off weekday is a working day. A shift whose end is not after its start is overnight: it ends the next day, and
its punches belong to its start date. Holidays are decided elsewhere (they stay holidays).

`Book` reads the entries, defaults and shifts for many people and a date range once (three queries), so the month
screens and the reminder worker do not query per day.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from . import services
from .models import Attendance, PersonShift, RosterEntry, Shift

# Rest between two shifts below this many hours is a warning on the roster screen (never blocks).
DEFAULT_MIN_REST_HOURS = 11
# An open overnight day can still be punched out this long after its shift end.
OVERNIGHT_CHECKOUT_HOURS = 8


def _aware(day: date, t: time) -> datetime:
    return timezone.make_aware(datetime.combine(day, t), timezone.get_current_timezone())


@dataclass(frozen=True)
class DayPlan:
    """What a person is expected to work on one date."""
    day: date
    source: str                 # "roster" | "default" | "office"
    off: bool
    start: time | None
    end: time | None
    grace_minutes: int
    half_day_hours: float
    break_minutes: int = 0
    shift: Shift | None = None

    @property
    def overnight(self) -> bool:
        return bool(self.start and self.end and self.end <= self.start)

    @property
    def has_times(self) -> bool:
        return bool(self.start and self.end)

    def start_at(self) -> datetime | None:
        return _aware(self.day, self.start) if self.start else None

    def end_at(self) -> datetime | None:
        if not self.end:
            return None
        return _aware(self.day + timedelta(days=1 if self.overnight else 0), self.end)

    def late_after(self) -> datetime | None:
        s = self.start_at()
        return s + timedelta(minutes=self.grace_minutes) if s else None

    def length_minutes(self) -> int:
        if not self.has_times:
            return 0
        return max(0, int((self.end_at() - self.start_at()).total_seconds() // 60) - self.break_minutes)

    def start_text(self) -> str:
        return self.start.strftime("%H:%M") if self.start else ""

    def end_text(self) -> str:
        return self.end.strftime("%H:%M") if self.end else ""

    def brief(self) -> dict | None:
        """The shift for the screens; None for plain office hours (the answer stays as before rosters)."""
        if self.source == "office":
            return None
        s = self.shift
        return {"id": s.id, "code": s.code, "name": s.name, "colour": s.colour, "is_off": s.is_off,
                "start": self.start_text(), "end": self.end_text(), "overnight": self.overnight,
                "source": self.source, "off": self.off}


def shift_label(shift: Shift) -> str:
    """"Night 22:00–06:00" / "Off"."""
    if shift.is_off or not shift.start or not shift.end:
        return shift.name
    return f"{shift.name} {shift.start:%H:%M}–{shift.end:%H:%M}"


class Book:
    """Roster entries, default shifts and company rules for some people over a date range, read once."""

    def __init__(self, user_ids, first: date, last: date, conf=None):
        self.conf = conf or services.cfg()
        self.week_offs = set(self.conf["week_offs"])
        self.office_start = services._parse_hhmm(self.conf["work_start"], time(9, 30))
        self.office_end = services._parse_hhmm(self.conf["work_end"], time(18, 30))
        ids = list(user_ids)
        self.entries = {}
        self.defaults = {}
        if ids:
            for e in RosterEntry.objects.filter(user_id__in=ids, date__range=(first, last)).select_related("shift"):
                self.entries[(e.user_id, e.date)] = e.shift
            for d in PersonShift.objects.filter(user_id__in=ids).select_related("shift"):
                self.defaults[d.user_id] = d.shift

    def _from_shift(self, day, shift, source, off) -> DayPlan:
        grace = shift.grace_minutes if shift.grace_minutes is not None else self.conf["grace_minutes"]
        half = shift.half_day_hours if shift.half_day_hours is not None else self.conf["half_day_hours"]
        return DayPlan(day=day, source=source, off=off, start=shift.start, end=shift.end, grace_minutes=grace,
                       half_day_hours=half, break_minutes=shift.break_minutes, shift=shift)

    def plan(self, user_id, day: date) -> DayPlan:
        shift = self.entries.get((user_id, day))
        if shift is not None:
            if shift.is_off:
                return DayPlan(day=day, source="roster", off=True, start=None, end=None,
                               grace_minutes=self.conf["grace_minutes"], half_day_hours=self.conf["half_day_hours"],
                               shift=shift)
            return self._from_shift(day, shift, "roster", False)
        week_off = day.weekday() in self.week_offs
        default = self.defaults.get(user_id)
        if default is not None and not default.is_off:
            return self._from_shift(day, default, "default", week_off)
        return DayPlan(day=day, source="office", off=week_off, start=self.office_start, end=self.office_end,
                       grace_minutes=self.conf["grace_minutes"], half_day_hours=self.conf["half_day_hours"])

    def is_off(self, user_id, day: date) -> bool:
        return self.plan(user_id, day).off


def plan_for(user, day: date, conf=None) -> DayPlan:
    uid = getattr(user, "pk", user)
    return Book([uid], day, day, conf).plan(uid, day)


def is_off_day(user, day: date) -> bool:
    return plan_for(user, day).off


def working_days(user, first: date, last: date, holidays=None) -> list[date]:
    """The person's working days in the range: not off, not a holiday."""
    from crm.models import Holiday
    if holidays is None:
        holidays = set(Holiday.objects.filter(date__range=(first, last)).values_list("date", flat=True))
    uid = getattr(user, "pk", user)
    book = Book([uid], first, last)
    out, cur = [], first
    while cur <= last:
        if cur not in holidays and not book.is_off(uid, cur):
            out.append(cur)
        cur += timedelta(days=1)
    return out


def punch_day(user, now=None) -> date:
    """The date a punch made now belongs to: yesterday while yesterday's overnight shift is still open (punched in
    and not out, up to OVERNIGHT_CHECKOUT_HOURS after its end), or not started yet and before its end (a late
    arrival after midnight); else today."""
    now = timezone.localtime(now or timezone.now())
    today = now.date()
    yesterday = today - timedelta(days=1)
    plan = plan_for(user, yesterday)
    if plan.off or not plan.overnight:
        return today
    rec = Attendance.objects.filter(user=user, date=yesterday).only("check_in", "check_out", "status").first()
    if rec and rec.check_in:
        if not rec.check_out and now < plan.end_at() + timedelta(hours=OVERNIGHT_CHECKOUT_HOURS):
            return yesterday
        return today
    if now < plan.end_at() and not (rec and rec.status not in ("present", "late")):
        return yesterday
    return today


def overtime_minutes(plan: DayPlan, worked_minutes: int) -> int:
    """Minutes worked beyond the shift's length (0 without a shift length or on an off day: that is all extra)."""
    if not worked_minutes:
        return 0
    if plan.off:
        return int(worked_minutes)
    length = plan.length_minutes()
    return max(0, int(worked_minutes) - length) if length else 0


def min_rest_hours() -> int:
    from tenancy.company_settings import company_env
    try:
        return max(0, min(24, int(company_env("ROSTER_MIN_REST_HOURS", str(DEFAULT_MIN_REST_HOURS)))))
    except (TypeError, ValueError):
        return DEFAULT_MIN_REST_HOURS


def rest_warnings(book: Book, user_ids, first: date, last: date, min_hours=None) -> list[dict]:
    """Two working days in a row with less rest than `min_hours` between the end of one and the start of the next."""
    min_hours = min_rest_hours() if min_hours is None else min_hours
    if not min_hours:
        return []
    out = []
    for uid in user_ids:
        cur = first - timedelta(days=1)
        prev = book.plan(uid, cur)
        while cur < last:
            cur += timedelta(days=1)
            plan = book.plan(uid, cur)
            if not prev.off and not plan.off and prev.has_times and plan.has_times:
                rest = (plan.start_at() - prev.end_at()).total_seconds() / 3600
                if rest < min_hours and (prev.source == "roster" or plan.source == "roster"):
                    out.append({"user": uid, "date": cur.isoformat(), "rest_hours": round(max(rest, 0), 1),
                                "message": f"Only {max(rest, 0):.1f} h rest before this shift (less than {min_hours} h)."})
            prev = plan
    return out
