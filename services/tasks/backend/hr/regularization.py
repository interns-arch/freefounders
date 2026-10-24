"""Attendance regularization (PLAN.md §19.38): the person asks for a past day (or today after the shift) to be fixed,
an approver decides, and on approval the day is rewritten with the HR rules.

It grew out of the attendance corrections ("I forgot to check out"): same table (`AttendanceCorrection`), same
endpoint (`/attendance-corrections/`), same approvers and reminders (approvals.py, PLAN.md §17.2). New: a reason type,
an attachment, several days at once, the company's policy (on/off, reasons, monthly limit, how far back, what an
approved day counts as, auto-approve reasons), the from -> to of every approved change, and the "Regularized" tag on
the day.

Policy (HR settings, per company; `services.cfg()`):
  reg_enabled        on (default) / off
  reg_reasons        the reasons people may pick (default: all)
  reg_monthly_limit  requests (one per day) per person per period, pending + approved; default 3, 0 = unlimited; any
                     number (2026-10-24: no cap but a sanity maximum)
  reg_limit_period   month (default) / week (Monday to Sunday) / year: what the limit counts
  reg_person_limits  a different limit for some people {user id: limit, 0 = unlimited}; used instead of the company's
  reg_days_back      how many days back a day may be asked for; default 7, any number (0 = only today after the
                     shift). Never a future day; today only after the shift has ended.
  reg_mark           times (default): the day's status comes from the times like a punch (present / late / half day);
                     present: an approved day is always Present
Every request needs a person's approval (founder, 2026-10-24: no auto-approve); nothing changes in attendance until then.
Who approves: the person's reporting manager (People directory reports-to), who is told and sees it in Approvals ->
Regularization. Without a manager it goes to the people with the approve-attendance permission for them (HR / Admin /
Owner), who can also decide any request in their scope. Reminders and escalation to HR after APPROVAL_REMIND_HOURS.

HR adds (2026-10-24, `add_for`): whoever may decide a person's requests (the reporting manager, or an approver whose
scope covers them) can regularize a day for that person directly. It is applied at once (approved by them, the day
worked out again exactly like an approval), is not counted in the person's limit, ignores the days-back window (never a
future day), tells the person, and is kept with `added_by`. Nobody does it for themselves except the Owner (§19.24).
"""
import uuid
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import services
from .models import (
    Attendance, AttendanceCorrection, AttendanceStatus, CorrectionStatus, LeaveRequest, LeaveStatus,
    RegularizationReason,
)

REASON_LABELS = dict(RegularizationReason.choices)
# Reasons that need no times: the shift's hours are used.
SHIFT_REASONS = {"on_duty", "wfh"}
# What the day is called once approved for these reasons (shown next to the status; counted as present).
MODE_LABELS = {"on_duty": "On duty", "wfh": "WFH"}
MAX_RANGE_DAYS = 15
DISABLED = "Regularization is switched off for your company."


def _refuse(message, code):
    raise ValidationError({"detail": message, "code": code})


def _name(user) -> str:
    return user.get_full_name() or user.username


# How each limit period reads: (refusal title, "a month", "this month").
PERIOD_WORDS = {"month": ("Monthly", "a month", "this month"), "week": ("Weekly", "a week", "this week"),
                "year": ("Yearly", "a year", "this year")}


def period_bounds(day, period="month"):
    """First and last day of the period the day falls in: the calendar month, the week (Monday to Sunday) or the year."""
    if period == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if period == "year":
        return day.replace(month=1, day=1), day.replace(month=12, day=31)
    first = day.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first, nxt - timedelta(days=1)


def period_label(day, period="month") -> str:
    start, _ = period_bounds(day, period)
    if period == "week":
        return f"the week of {start:%d-%m-%Y}"
    if period == "year":
        return str(day.year)
    return f"{day:%B %Y}"


def used_in_period(user, day, period="month", exclude_ids=()) -> int:
    """The person's own requests (one per day) pending or approved in that day's period. Days HR added for them
    (`added_by`) never count."""
    first, last = period_bounds(day, period)
    return (AttendanceCorrection.objects
            .filter(user=user, date__range=(first, last), added_by__isnull=True,
                    status__in=[CorrectionStatus.PENDING, CorrectionStatus.APPROVED])
            .exclude(pk__in=list(exclude_ids)).count())


def used_in_month(user, day, exclude_ids=()) -> int:
    """Requests (one per day) the person has pending or approved in that day's calendar month."""
    return used_in_period(user, day, "month", exclude_ids)


