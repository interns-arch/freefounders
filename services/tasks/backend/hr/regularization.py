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
  reg_monthly_limit  requests (one per day) per person per calendar month, pending + approved; default 3, 0 = unlimited
  reg_days_back      how many days back a day may be asked for; default 7. Never a future day; today only after the
                     shift has ended.
  reg_mark           times (default): the day's status comes from the times like a punch (present / late / half day);
                     present: an approved day is always Present
Every request needs a person's approval (founder, 2026-10-24: no auto-approve); nothing changes in attendance until then.
Who approves: the person's reporting manager (People directory reports-to), who is told and sees it in Approvals ->
Regularization. Without a manager it goes to the people with the approve-attendance permission for them (HR / Admin /
Owner), who can also decide any request in their scope. Reminders and escalation to HR after APPROVAL_REMIND_HOURS.
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


def used_in_month(user, day, exclude_ids=()) -> int:
    """Requests (one per day) the person has pending or approved in that day's calendar month."""
    return (AttendanceCorrection.objects
            .filter(user=user, date__year=day.year, date__month=day.month,
                    status__in=[CorrectionStatus.PENDING, CorrectionStatus.APPROVED])
            .exclude(pk__in=list(exclude_ids)).count())


def today_shift_ended(conf=None) -> bool:
    conf = conf or services.cfg()
    end = services._parse_hhmm(conf["work_end"], time(18, 30))
    return timezone.localtime().time() >= end


def policy_for(user) -> dict:
    """What the request form needs: the policy and how many requests are left this month."""
    conf = services.cfg()
    today = timezone.localdate()
    limit = conf["reg_monthly_limit"]
    used = used_in_month(user, today)
    return {
        "enabled": conf["reg_enabled"],
        "reasons": [{"value": c, "label": REASON_LABELS[c]} for c in conf["reg_reasons"]],
        "monthly_limit": limit,
        "used_this_month": used,
        "left_this_month": None if not limit else max(0, limit - used),
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


def create_requests(user, data, attachment=None) -> list:
    """Checks the policy and stores one request per day (all pending: every request is approved by a person). Raises ValidationError with a message (and `code`) the person can act on."""
    conf = services.cfg()
    if not conf["reg_enabled"]:
        _refuse(DISABLED, "disabled")
    reason_type = data.get("reason_type") or "other"
    if reason_type not in REASON_LABELS:
        raise ValidationError({"reason_type": "Pick a reason."})
    if reason_type not in conf["reg_reasons"]:
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
        if day == today and not today_shift_ended(conf):
            _refuse(f"Today can be regularized after the shift ends ({conf['work_end']}).", "shift_not_over")
        if day < earliest:
            _refuse(f"Regularization is allowed for the last {conf['reg_days_back']} day(s) only "
                    f"(from {earliest:%d-%m-%Y}).", "too_far_back")
        if day in pending:
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

    limit = conf["reg_monthly_limit"]
    if limit:
        for month_day in sorted({d.replace(day=1) for d in days}):
            asked = sum(1 for d in days if (d.year, d.month) == (month_day.year, month_day.month))
            used = used_in_month(user, month_day)
            if used + asked > limit:
                left = max(0, limit - used)
                _refuse(f"Monthly limit reached: you can raise {limit} regularization request(s) a month and have used "
                        f"{used} in {month_day:%B %Y} ({left} left)."
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
