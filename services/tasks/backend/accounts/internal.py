"""Internal API the FreeFounders Platform calls; not for browsers.

POST /api/internal/provision -- the Platform gives a person access to Tasks.
Finds that person's user here (already linked, else same email, else same
username) or creates one, links it, and returns its id. Authenticated by a
60-second Platform service token with audience "tasks-internal".
"""
import re
import uuid

from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from rest_framework import status
from rest_framework.authentication import BaseAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from . import platform_auth
from .models import ROLE_DEFAULT_DEPARTMENT, Department, Role, User

SERVICE_AUDIENCE = "tasks-internal"


class ServiceTokenAuthentication(BaseAuthentication):
    """Accepts only a Platform service token (audience tasks-internal); request.auth holds its claims."""

    def authenticate(self, request):
        if not platform_auth.enabled():
            raise AuthenticationFailed("Platform sign-in is not configured")
        token = platform_auth.bearer(request)
        if not token:
            raise AuthenticationFailed("Service token required")
        claims = platform_auth.verify(token, SERVICE_AUDIENCE)
        if claims.get("sub") != "platform":
            raise AuthenticationFailed("Invalid service token")
        return AnonymousUser(), claims

    def authenticate_header(self, request):
        return 'Bearer realm="internal"'


class IsPlatformService(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.auth, dict) and request.auth.get("sub") == "platform"