def limit_for(user, conf=None) -> tuple:
    """(the person's limit, whether it is their own): their per-person limit if HR set one, else the company's.
    0 = unlimited."""
    conf = conf or services.cfg()
    own = conf["reg_person_limits"]
    if user.pk in own:
        return own[user.pk], True
    return conf["reg_monthly_limit"], False


def today_shift_ended(conf=None) -> bool:
    conf = conf or services.cfg()
    end = services._parse_hhmm(conf["work_end"], time(18, 30))
    return timezone.localtime().time() >= end


def policy_for(user) -> dict:
    """What the request form needs: the policy and how many requests are left this month."""
    conf = services.cfg()
    today = timezone.localdate()
    period = conf["reg_limit_period"]
    limit, personal = limit_for(user, conf)
    used = used_in_period(user, today, period)
    left = None if not limit else max(0, limit - used)
    return {
        "enabled": conf["reg_enabled"],
        "reasons": [{"value": c, "label": REASON_LABELS[c]} for c in conf["reg_reasons"]],
        # The person's limit per period (their own when HR set one), used and left in the current period.
        "limit": limit,
        "period": period,
        "personal_limit": personal,
        "used": used,
        "left": left,
        # Older screens: the same numbers under their first names.
        "monthly_limit": limit,
        "used_this_month": used,
        "left_this_month": left,
        "days_back": conf["reg_days_back"],
        "earliest": (today - timedelta(days=conf["reg_days_back"])).isoformat(),
        "mark": conf["reg_mark"],
        "work_start": conf["work_start"],
        "work_end": conf["work_end"],
        "shift_ended": today_shift_ended(conf),
    }


def _at(day, hhmm):
    """An aware datetime for a day + time in the company's time zone."""
    return timezone.make_aware(datetime.combine(day, hhmm), timezone.get_current_timezone())


def parse_hhmm(text, field):
    if text in (None, ""):
        return None
    try:
        h, m = str(text).strip().split(":")[:2]
        return time(int(h), int(m))
    except (TypeError, ValueError):
        raise ValidationError({field: "Use a time like 09:30."})


def days_of(start, end):
    """The days asked for: one day as it is; a range without its week-offs and holidays."""
    if end is None or end == start:
        return [start]
    if end < start:
        raise ValidationError({"end_date": "The end date is before the start date."})
    if (end - start).days >= MAX_RANGE_DAYS:
        raise ValidationError({"end_date": f"Ask for at most {MAX_RANGE_DAYS} days at once."})
    days = services.leave_working_days(start, end)
    if not days:
        raise ValidationError({"end_date": "That range has only week-offs and holidays."})
    return days


