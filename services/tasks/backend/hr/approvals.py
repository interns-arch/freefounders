"""Who approves leave and attendance corrections, and reminders for anything left waiting (PLAN.md §17.2).

APPROVAL_LEAVE (company setting):
  department -- today's rule: whoever's "Approve leave and corrections" scope covers the requester (Team: their
                manager; Department: their department; Company: everyone; PLAN.md §19.19).
  manager    -- the requester's reports-to manager approves (and is notified), even without hr.approve;
                the department approvers and HR can still act, e.g. when the manager is away.
APPROVAL_REMIND_HOURS: a request still pending this long reminds its approver once; twice as long and it
goes to HR / the admins. 0 switches reminders off.
"""
from datetime import timedelta

from django.utils import timezone

from accounts.models import User
from tenancy.company_settings import company_env

MODES = ("department", "manager")


def mode() -> str:
    value = company_env("APPROVAL_LEAVE", "department").lower()
    return value if value in MODES else "department"


def remind_hours() -> int:
    try:
        return max(0, int(company_env("APPROVAL_REMIND_HOURS", "24") or 0))
    except ValueError:
        return 24


def manager_of(user):
    m = user.reporting_manager if user.reporting_manager_id else None
    return m if m and m.is_active and m.pk != user.pk else None


def is_approver(user) -> bool:
    """Should this person see the Approvals screen?"""
    from .views import can_approve
    if can_approve(user):
        return True
    return mode() == "manager" and user.reports.filter(is_active=True).exists()


def reviewable_users(reviewer):
    """Whose leave and corrections this person may decide."""
    from .team import people_in_scope
    from .views import approve_scope
    scope = approve_scope(reviewer)
    users = people_in_scope(reviewer, scope) if scope else User.objects.none()
    if mode() == "manager":
        users = users | User.objects.filter(is_active=True, reporting_manager=reviewer)
    return users.distinct()


def may_review(reviewer, target) -> bool:
    if reviewer.pk == target.pk:
        return False
    from .views import approve_scope
    scope = approve_scope(reviewer)
    if scope == "company":
        return True
    if mode() == "manager" and manager_of(target) == reviewer:
        return True
    if not target.is_active or scope is None:
        return False
    mine = target.reporting_manager_id == reviewer.pk
    return mine or (scope == "department" and target.department == reviewer.department)


def approver_users():
    """Everyone who approves for someone (any scope)."""
    from accounts.access import users_with
    return (users_with("hr.approve_team") | users_with("hr.approve") | users_with("hr.approve_all")).distinct()


def approvers_for(target) -> list:
    """Who is told about a new request (and reminded about it): the requester's own approvers (their manager with
    Team scope, their department's approvers); else the company-wide approvers."""
    from accounts.access import users_with
    manager = manager_of(target)
    if mode() == "manager" and manager:
        return [manager]
    # As before: whoever approves for the requester's department, company-wide approvers in it included.
    people = list((users_with("hr.approve") | users_with("hr.approve_all")).distinct()
                  .filter(department=target.department).exclude(pk=target.pk))
    if manager and manager not in people and users_with("hr.approve_team").filter(pk=manager.pk).exists():
        people.append(manager)
    return people or list(users_with("hr.approve_all").exclude(pk=target.pk))


def escalation_targets(target) -> list:
    from accounts.access import users_with
    return list(users_with("hr.approve_all").exclude(pk=target.pk))


def _describe(kind, obj) -> tuple[str, str]:
    name = obj.user.get_full_name() or obj.user.username
    if kind == "leave":
        return (f"Leave request from {name}",
                f"{obj.leave_type.name}: {obj.start_date} to {obj.end_date} ({obj.days} day(s))"
                + (f"\nReason: {obj.reason}" if getattr(obj, "reason", "") else ""))
    return (f"Attendance correction from {name}", f"For {obj.date}" + (f"\nReason: {obj.reason}" if getattr(obj, "reason", "") else ""))


def notify_submitted(kind: str, obj) -> None:
    """Today nobody hears about a new leave request or correction; now its approvers do."""
    from notifications.service import notify
    title, body = _describe(kind, obj)
    for user in approvers_for(obj.user):
        notify(user, "leave_request" if kind == "leave" else "correction_request", title, body,
               link="/hr", link_label="Review it")


def remind_and_escalate() -> int:
    """Run by the worker on working days. Returns how many notifications went out."""
    hours = remind_hours()
    if not hours:
        return 0
    from notifications.service import notify

    from .models import AttendanceCorrection, CorrectionStatus, LeaveRequest, LeaveStatus

    now = timezone.now()
    sent = 0
    for kind, model, pending in (("leave", LeaveRequest, LeaveStatus.PENDING),
                                 ("correction", AttendanceCorrection, CorrectionStatus.PENDING)):
        waiting = model.objects.filter(status=pending, user__is_active=True).select_related("user")
        for obj in waiting.filter(created_at__lte=now - timedelta(hours=hours), reminded_at__isnull=True):
            title, body = _describe(kind, obj)
            for user in approvers_for(obj.user):
                notify(user, "approval_reminder", f"Waiting for you: {title}", body, link="/hr", link_label="Review it")
                sent += 1
            obj.reminded_at = now
            obj.save(update_fields=["reminded_at"])
        for obj in waiting.filter(created_at__lte=now - timedelta(hours=2 * hours), escalated_at__isnull=True):
            title, body = _describe(kind, obj)
            for user in escalation_targets(obj.user):
                notify(user, "approval_escalated", f"Not reviewed for {2 * hours} hours: {title}", body,
                       link="/hr", link_label="Review it")
                sent += 1
            obj.escalated_at = now
            obj.save(update_fields=["escalated_at"])
    return sent
