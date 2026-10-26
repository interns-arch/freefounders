"""Which area a notification belongs to (PLAN.md §19.37): the bell and the Notifications screen group by it.

    attendance  leave decisions, attendance, payslips / payroll
    approvals   something waiting for this person to approve (leave, corrections, task changes, finished work,
                category requests) and the reminders / escalations about it
    company     notices, billing, system messages
    visitors    visitors at the gate, overstays (PLAN.md §22); a host's Allow / Deny is an approval
    tasks       everything else here: tasks, leads, mistakes

(Assets notifications are "assets", or "approvals" for requests and new joiners waiting for approval; the Assets API
sets that itself.) Stored on the row (`Notification.category`) when it is created, so grouping never guesses later.
"""
CATEGORIES = ("attendance", "tasks", "approvals", "company", "visitors")

APPROVAL_TYPES = {
    "leave_request", "correction_request", "approval_reminder", "approval_escalated",
    "task_change_request", "task_completion_review", "task_completion_reminder", "visitor_approval",
}
ATTENDANCE_TYPES = {"leave_reviewed", "correction_reviewed"}
ATTENDANCE_PREFIXES = ("attendance", "leave", "correction", "payslip", "payroll", "salary", "punch", "hr_")
COMPANY_TYPES = {"notice"}
COMPANY_PREFIXES = ("notice", "billing", "plan_", "system", "company")


def category_for(type_: str) -> str:
    t = (type_ or "").lower()
    if t in APPROVAL_TYPES:
        return "approvals"
    if t in ATTENDANCE_TYPES or t.startswith(ATTENDANCE_PREFIXES):
        return "attendance"
    if t in COMPANY_TYPES or t.startswith(COMPANY_PREFIXES):
        return "company"
    if t.startswith("visitor"):
        return "visitors"
    return "tasks"