def _checked(user, data, conf, direct=False):
    """The checks shared by a person's request and a day HR adds (`direct`): reason, times, the days. A direct add
    skips the company's on/off switch, the allowed reasons, the days-back window and "today only after the shift"
    (never a future day). Returns (reason_type, note, days, wanted(day))."""
    if not direct and not conf["reg_enabled"]:
        _refuse(DISABLED, "disabled")
    reason_type = data.get("reason_type") or "other"
    if reason_type not in REASON_LABELS:
        raise ValidationError({"reason_type": "Pick a reason."})
    if not direct and reason_type not in conf["reg_reasons"]:
        raise ValidationError({"reason_type": f"“{REASON_LABELS[reason_type]}” is not a reason your company allows."})
    note = (data.get("reason") or "").strip()
    if reason_type == "other" and not note:
        raise ValidationError({"reason": "Say what happened (needed for “Other”)."})

    today = timezone.localdate()
    days = days_of(data["date"], data.get("end_date"))
    in_t = parse_hhmm(data.get("check_in_time"), "check_in_time")
    out_t = parse_hhmm(data.get("check_out_time"), "check_out_time")
    # An older client sends full date-times for one day: kept exactly (a shift may end after midnight).
    full_in, full_out = data.get("requested_check_in"), data.get("requested_check_out")
    if len(days) > 1 or in_t or out_t:
        full_in = full_out = None
    if not (in_t or out_t or full_in or full_out):
        if reason_type in SHIFT_REASONS:
            in_t = services._parse_hhmm(conf["work_start"], time(9, 30))
            out_t = services._parse_hhmm(conf["work_end"], time(18, 30))
        else:
            raise ValidationError({"detail": "Give the check-in or check-out time to correct.", "code": "times"})

    def wanted(day):
        """(check-in, check-out) asked for on that day as aware date-times (None = keep the recorded one)."""
        return (full_in or (_at(day, in_t) if in_t else None), full_out or (_at(day, out_t) if out_t else None))

    first_in, first_out = wanted(days[0])
    if first_in and first_out and first_out <= first_in:
        raise ValidationError({"check_out_time": "Check-out must be after check-in.", "code": "times"})

    earliest = today - timedelta(days=conf["reg_days_back"])
    existing = {a.date: a for a in Attendance.objects.filter(user=user, date__in=days)}
    pending = set(AttendanceCorrection.objects.filter(user=user, date__in=days, status=CorrectionStatus.PENDING)
                  .values_list("date", flat=True))
    on_leave = set()
    for lv in LeaveRequest.objects.filter(user=user, status=LeaveStatus.APPROVED,
                                          start_date__lte=days[-1], end_date__gte=days[0]):
        on_leave |= {d for d in days if lv.start_date <= d <= lv.end_date and not lv.half_day}
    for day in days:
        if day > today:
            _refuse("A future day cannot be regularized.", "future")
        if not direct and day == today and not today_shift_ended(conf):
            _refuse(f"Today can be regularized after the shift ends ({conf['work_end']}).", "shift_not_over")
        if not direct and day < earliest:
            _refuse(f"Regularization is allowed for the last {conf['reg_days_back']} day(s) only "
                    f"(from {earliest:%d-%m-%Y}).", "too_far_back")
        if day in pending:
            if direct:
                _refuse(f"{_name(user)} has a pending request for {day:%d-%m-%Y}: approve or reject it in Approvals.",
                        "duplicate")
            _refuse(f"You already have a pending request for {day:%d-%m-%Y}.", "duplicate")
        if day in on_leave:
            _refuse(f"{day:%d-%m-%Y} is approved leave; cancel the leave instead.", "leave")
        rec = existing.get(day)
        ask_in, ask_out = wanted(day)
        if ask_out and not ask_in and not (rec and rec.check_in):
            raise ValidationError({"check_in_time": f"There is no check-in on {day:%d-%m-%Y}: give the check-in time too.",
                                   "code": "times"})
        if ask_out and not ask_in and ask_out <= rec.check_in:
            raise ValidationError({"check_out_time": "Check-out must be after the recorded check-in.", "code": "times"})
        if ask_in and not ask_out and rec and rec.check_out and ask_in >= rec.check_out:
            raise ValidationError({"check_in_time": "Check-in must be before the recorded check-out.", "code": "times"})
        if max(t for t in (ask_in, ask_out) if t) > timezone.now() + timedelta(minutes=1):
            raise ValidationError({"check_out_time": "That time has not come yet.", "code": "times"})
    return reason_type, note, days, wanted


def create_requests(user, data, attachment=None) -> list:
    """Checks the policy and stores one request per day (all pending: every request is approved by a person). Raises ValidationError with a message (and `code`) the person can act on."""
    conf = services.cfg()
    reason_type, note, days, wanted = _checked(user, data, conf)

    limit, _ = limit_for(user, conf)
    period = conf["reg_limit_period"]
    if limit:
        title, a_period, _ = PERIOD_WORDS[period]
        for start in sorted({period_bounds(d, period)[0] for d in days}):
            asked = sum(1 for d in days if period_bounds(d, period)[0] == start)
            used = used_in_period(user, start, period)
            if used + asked > limit:
                left = max(0, limit - used)
                # The code keeps its first name (screens and the e2e read it) whatever the period.
                _refuse(f"{title} limit reached: you can raise {limit} regularization request(s) {a_period} and have "
                        f"used {used} in {period_label(start, period)} ({left} left)."
                        + (f" This request needs {asked}." if asked > 1 else ""), "monthly_limit")

    batch = uuid.uuid4().hex if len(days) > 1 else ""
    created = []
    with transaction.atomic():
        for day in days:
            ask_in, ask_out = wanted(day)
            c = AttendanceCorrection(user=user, date=day, reason_type=reason_type, reason=note[:1000], batch=batch,
                                     requested_check_in=ask_in, requested_check_out=ask_out)
            if attachment and not created:
                c.attachment = attachment
            elif attachment:
                c.attachment = created[0].attachment.name   # one stored file, shared by the days of the range
            c.save()
            created.append(c)
    from . import approvals
    approvals.notify_submitted("correction", created[0])
    return created


def check_adder(actor, target):
    """Who may regularize a day for someone directly: whoever may decide that person's requests (the reporting manager,
    or an approver whose scope covers them). Nobody for themselves, except the Owner (PLAN.md §19.24)."""
    from accounts.access import is_owner
    from accounts.permissions import SELF_EDIT_MESSAGE
    if target is None:
        raise ValidationError({"user": "Pick a person."})
    if target.pk == actor.pk:
        if is_owner(actor):
            return
        raise PermissionDenied(SELF_EDIT_MESSAGE)
    if not may_review(actor, target):
        raise PermissionDenied("You cannot regularize attendance for this person.")


