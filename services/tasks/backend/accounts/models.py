"""User model with CarTrends CRM roles.

Six internal roles. Permissions are derived from the role in
`accounts.permissions` -- there is no per-user permission editing in v1,
which keeps the matrix auditable.
"""
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    SUPER_ADMIN = "super_admin", "Super Admin"
    ADMIN = "admin", "Admin"
    SALES_MANAGER = "sales_manager", "Sales Manager"
    # There is no customer-support post: product/other support IS the Sales
    # post; tech support is the IT Lead post. Developer team is separate.
    SALES_EXECUTIVE = "sales_executive", "Sales"
    PURCHASE_MANAGER = "purchase_manager", "Purchase Manager"
    PURCHASE = "purchase", "Purchase Team"
    ACCOUNTS_MANAGER = "accounts_manager", "Accounts Manager"
    ACCOUNTS = "accounts", "Accounts"
    IT_LEAD = "it_lead", "IT Lead"
    IT_TEAM = "it_team", "IT Team"
    DEVELOPER_MANAGER = "developer_manager", "Developer Manager"
    DEVELOPER = "developer", "Developer"
    WAREHOUSE_MANAGER = "warehouse_manager", "Warehouse Manager"
    WAREHOUSE = "warehouse", "Warehouse Team"
    RIDER = "rider", "Rider"
    HOUSEKEEPING = "housekeeping", "Housekeeping"
    SECURITY = "security", "Security"
    LEGAL = "legal", "Legal"
    HR_EXECUTIVE = "hr_executive", "HR Executive"
    HR_MANAGER = "hr_manager", "HR Manager"
    # Neutral value for users whose roles come from the FreeFounders Platform (PLAN.md §19.28): only Admin and Member
    # are built in there, and what someone can do comes from the roles' permissions, never from this field. No
    # built-in role here, no capabilities of its own.
    MEMBER = "member", "Member"


class Department(models.TextChoices):
    SALES = "sales", "Sales"
    PURCHASE = "purchase", "Purchase"
    ACCOUNTS = "accounts", "Accounts"
    SUPPORT = "support", "IT Team"
    DEVELOPMENT = "development", "Developer Team"
    WAREHOUSE = "warehouse", "Warehouse"
    HR = "hr", "Human Resources"
    MANAGEMENT = "management", "Management"


class DepartmentOption(models.Model):
    """Admin-managed department list.

    The `Department` choices above stay as the seed and as the constants the
    code refers to (ROLE_DEFAULT_DEPARTMENT, scoping...). This table is what
    the dropdowns actually read, so Admin can add a department -- or rename
    one -- without a deploy. `code` is what gets stored on users/tasks/leads.
    """
    code = models.SlugField(max_length=20, unique=True)
    name = models.CharField(max_length=60)
    active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=100)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return self.name

    @classmethod
    def choices_list(cls):
        """(code, name) for every active department, seeded rows included."""
        rows = list(cls.objects.filter(active=True))
        if not rows:                       # before the seed migration runs
            return list(Department.choices)
        return [(d.code, d.name) for d in rows]

    @classmethod
    def label_for(cls, code):
        if not code:
            return ""
        row = cls.objects.filter(code=code).first()
        return row.name if row else dict(Department.choices).get(code, code)


# The roles at the very top of the tree. Anything that means "an admin"
# must ask this, never compare to Role.ADMIN -- Super Admin is an admin too.
# Since the role builder (PLAN.md section 15) "top" means a role at level 3;
# these two are the built-in ones (and the fallback before roles are seeded).
TOP_ADMIN_ROLES = frozenset({"admin", "super_admin"})


def is_top_admin(role) -> bool:
    """Is this role code an admin role (level 3)? For a USER ask
    accounts.access.is_admin(user): it also counts roles from the Platform."""
    from .access import role_codes_at_level
    return str(role) in TOP_ADMIN_ROLES or str(role) in role_codes_at_level(3)


