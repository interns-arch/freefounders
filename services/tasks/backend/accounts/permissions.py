"""Role -> capability matrix for the whole CRM.

One place to answer "who can do what". Views use the small DRF permission
classes at the bottom; queryset scoping (who SEES which leads) lives in the
crm app's views and also keys off these helpers.
"""
from rest_framework.permissions import BasePermission

from .models import Role

# Capabilities are plain strings so the frontend can receive them verbatim.
ADMIN_CAPABILITIES = {
    "users.manage", "leads.view_all", "leads.edit_all", "leads.assign",
    "tasks.view_all", "tasks.assign", "dashboard.view", "settings.manage",
    "quotations.manage", "notifications.view", "intake.view",
    "hr.manage", "hr.approve",
}

LEGACY_ROLE_CAPABILITIES = {
    # Super Admin is an admin with exactly one extra power: deleting work that
    # is assigned to an admin. Written as "admin's set plus one" so the two
    # can never drift -- a capability given to admins reaches super admins.
    Role.SUPER_ADMIN: ADMIN_CAPABILITIES | {"tasks.delete_admin_work"},
    Role.ADMIN: set(ADMIN_CAPABILITIES),
    Role.SALES_MANAGER: {
        "leads.view_department", "leads.edit_department", "leads.assign",
        "tasks.view_department", "tasks.assign", "dashboard.view",
        "quotations.manage", "notifications.view", "intake.view",
        "hr.approve",
    },
    Role.SALES_EXECUTIVE: {
        "leads.view_own", "leads.edit_own", "tasks.view_own",
        "quotations.manage", "notifications.view",
    },
    Role.PURCHASE_MANAGER: {
        "leads.view_department", "tasks.view_department", "tasks.assign",
        "dashboard.view", "notifications.view", "hr.approve",
    },
    Role.PURCHASE: {
        "leads.view_department", "tasks.view_own", "notifications.view",
    },
    Role.ACCOUNTS_MANAGER: {
        "leads.view_won", "tasks.view_department", "tasks.assign",
        "dashboard.view", "notifications.view", "hr.approve",
    },
    Role.ACCOUNTS: {
        "leads.view_won", "tasks.view_own", "notifications.view",
    },
    Role.DEVELOPER_MANAGER: {
        "tasks.view_department", "tasks.assign", "dashboard.view",
        "notifications.view", "hr.approve",
    },
    # IT Lead: manager-level over the IT/dev side — assigns tasks, sees the
    # department, reviews requests; no sales-pipeline powers.
    Role.IT_LEAD: {
        "tasks.view_department", "tasks.assign", "dashboard.view",
        "notifications.view", "hr.approve",
    },
    # IT Team: works under the IT Lead. Own tasks only, like every other
    # team-level role -- widen deliberately if the job actually needs more.
    Role.IT_TEAM: {
        "tasks.view_own", "notifications.view",
    },
    # Warehouse: same shape — manager runs the floor, team works own tasks.
    Role.WAREHOUSE_MANAGER: {
        "tasks.view_department", "tasks.assign", "dashboard.view",
        "notifications.view", "hr.approve",
    },
    Role.WAREHOUSE: {
        "tasks.view_own", "notifications.view",
    },
    # Riders: delivery runs assigned as tasks; own tasks + notifications.
    Role.RIDER: {
        "tasks.view_own", "notifications.view",
    },
    # Housekeeping: their own work and nothing else -- no pipeline, no team,
    # no reports. Widen deliberately if the job actually needs more.
    Role.HOUSEKEEPING: {
        "tasks.view_own", "notifications.view",
    },
    # Security: their own work and nothing else -- no pipeline, no team,
    # no reports. Widen deliberately if the job actually needs more.
    Role.SECURITY: {
        "tasks.view_own", "notifications.view",
    },
    # Legal: their own work and nothing else -- no pipeline, no team,
    # no reports. Widen deliberately if the job actually needs more.
    Role.LEGAL: {
        "tasks.view_own", "notifications.view",
    },
    # HR Executive: their own work and nothing else -- no pipeline, no team,
    # no reports. Widen deliberately if the job actually needs more.
    Role.HR_EXECUTIVE: {
        "tasks.view_own", "notifications.view",
    },
    Role.DEVELOPER: {
        "tasks.view_own", "notifications.view",
    },
    # Dedicated HR: full leave/attendance powers company-wide, and no access
    # to the sales pipeline at all (separation of duties). Assigns tasks like
    # any other manager -- ROLE_LEVEL(2) already stops that at the admins.
    Role.HR_MANAGER: {
        "hr.manage", "hr.approve", "users.manage",
        "tasks.view_own", "tasks.assign", "notifications.view",
    },
}


# The dict above is each built-in role as it was before every feature became its own permission (PLAN.md
# §19.19). ROLE_CAPABILITIES is the same roles in today's catalogue: the upgrade adds the fine-grained permissions
# each one already had through a broader one (e.g. hr.manage -> payroll, HR settings, holidays...), so nobody's
# access changes. Level matters for two of them (Admin-level roles delete leads and set lead rules).
_STARTER_LEVEL = {Role.SUPER_ADMIN: 3, Role.ADMIN: 3}


def _upgraded(role, caps):
    from .access import capabilities_from_grants, grants_from_capabilities, upgrade_grants
    grants = dict(grants_from_capabilities(caps))
    return capabilities_from_grants(upgrade_grants(grants, _STARTER_LEVEL.get(role, 1)).items())


ROLE_CAPABILITIES = {role: _upgraded(role, caps) for role, caps in LEGACY_ROLE_CAPABILITIES.items()}


# ROLE_CAPABILITIES above is the STARTER TEMPLATE: the 20 built-in roles are
# seeded from it into the database (accounts.AccessRole), and from then on the
# database is what counts, so a company can edit roles. See accounts/access.py.

def capabilities_for(user) -> list[str]:
    from .access import capabilities
    return sorted(capabilities(user))


def has_capability(user, capability: str) -> bool:
    from .access import capabilities
    return capability in capabilities(user)


class IsAdmin(BasePermission):
    message = "Admin role required."

    def has_permission(self, request, view):
        from .access import is_admin
        return bool(request.user and request.user.is_authenticated
                    and is_admin(request.user))


class HasCapability(BasePermission):
    """Usage: permission_classes = [HasCapability.of("leads.assign")]"""

    capability = ""

    @classmethod
    def of(cls, capability: str):
        return type(f"Has_{capability.replace('.', '_')}", (cls,), {"capability": capability})

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and has_capability(request.user, self.capability)
        )


def granted(user, *permissions: str) -> bool:
    """Has any of these catalogue permissions (PLAN.md §19.19), at any scope."""
    from .access import scope_of
    if not (user and getattr(user, "is_authenticated", False)):
        return False
    return any(scope_of(user, p) is not None for p in permissions)


class HasPermission(BasePermission):
    """Usage: permission_classes = [HasPermission.of("hr.live", "hr.daily")] -- any of them, at any scope."""

    permissions: tuple = ()
    message = "Your role does not include this. Ask your admin to add it to your role."

    @classmethod
    def of(cls, *permissions: str):
        return type(f"HasPermission_{'_'.join(p.replace('.', '_') for p in permissions)}", (cls,), {"permissions": permissions})

    def has_permission(self, request, view):
        return granted(request.user, *self.permissions)