def addable_users(actor):
    """The people this person may regularize for (the "Regularize for someone" picker): the people whose requests they
    decide, plus themselves for the Owner."""
    from accounts.access import is_owner
    from accounts.models import User
    ids = set(reviewable_users(actor).exclude(pk=actor.pk).values_list("pk", flat=True))
    if is_owner(actor):
        ids.add(actor.pk)
    return User.objects.filter(pk__in=ids)


def add_for(actor, target, data, attachment=None) -> list:
    """HR / a manager regularizes days for a person: applied at once (approved by the actor, the day worked out again
    like an approval, from -> to kept), not counted in the person's limit, any past day (never a future one). The
    person is told."""
    check_adder(actor, target)
    conf = services.cfg()
    reason_type, note, days, wanted = _checked(target, data, conf, direct=True)
    batch = uuid.uuid4().hex if len(days) > 1 else ""
    now = timezone.now()
    created = []
    with transaction.atomic():
        for day in days:
            ask_in, ask_out = wanted(day)
            c = AttendanceCorrection(user=target, date=day, reason_type=reason_type, reason=note[:1000], batch=batch,
                                     requested_check_in=ask_in, requested_check_out=ask_out,
                                     status=CorrectionStatus.APPROVED, reviewed_by=actor, reviewed_at=now,
                                     added_by=actor)
            if attachment and not created:
                c.attachment = attachment
            elif attachment:
                c.attachment = created[0].attachment.name
            c.save()          # the day links to it
            apply(c, actor)
            c.save()
            created.append(c)
    if target.pk != actor.pk:
        from notifications.service import notify
        when = f"{days[0]:%d-%m-%Y}" if len(days) == 1 else f"{days[0]:%d-%m-%Y} to {days[-1]:%d-%m-%Y}"
        notify(target, "correction_reviewed", f"Attendance regularized: {when}",
               f"{REASON_LABELS.get(reason_type, '')}: added by {_name(actor)}" + (f"\nNote: {note}" if note else ""),
               link=my_link(created[0]), link_label="Open the day")
    return created