ROLE_DEFAULT_DEPARTMENT = {
    Role.SUPER_ADMIN: Department.MANAGEMENT,
    Role.ADMIN: Department.MANAGEMENT,
    Role.SALES_MANAGER: Department.SALES,
    Role.SALES_EXECUTIVE: Department.SALES,
    Role.PURCHASE_MANAGER: Department.PURCHASE,
    Role.PURCHASE: Department.PURCHASE,
    Role.ACCOUNTS_MANAGER: Department.ACCOUNTS,
    Role.ACCOUNTS: Department.ACCOUNTS,
    Role.IT_LEAD: Department.SUPPORT,
    Role.IT_TEAM: Department.SUPPORT,
    Role.DEVELOPER_MANAGER: Department.DEVELOPMENT,
    Role.DEVELOPER: Department.DEVELOPMENT,
    Role.WAREHOUSE_MANAGER: Department.WAREHOUSE,
    Role.WAREHOUSE: Department.WAREHOUSE,
    Role.RIDER: Department.WAREHOUSE,
    Role.HOUSEKEEPING: Department.WAREHOUSE,
    Role.SECURITY: Department.WAREHOUSE,
    Role.LEGAL: Department.MANAGEMENT,
    Role.HR_EXECUTIVE: Department.HR,
    Role.HR_MANAGER: Department.HR,
}


class User(AbstractUser):
    # username, first_name, last_name, email, password, is_active from AbstractUser
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.SALES_EXECUTIVE)
    department = models.CharField(max_length=20, choices=Department.choices, default=Department.SALES)
    whatsapp_phone = models.CharField(
        max_length=20, blank=True, default="",
        help_text="E.164, e.g. 9198XXXXXXXX -- used for WhatsApp notifications once the API is configured.",
    )
    reporting_manager = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="reports",
    )
    works_week_off = models.BooleanField(
        default=False,
        help_text="Works on the weekly off day -- used by HR for comp-off accrual.",
    )
    # The FreeFounders Platform person this login belongs to. Set when the
    # Platform provisions the user; Platform tokens are only accepted for a
    # user whose id here matches the token's subject.
    platform_person_id = models.UUIDField(null=True, blank=True, unique=True, editable=False)
    # From the Platform's People directory (PLAN.md §17.1, §19.15): shown on the attendance lists and
    # reports, and how an attendance import finds the person. Blank on a standalone install.
    employee_code = models.CharField(max_length=40, blank=True, default="", db_index=True)
    designation = models.CharField(max_length=120, blank=True, default="")

    @property
    def is_admin_role(self) -> bool:
        from .access import is_admin
        return is_admin(self)

    def save(self, *args, **kwargs):
        if is_top_admin(self.role):
            # Admin role always maps onto Django's staff/superuser flags so
            # /admin and admin-only API checks agree with each other.
            self.is_staff = True
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"


# ---------------------------------------------------------------------------
# FreeFounders roles (PLAN.md section 15). Roles live in the database so a
# company admin can build their own; today's 20 roles are seeded with exactly
# the capabilities in accounts.permissions.ROLE_CAPABILITIES. `User.role`
# stays as the primary role; a user whose roles come from the FreeFounders
# Platform has rows in UserAccessRole, and then only those count.
# ---------------------------------------------------------------------------

class AccessRole(models.Model):
    code = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True, default="")
    colour = models.CharField(max_length=20, blank=True, default="")
    # 1 member, 2 manager, 3 admin (as ROLE_LEVEL): decides which work is protected from deletion.
    level = models.PositiveSmallIntegerField(default=1)
    is_system = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    # The Platform role this copy came from (None for the built-in roles).
    platform_role_id = models.UUIDField(null=True, blank=True, unique=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class AccessGrant(models.Model):
    """One permission of a role, with its scope (own / team / department /
    company) when the permission has scopes; blank when it is yes/no."""

    role = models.ForeignKey(AccessRole, on_delete=models.CASCADE, related_name="grants")
    permission = models.CharField(max_length=60)
    scope = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["role", "permission"], name="access_grant_role_permission_uq")]

    def __str__(self):
        return f"{self.role.code}: {self.permission}{'@' + self.scope if self.scope else ''}"


class UserAccessRole(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="access_roles")
    role = models.ForeignKey(AccessRole, on_delete=models.CASCADE, related_name="members")
    # When the person got the role: a role's joining checklist goes only to people who get it later (§17.3).
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "role"], name="user_access_role_uq")]