def _clean(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _free_username(*candidates: str) -> str:
    for raw in candidates:
        base = re.sub(r"[^\w.@+-]", "", raw)[:140]
        if not base:
            continue
        name, n = base, 2
        while User.objects.filter(username__iexact=name).exists():
            name, n = f"{base}-{n}", n + 1
        return name
    return f"user-{uuid.uuid4().hex[:8]}"


@api_view(["POST"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def provision(request):
    data = request.data
    try:
        person_id = uuid.UUID(str(data.get("personId")))
    except ValueError:
        return Response({"detail": "personId must be a UUID"}, status=status.HTTP_400_BAD_REQUEST)
    full_name = _clean(data.get("fullName"))
    email = _clean(data.get("email")).lower()
    username = _clean(data.get("username"))
    code = _clean(data.get("employeeCode"))
    if not full_name:
        return Response({"detail": "fullName is required"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        user = User.objects.select_for_update().filter(platform_person_id=person_id).first()
        created = False
        if user is None:
            match = None
            if email:
                match = User.objects.select_for_update().filter(email__iexact=email).order_by("id").first()
            if match is None and username:
                match = User.objects.select_for_update().filter(username__iexact=username).first()
            if match is not None and match.platform_person_id not in (None, person_id):
                return Response(
                    {"detail": f"The Tasks login '{match.username}' already belongs to another person"},
                    status=status.HTTP_409_CONFLICT,
                )
            user = match
        if user is None:
            role = data.get("appRole") if data.get("appRole") in Role.values else None
            if role is None:
                # No role chosen: the company's FreeFounders owners/admins run Tasks too.
                role = Role.SUPER_ADMIN if data.get("platformRole") in ("owner", "admin") else Role.SALES_EXECUTIVE
            first, _, last = full_name.partition(" ")
            user = User(
                username=_free_username(username, email.split("@")[0] if email else "", code, full_name.replace(" ", ".").lower()),
                first_name=first[:150],
                last_name=last[:150],
                email=email,
                whatsapp_phone=re.sub(r"[^\d+]", "", _clean(data.get("mobile")))[:20],
                role=role,
                department=ROLE_DEFAULT_DEPARTMENT.get(role, Department.SALES),
            )
            # Signs in through the Platform only; no local password.
            user.set_unusable_password()
            created = True
        user.platform_person_id = person_id
        user.save()
    return Response(
        {"userId": user.pk, "username": user.username, "created": created, "active": user.is_active},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["GET"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def roles(request):
    """Roles an admin can pick when giving someone Tasks access."""
    return Response([{"value": value, "label": label} for value, label in Role.choices])


# ---------------------------------------------------------------------------
# Roles from the FreeFounders role builder (PLAN.md section 15)
# ---------------------------------------------------------------------------

@api_view(["GET"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def permissions(request):
    """The permissions Tasks offers to the Platform's role builder."""
    from .access import SCOPES, catalogue
    return Response({"app": "tasks", "scopes": list(SCOPES), "permissions": catalogue()})


@api_view(["GET", "PUT"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def access(request):
    """GET: the company's roles and who holds them (to bring an existing company into the role builder).
    PUT: the Platform's full role set for the company, plus the roles of the listed people."""
    if request.method == "GET":
        return Response(_export_access())
    return _import_access(request.data)


# ---------------------------------------------------------------------------
# Company profile from the FreeFounders Settings Center (PLAN.md section 16)
# ---------------------------------------------------------------------------

@api_view(["GET"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def modules(request):
    """The modules Tasks can switch on or off, with their defaults for a new company."""
    from tenancy.profile import catalogue
    return Response({"app": "tasks", "modules": catalogue()})


@api_view(["PUT"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def company(request):
    """The company's names, colour, logo address and module switches."""
    from tenancy.profile import apply
    try:
        return Response(apply(request.data))
    except (TypeError, ValueError):
        return Response({"detail": "version is required"}, status=status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# People directory from the Platform (PLAN.md section 17.1)
# ---------------------------------------------------------------------------

PEOPLE_VERSION_KEY = "FF_PEOPLE_VERSION"


@api_view(["GET", "PUT"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def people(request):
    """GET: departments and each linked person's department and manager (to bring an existing company into the
    directory). PUT: the Platform's department list and the directory fields of the people who have Tasks."""
    if request.method == "GET":
        return Response(_export_people())
    return _import_people(request.data)


def _export_people():
    from .models import DepartmentOption

    users = User.objects.filter(platform_person_id__isnull=False).select_related("reporting_manager")
    return {
        "departments": [{"code": d.code, "name": d.name, "active": d.active} for d in DepartmentOption.objects.all()],
        "people": [{
            "personId": str(u.platform_person_id),
            "departmentCode": u.department or None,
            "reportsTo": str(u.reporting_manager.platform_person_id)
            if u.reporting_manager_id and u.reporting_manager.platform_person_id else None,
        } for u in users],
    }


def _import_people(data):
    from tenancy.models import CompanySetting

    from .models import DepartmentOption

    try:
        version = int(data.get("version"))
        departments = list(data.get("departments") or [])
        people = list(data.get("people") or [])
    except (TypeError, ValueError):
        return Response({"detail": "version, departments and people are required"}, status=status.HTTP_400_BAD_REQUEST)
    row = CompanySetting.objects.filter(key=PEOPLE_VERSION_KEY).first()
    current = int(row.value) if row and row.value.isdigit() else 0
    if version < current:
        return Response({"version": current, "applied": False})

    with transaction.atomic():
        known = set()
        for d in departments:
            code = re.sub(r"[^a-z0-9_-]", "", _clean(d.get("code")).lower())[:20]
            if not code:
                continue
            known.add(code)
            DepartmentOption.objects.update_or_create(
                code=code, defaults={"name": (_clean(d.get("name")) or code)[:60], "active": d.get("active", True) is not False})
        ids = [str(p.get("personId")) for p in people if p.get("personId")]
        managers = {str(p.get("reportsTo")) for p in people if p.get("reportsTo")}
        users = {str(u.platform_person_id): u for u in User.objects.filter(platform_person_id__in=[*ids, *managers])}
        missing = []
        for p in people:
            user = users.get(str(p.get("personId")))
            if user is None:
                missing.append(p.get("personId"))
                continue
            fields = {}
            code = _clean(p.get("departmentCode")).lower()
            if code in known and user.department != code:
                fields["department"] = code
            manager = users.get(str(p.get("reportsTo"))) if p.get("reportsTo") else None
            if manager is not None and manager.pk == user.pk:
                manager = None
            if (manager.pk if manager else None) != user.reporting_manager_id:
                fields["reporting_manager"] = manager
            active = p.get("status", "active") == "active"
            if user.is_active != active:
                fields["is_active"] = active
            if fields:
                for k, v in fields.items():
                    setattr(user, k, v)
                user.save(update_fields=list(fields))
        CompanySetting.objects.update_or_create(key=PEOPLE_VERSION_KEY, defaults={"value": str(version), "secret": False})
    return Response({"version": version, "applied": True, "people": len(people) - len(missing), "missingPeople": missing})


ACCESS_VERSION_KEY = "FF_ACCESS_VERSION"


def _access_version() -> int:
    """The last role-set version received from the Platform (kept with the company's data)."""
    from tenancy.models import CompanySetting
    row = CompanySetting.objects.filter(key=ACCESS_VERSION_KEY).first()
    return int(row.value) if row and row.value.isdigit() else 0


def _export_access():
    from .access import role_codes
    from .models import AccessRole

    roles = []
    for r in AccessRole.objects.prefetch_related("grants").order_by("id"):
        roles.append({
            "code": r.code, "name": r.name, "description": r.description, "colour": r.colour, "level": r.level,
            "archived": r.archived, "platformRoleId": str(r.platform_role_id) if r.platform_role_id else None,
            "grants": [{"permission": g.permission, "scope": g.scope} for g in r.grants.all()],
        })
    people = [
        {"personId": str(u.platform_person_id), "userId": u.pk, "roles": role_codes(u)}
        for u in User.objects.filter(platform_person_id__isnull=False).order_by("id")
    ]
    return {"version": _access_version(), "roles": roles, "people": people}


def _import_access(data):
    """Applies the Platform's role set. Reads everything it needs in a few queries and writes only what changed,
    so a push with dozens of roles stays fast."""
    from tenancy.models import CompanySetting

    from .access import forget, valid_grant
    from .models import AccessGrant, AccessRole, UserAccessRole

    try:
        version = int(data.get("version"))
        roles = list(data.get("roles") or [])
        people = list(data.get("people") or [])
        ids = [uuid.UUID(str(r.get("id"))) for r in roles]
    except (TypeError, ValueError):
        return Response({"detail": "version, roles (with UUID ids) and people are required"}, status=status.HTTP_400_BAD_REQUEST)
    current = _access_version()
    if version < current:
        # An older push arriving late: keep what we have.
        return Response({"version": current, "applied": False})

    problems = []
    with transaction.atomic():
        codes = [_clean(r.get("code")) for r in roles if _clean(r.get("code"))]
        by_pid = {r.platform_role_id: r for r in AccessRole.objects.filter(platform_role_id__in=ids)}
        by_code = {r.code: r for r in AccessRole.objects.filter(code__in=codes)}
        have_grants: dict[int, dict[str, str]] = {}
        for role_id, permission, scope in AccessGrant.objects.filter(
                role_id__in=[r.pk for r in [*by_pid.values(), *by_code.values()]]).values_list("role_id", "permission", "scope"):
            have_grants.setdefault(role_id, {})[permission] = scope

        by_platform_id = {}
        new_grants, drop_grants = [], []
        for r, rid in zip(roles, ids):
            code = _clean(r.get("code")) or f"p-{rid.hex[:12]}"
            role = by_pid.get(rid) or by_code.get(code) or AccessRole(code=code)
            fields = {
                "platform_role_id": rid,
                "name": (_clean(r.get("name")) or code)[:120],
                "description": _clean(r.get("description"))[:300],
                "colour": _clean(r.get("colour"))[:20],
                "level": max(1, min(3, int(r.get("level") or 1))),
                "archived": bool(r.get("archived")),
                "is_system": bool(r.get("system")),
            }
            if role.pk is None or any(getattr(role, k) != v for k, v in fields.items()):
                for k, v in fields.items():
                    setattr(role, k, v)
                role.save()
            wanted = {}
            for g in r.get("grants") or []:
                if g.get("app", "tasks") != "tasks":
                    continue
                permission, scope = _clean(g.get("permission")), _clean(g.get("scope"))
                if valid_grant(permission, scope):
                    wanted[permission] = scope
                else:
                    problems.append(f"{role.name}: {permission}{'@' + scope if scope else ''} is not a Tasks permission")
            have = have_grants.get(role.pk, {})
            for permission, scope in have.items():
                if wanted.get(permission) != scope:
                    drop_grants.append((role.pk, permission))
            for permission, scope in wanted.items():
                if have.get(permission) != scope:
                    new_grants.append(AccessGrant(role=role, permission=permission, scope=scope))
            by_platform_id[str(rid)] = role
            if "duties" in r:  # Phase 5: the role's responsibilities
                from crm.duties import sync_role_duties
                problems += sync_role_duties(role, r.get("duties"))
        for role_id, permission in drop_grants:
            AccessGrant.objects.filter(role_id=role_id, permission=permission).delete()
        AccessGrant.objects.bulk_create(new_grants)
        # Platform roles that are no longer sent were deleted there: archive (history keeps their name).
        if data.get("complete", True):
            AccessRole.objects.filter(platform_role_id__isnull=False, archived=False).exclude(platform_role_id__in=ids).update(archived=True)

        person_ids = [str(p.get("personId")) for p in people if p.get("personId")]
        users = {str(u.platform_person_id): u for u in User.objects.filter(platform_person_id__in=person_ids)}
        held: dict[int, set[int]] = {}
        for user_id, role_id in UserAccessRole.objects.filter(user__in=users.values()).values_list("user_id", "role_id"):
            held.setdefault(user_id, set()).add(role_id)
        missing, add_links, drop_links = [], [], []
        for p in people:
            user = users.get(str(p.get("personId")))
            if user is None:
                missing.append(p.get("personId"))
                continue
            wanted_roles = [by_platform_id[str(x)] for x in p.get("roleIds") or [] if str(x) in by_platform_id]
            want_ids = {r.pk for r in wanted_roles}
            have_ids = held.get(user.pk, set())
            drop_links += [(user.pk, rid) for rid in have_ids - want_ids]
            add_links += [UserAccessRole(user=user, role_id=rid) for rid in want_ids - have_ids]
            # The primary role shown in the app follows the first built-in role, if there is one.
            builtin = next((r.code for r in wanted_roles if r.code in Role.values), None)
            if builtin and user.role != builtin:
                user.role = builtin
                user.save(update_fields=["role", "is_staff"])
        for user_id, role_id in drop_links:
            UserAccessRole.objects.filter(user_id=user_id, role_id=role_id).delete()
        UserAccessRole.objects.bulk_create(add_links)
        CompanySetting.objects.update_or_create(key=ACCESS_VERSION_KEY, defaults={"value": str(version), "secret": False})
    forget()
    return Response({"version": version, "applied": True, "roles": len(by_platform_id), "people": len(people) - len(missing),
                     "missingPeople": missing, "problems": problems})