def apply(c: AttendanceCorrection, by=None) -> Attendance:
    """Writes an approved request into the day: times, hours, late / early flags and status with the HR rules. The day
    as it was is kept on the request (original_*), with the status it got (applied_status)."""
    conf = services.cfg()
    rec = Attendance.objects.filter(user=c.user, date=c.date).first()
    c.original_check_in = rec.check_in if rec else None
    c.original_check_out = rec.check_out if rec else None
    c.original_status = rec.status if rec else AttendanceStatus.ABSENT
    rec = rec or Attendance(user=c.user, date=c.date)
    if c.requested_check_in:
        rec.check_in = c.requested_check_in
    if c.requested_check_out:
        rec.check_out = c.requested_check_out
    start = services._parse_hhmm(conf["work_start"], time(9, 30))
    end = services._parse_hhmm(conf["work_end"], time(18, 30))
    late_cutoff = (datetime.combine(c.date, start) + timedelta(minutes=conf["grace_minutes"])).time()
    rec.working_minutes = (max(0, int((rec.check_out - rec.check_in).total_seconds() // 60))
                           if rec.check_in and rec.check_out else 0)
    if conf["reg_mark"] == "present":
        rec.is_late = rec.is_early_checkout = False
        rec.status = AttendanceStatus.PRESENT
    else:
        rec.is_late = bool(rec.check_in and timezone.localtime(rec.check_in).time() > late_cutoff)
        rec.is_early_checkout = bool(rec.check_out and timezone.localtime(rec.check_out).time() < end)
        if rec.check_in and rec.check_out and rec.working_minutes / 60 < conf["half_day_hours"]:
            rec.status = AttendanceStatus.HALF_DAY
        elif rec.is_late:
            rec.status = AttendanceStatus.LATE
        else:
            rec.status = AttendanceStatus.PRESENT
    rec.leave_request = None
    label = REASON_LABELS.get(c.reason_type, "")
    rec.note = f"Regularized by {_name(by)}: {label}"[:300]
    rec.regularization = c
    rec.save()
    c.applied_status = rec.status
    return rec


def my_link(c) -> str:
    """The person's My attendance on the day of the request (Tasks-relative like every Tasks link, PLAN.md §19.37)."""
    return f"/hr?tab=history&date={c.date.isoformat()}&regularization={c.pk}"


def decide(c: AttendanceCorrection, reviewer, decision: str, remarks: str = ""):
    """Approve (the day is rewritten) or reject one pending request; the person is told."""
    if c.status != CorrectionStatus.PENDING:
        raise ValidationError({"detail": "This request has already been reviewed."})
    if decision not in (CorrectionStatus.APPROVED, CorrectionStatus.REJECTED):
        raise ValidationError({"decision": "Use 'approved' or 'rejected'."})
    with transaction.atomic():
        c.status = decision
        c.reviewed_by = reviewer
        c.reviewed_at = timezone.now()
        c.remarks = str(remarks or "")[:300]
        if decision == CorrectionStatus.APPROVED:
            apply(c, reviewer)
        c.save()
    from notifications.service import notify
    word = "approved" if decision == CorrectionStatus.APPROVED else "rejected"
    who = _name(reviewer)
    notify(c.user, "correction_reviewed", f"Regularization {word}: {c.date:%d-%m-%Y}",
           f"{REASON_LABELS.get(c.reason_type, '')}: {word} by {who}"
           + (f"\nRemarks: {c.remarks}" if c.remarks else ""),
           link=my_link(c), link_label="Open the day")
    return c


def approvers_for(target) -> list:
    """Who is told about (and reminded of) a request: the reporting manager; without one, the people with the
    approve-attendance permission for that person (their department's approvers, else the company-wide ones)."""
    from . import approvals
    manager = approvals.manager_of(target)
    if manager:
        return [manager]
    from accounts.access import users_with
    people = list((users_with("hr.approve") | users_with("hr.approve_all")).distinct()
                  .filter(department=target.department).exclude(pk=target.pk))
    return people or list(users_with("hr.approve_all").exclude(pk=target.pk))


def may_review(reviewer, target) -> bool:
    """The reporting manager, or an approver whose scope covers the person (HR / Admin / Owner)."""
    from . import approvals
    if reviewer.pk == target.pk:
        return False
    if approvals.manager_of(target) == reviewer:
        return True
    return approvals.is_approver(reviewer) and approvals.may_review(reviewer, target)


def reviewable_users(reviewer):
    """Whose requests this person sees in Approvals -> Regularization: their approving scope plus their direct reports."""
    from accounts.models import User

    from . import approvals
    from django.db.models import Q
    cond = Q(is_active=True, reporting_manager=reviewer)
    if approvals.is_approver(reviewer):
        cond |= Q(pk__in=approvals.reviewable_users(reviewer).values("pk"))
    return User.objects.filter(cond)


def is_reviewer(user) -> bool:
    """Should this person see Approvals (for regularization)? Approvers, and anyone people report to."""
    from . import approvals
    return approvals.is_approver(user) or user.reports.filter(is_active=True).exists()


def check_reviewer(reviewer, c):
    """Who may decide a request: the person's reporting manager or an approver for them (their scope), never for their
    own request -- except the Owner, who may change their own attendance (PLAN.md §19.24)."""
    from accounts.access import is_owner

    from .views import _self_review_message
    if c is None:
        raise PermissionDenied("You cannot review this request.")
    if c.user_id == reviewer.id:
        if is_owner(reviewer):
            return
        raise PermissionDenied(_self_review_message(reviewer))
    if not may_review(reviewer, c.user):
        raise PermissionDenied("You cannot review this request.")


def day_context(c) -> dict:
    """The day as recorded now, for the approver: status, times, hours, and how far from the office the check-in was."""
    rec = Attendance.objects.filter(user_id=c.user_id, date=c.date).select_related("location").first()
    base = {"month_requests": used_in_month(c.user, c.date)}
    if not rec:
        return {**base, "status": None, "check_in": None, "check_out": None, "working_minutes": 0,
                "location_name": None, "distance_m": None}
    distance = None
    if rec.check_in_lat is not None and rec.check_in_lng is not None:
        office = rec.location
        if office is None:
            from .models import OfficeLocation
            office = min(OfficeLocation.objects.filter(active=True),
                         key=lambda o: services.haversine_m(rec.check_in_lat, rec.check_in_lng, o.latitude, o.longitude),
                         default=None)
        if office is not None:
            distance = round(services.haversine_m(rec.check_in_lat, rec.check_in_lng, office.latitude, office.longitude))
    return {**base, "status": rec.status, "check_in": rec.check_in, "check_out": rec.check_out,
            "working_minutes": rec.working_minutes, "location_name": rec.location.name if rec.location else None,
            "distance_m": distance}
