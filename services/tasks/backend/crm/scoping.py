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
    Since 2026-10-10 (original app 6ec1bc6): the giver may take back what
    they gave (an admin's work included); the receiver never deletes it
    directly, admins included -- they ask the giver; the Owner deletes
    anything; a third admin still cannot touch work given to an admin.
    """
    from accounts.access import is_owner
    if is_owner(user):
        return True                       # the Owner: everything
    # whoever GAVE the task may take it back -- an admin's included
    if task.created_by_id and task.created_by_id == user.pk:
        return True
    # whoever RECEIVED it never deletes it themselves, admins included:
    # they ask the giver ("Cancel this task entirely"), who decides
    if task.assigned_to_id == user.pk:
        return False
    # work handed to an admin is out of every other hand's reach
    if task.assigned_to and assignment_level(task.assigned_to) >= 3:
        return False
    return has_capability(user, "tasks.view_all")    # admin: anyone else's task


def edits_need_giver(user, task) -> bool:
    """A task someone else GAVE you is changed through them, admins and the
    Owner included: a new date, priority, title... is a request to the giver,
    never a direct edit. (Moving its status stays yours.) Original app 3ff22ba."""
    giver = task.created_by
    return bool(task.assigned_to_id == user.pk and giver
                and giver.pk != user.pk and giver.is_active)


def delete_refusal(user, task) -> str:
    """Why not -- in words the person can act on."""
    if task.assigned_to_id == user.pk:
        return ("You cannot delete a task given to you. Tick \"Cancel this task "
                "entirely\" and send the request with a reason; whoever gave it "
                "to you decides.")
    if task.assigned_to and assignment_level(task.assigned_to) >= 3:
        return ("This task belongs to an admin. Only the person who gave it, "
                "or the Owner, can delete it.")
    return ("Only the person who gave out this task, or an admin, can delete it.")


ASSIGN_SELF_ONLY = "Your role can only give tasks to yourself."
OWNER_ONLY = "Only the Owner can give a task to the Owner."


def can_assign_to(assigner, assignee) -> bool:
    """No hierarchy: with tasks.assign, any active user, in any direction
    (employee -> manager -> admin included); without it, only themselves.
    One exception (original app 3fbf6e7): the Owner takes work only from
    another Owner (or themselves)."""
    from accounts.access import is_owner
    if not (assignee and assignee.is_active):
        return False
    if assignee.pk == assigner.pk:
        return True
    if is_owner(assignee) and not is_owner(assigner):
        return False
    return has_capability(assigner, "tasks.assign")


def assign_refusal(assigner, assignee) -> str:
    """Why can_assign_to() said no, in words the person can act on."""
    from accounts.access import is_owner
    if not (assignee and assignee.is_active):
        return "That person is not an active user."
    if assignee.pk != assigner.pk and is_owner(assignee) and not is_owner(assigner):
        return OWNER_ONLY
    return ASSIGN_SELF_ONLY


def assignable_users(user):
    """Active users this person may assign tasks to: everyone with tasks.assign (minus the Owners unless they
    are one themselves), else only themselves."""
    from accounts.access import is_owner, users_with
    from accounts.models import User
    qs = User.objects.filter(is_active=True)
    if not has_capability(user, "tasks.assign"):
        return qs.filter(pk=user.pk)
    if not is_owner(user):
        qs = qs.exclude(pk__in=users_with("tasks.delete_admin_work").exclude(pk=user.pk).values("pk"))
    return qs


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
    # A role scoped to strictly "own" tasks (Kaampilot role builder) does
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
