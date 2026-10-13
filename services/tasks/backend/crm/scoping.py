"""Which leads a user can SEE and EDIT, derived from the role capability
matrix in accounts.permissions. Kept in one file so the answer to "why can
Anita see this lead?" is always three lines away.
"""
from django.db.models import Q

from accounts.permissions import has_capability

from .models import Lead, LeadStatus, Task


def visible_leads(user):
    qs = Lead.objects.select_related("assigned_to", "created_by")
    if has_capability(user, "leads.view_all"):
        return qs
    if has_capability(user, "leads.view_department"):
        return qs.filter(department=user.department)
    if has_capability(user, "leads.view_team"):
        return qs.filter(Q(assigned_to=user) | Q(assigned_to__reporting_manager=user))
    if has_capability(user, "leads.view_won"):
        return qs.filter(status=LeadStatus.WON)
    if has_capability(user, "leads.view_own"):
        return qs.filter(assigned_to=user)
    return qs.none()


def can_edit_lead(user, lead: Lead) -> bool:
    if has_capability(user, "leads.edit_all"):
        return True
    if has_capability(user, "leads.edit_department"):
        return lead.department == user.department
    if has_capability(user, "leads.edit_team"):
        return lead.assigned_to_id == user.id or bool(lead.assigned_to and lead.assigned_to.reporting_manager_id == user.id)
    if has_capability(user, "leads.edit_own"):
        return lead.assigned_to_id == user.id
    return False


def can_assign(user) -> bool:
    return has_capability(user, "leads.assign")


# ---------------------------------------------------------------------------
# Task assignment: NO hierarchy. Whoever holds "Give tasks to others"
# (tasks.assign) may assign a task to anyone, at any level and in any
# department; everyone else only to themselves (founder's decision,
# docs/security/tasks-api.md). ROLE_LEVEL is kept only for the delete rules
# below (work handed to an admin is protected from deletion).
# ---------------------------------------------------------------------------
from accounts.models import Role

ROLE_LEVEL = {Role.SUPER_ADMIN: 3, Role.ADMIN: 3,
              Role.SALES_MANAGER: 2, Role.HR_MANAGER: 2,
              Role.IT_LEAD: 2, Role.WAREHOUSE_MANAGER: 2,
              Role.PURCHASE_MANAGER: 2, Role.ACCOUNTS_MANAGER: 2,
              Role.DEVELOPER_MANAGER: 2}


def assignment_level(user) -> int:
    """1 member, 2 manager, 3 admin -- from the user's roles in the database."""
    from accounts.access import level
    return level(user)


def can_delete_task(user, task) -> bool:
    """May this person move this task to the Deleted bin?

    Asked by BOTH doors -- the direct delete and an approved "cancel this
    task" request -- so neither can be used to get around the other.
    """
    from accounts.permissions import has_capability
    if has_capability(user, "tasks.delete_admin_work"):
        return True                       # super admin: everything
    # work handed to an admin is out of every other hand's reach, including
    # the admin's own -- nobody deletes their way out of their own record
    if task.assigned_to and assignment_level(task.assigned_to) >= 3:
        return False
    if has_capability(user, "tasks.view_all"):
        return True                       # admin: anyone else's task
    return bool(task.created_by_id and task.created_by_id == user.pk)


def delete_refusal(user, task) -> str:
    """Why not -- in words the person can act on."""
    if task.assigned_to and assignment_level(task.assigned_to) >= 3:
        return ("This task belongs to an admin. Only a Super Admin can delete it.")
    if task.assigned_to_id == user.pk:
        return ("You cannot delete a task given to you. Use Request change -> "
                "\"Cancel this task entirely\" and say why; whoever gave it to "
                "you decides.")
    return ("Only the person who gave out this task, or an admin, can delete it.")


ASSIGN_SELF_ONLY = "Your role can only give tasks to yourself."


def can_assign_to(assigner, assignee) -> bool:
    """No hierarchy: with tasks.assign, any active user, in any direction
    (employee -> manager -> admin included); without it, only themselves."""
    if not (assignee and assignee.is_active):
        return False
    return assignee.pk == assigner.pk or has_capability(assigner, "tasks.assign")


def assign_refusal(assigner, assignee) -> str:
    """Why can_assign_to() said no, in words the person can act on."""
    if not (assignee and assignee.is_active):
        return "That person is not an active user."
    return ASSIGN_SELF_ONLY


def assignable_users(user):
    """Active users this person may assign tasks to: everyone with tasks.assign, else only themselves."""
    from accounts.models import User
    qs = User.objects.filter(is_active=True)
    return qs if has_capability(user, "tasks.assign") else qs.filter(pk=user.pk)


def visible_tasks(user, include_deleted=False):
    qs = Task.objects.select_related("assigned_to", "created_by", "lead")
    if not include_deleted:
        qs = qs.filter(deleted_at__isnull=True)
    if has_capability(user, "tasks.view_all"):
        return qs
    # The designated reporting manager sees ALL their direct reports' tasks,
    # whoever assigned them and whatever the department (reviewer's rule).
    reports_clause = Q(assigned_to__reporting_manager=user)
    if has_capability(user, "tasks.view_department"):
        return qs.filter(
            Q(assigned_to__department=user.department)
            | Q(assigned_to=user) | Q(created_by=user) | Q(subscribers=user)
            | Q(group__members=user) | Q(group__owner=user) | reports_clause
        ).distinct()
    # A role scoped to strictly "own" tasks (FreeFounders role builder) does
    # not see direct reports' tasks; every built-in role keeps seeing them.
    if has_capability(user, "tasks.view_self") and not has_capability(user, "tasks.view_own"):
        reports_clause = Q(pk__in=[])
    return qs.filter(
        Q(assigned_to=user) | Q(created_by=user) | Q(subscribers=user)
        | Q(group__members=user) | Q(group__owner=user) | reports_clause
    ).distinct()


def can_edit_task(user, task: Task) -> bool:
    if has_capability(user, "tasks.view_all"):
        return True
    if has_capability(user, "tasks.view_department") and task.assigned_to.department == user.department:
        return True
    return task.assigned_to_id == user.id or task.created_by_id == user.id


def can_assign_tasks(user) -> bool:
    return has_capability(user, "tasks.assign")
