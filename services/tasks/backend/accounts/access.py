"""Roles from the database (PLAN.md section 15).

The rest of the app keeps asking `has_capability(user, "tasks.view_all")`
with the same capability strings as before. What changed is where the answer
comes from: a role is now a row (AccessRole) with grants (AccessGrant), and a
grant is a catalogue permission plus a scope. This module turns grants back
into those capability strings.

Scopes: own < team < department < company. "team" = me + my direct reports.
For tasks, today's `tasks.view_own` already includes direct reports, so it is
the TEAM scope; strict "own" is the new `tasks.view_self`.
"""
import threading
import time

SCOPES = ("own", "team", "department", "company")

# key, label, group, {scope: capability} for scoped permissions (None = yes/no; the key is the capability).
CATALOGUE = [
    ("tasks.view", "See tasks", "Tasks",
     {"own": "tasks.view_self", "team": "tasks.view_own", "department": "tasks.view_department", "company": "tasks.view_all"}),
    ("tasks.assign", "Give tasks to others, create groups", "Tasks", None),
    ("tasks.delete_admin_work", "Delete work assigned to an admin", "Tasks", None),
    ("tasks.admin", "Tasks administrator (everyone's delegation reports, admin inbox)", "Tasks", None),
    ("dashboard.view", "Team dashboard", "Tasks", None),
    ("notifications.view", "Notifications", "Tasks", None),
    ("leads.view", "See leads", "Leads",
     {"own": "leads.view_own", "team": "leads.view_team", "department": "leads.view_department", "company": "leads.view_all"}),
    ("leads.view_won", "See won leads (accounts)", "Leads", None),
    ("leads.edit", "Edit leads", "Leads",
     {"own": "leads.edit_own", "team": "leads.edit_team", "department": "leads.edit_department", "company": "leads.edit_all"}),
    ("leads.assign", "Assign leads", "Leads", None),
    ("quotations.manage", "Quotations", "Leads", None),
    ("intake.view", "AI inbox", "Leads", None),
    ("hr.approve", "Approve leave and attendance corrections for the department", "HR", None),
    ("hr.manage", "HR administrator (all people, settings, payroll)", "HR", None),
    ("users.manage", "Manage users", "Administration", None),
    ("settings.manage", "Company settings", "Administration", None),
]
_BY_KEY = {key: (label, group, scopes) for key, label, group, scopes in CATALOGUE}
# capability string -> (permission key, scope) for scoped capabilities
_SCOPED_CAP = {cap: (key, scope) for key, _l, _g, scopes in CATALOGUE if scopes for scope, cap in scopes.items()}


def catalogue() -> list[dict]:
    """What the Platform's role builder shows for Tasks."""
    return [
        {"key": key, "label": label, "group": group, "scopes": list(scopes) if scopes else None}
        for key, label, group, scopes in CATALOGUE
    ]


def grants_from_capabilities(capabilities) -> list[tuple[str, str]]:
    """Today's capability strings -> (permission, scope) grants."""
    out = {}
    for cap in capabilities:
        if cap in _SCOPED_CAP:
            key, scope = _SCOPED_CAP[cap]
            if key not in out or SCOPES.index(scope) > SCOPES.index(out[key]):
                out[key] = scope
        elif cap in _BY_KEY:
            out[cap] = ""
    return sorted(out.items())


def capabilities_from_grants(grants) -> set[str]:
    """(permission, scope) grants -> capability strings the code checks."""
    caps = set()
    for permission, scope in grants:
        entry = _BY_KEY.get(permission)
        if entry is None:
            continue
        scopes = entry[2]
        if scopes:
            if scope in scopes:
                caps.add(scopes[scope])
        else:
            caps.add(permission)
    return caps


def valid_grant(permission: str, scope: str) -> bool:
    entry = _BY_KEY.get(permission)
    if entry is None:
        return False
    return (scope in entry[2]) if entry[2] else scope in ("", None)


# --- per-role cache -----------------------------------------------------------
# Roles change rarely; every request asks many times. Cached per company schema
# for a short time; changes made in this process clear it at once (signals).
_TTL = 30
_lock = threading.Lock()
_cache: dict[str, tuple[float, dict[str, tuple[frozenset, int]], bool]] = {}


def _schema_key() -> str:
    from tenancy.schemas import current
    return current() or "-"


def _roles() -> tuple[dict[str, tuple[frozenset, int]], bool]:
    """code -> (capabilities, level) for every active role; and whether any role exists."""
    key = _schema_key()
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _TTL:
            return hit[1], hit[2]
    from .models import AccessGrant, AccessRole

    roles = {r.code: (r.id, r.level) for r in AccessRole.objects.filter(archived=False)}
    grants: dict[int, list] = {}
    for g in AccessGrant.objects.filter(role_id__in=[rid for rid, _ in roles.values()]).values_list("role_id", "permission", "scope"):
        grants.setdefault(g[0], []).append((g[1], g[2]))
    table = {code: (frozenset(capabilities_from_grants(grants.get(rid, []))), level) for code, (rid, level) in roles.items()}
    any_role = AccessRole.objects.exists()
    with _lock:
        _cache[key] = (now, table, any_role)
    return table, any_role


def forget() -> None:
    with _lock:
        _cache.clear()


def role_codes(user) -> list[str]:
    """The roles that count for this user: the ones the Platform gave them, else `User.role`."""
    if not getattr(user, "pk", None):
        return [str(getattr(user, "role", "") or "")]
    cached = getattr(user, "_ff_role_codes", None)
    if cached is not None and cached[0] == user.role:
        return cached[1]
    from .models import UserAccessRole

    synced = list(UserAccessRole.objects.filter(user_id=user.pk).values_list("role__code", flat=True))
    codes = synced or [str(user.role)]
    user._ff_role_codes = (user.role, codes)
    return codes


def capabilities(user) -> set[str]:
    from .permissions import ROLE_CAPABILITIES

    table, any_role = _roles()
    codes = role_codes(user)
    if not any_role:  # roles not seeded (should not happen after migrate): behave as before
        return set().union(*(ROLE_CAPABILITIES.get(c, set()) for c in codes))
    return set().union(*(table.get(c, (frozenset(), 1))[0] for c in codes))


def level(user) -> int:
    """1 member, 2 manager, 3 admin: the highest of the user's roles."""
    from crm.scoping import ROLE_LEVEL

    table, any_role = _roles()
    codes = role_codes(user)
    if not any_role:
        return max(ROLE_LEVEL.get(c, 1) for c in codes)
    return max((table[c][1] for c in codes if c in table), default=1)
