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

# The catalogue version (PLAN.md §19.19). 2 = every feature is its own permission (2026-10-12). Roles saved
# before it are upgraded once with the `upgrade` rules below: by the data migration here, by the Platform for
# its own copy (it reads these rules from GET /internal/permissions), and on a push from a Platform that has not
# upgraded yet (`catalogueVersions.tasks` < 2). The rules are frozen: a later change adds version 3 with its own.
CATALOGUE_VERSION = 2

_TEAM_UP = ("team", "department", "company")
EVERYONE = [{"everyone": True}]


def _caps(prefix, scopes, department_cap=None):
    """Capability strings of a scoped permission: <prefix>_team / _department / _all (department may keep an old name)."""
    names = {"own": f"{prefix}_own", "team": f"{prefix}_team", "department": department_cap or f"{prefix}_department",
             "company": f"{prefix}_all"}
    return {s: names[s] for s in scopes}


# For managers' attendance screens, who had them before: HR administrators and view-all saw the company,
# department approvers their department (PLAN.md §19.15).
_ATTENDANCE_VIEW = [{"from": "hr.manage", "scope": "company"},
                    {"from": "tasks.view", "fromScopes": ["company"], "scope": "company"},
                    {"from": "hr.approve", "scope": "department"}]


def _p(key, label, group, description, scopes=None, upgrade=None, legacy_scope=None, super_admin_only=False):
    """One permission. `scopes`: {scope: capability} (None = yes/no; the key is the capability).
    `upgrade`: who gets it when a role from before version 2 is upgraded (see upgrade_grants)."""
    return {"key": key, "label": label, "group": group, "description": description, "scopes": scopes,
            "upgrade": upgrade or [], "legacy_scope": legacy_scope, "super_admin_only": super_admin_only}


# In menu order. Groups are what the role builder shows as headings.
CATALOGUE = [
    # ── Tasks ──
    _p("tasks.view", "See tasks", "Tasks",
       "Whose tasks they see. Company also makes them a task admin: they edit any task directly and decide escalated requests.",
       {"own": "tasks.view_self", "team": "tasks.view_own", "department": "tasks.view_department", "company": "tasks.view_all"}),
    _p("tasks.assign", "Give tasks to others", "Tasks",
       "Assign tasks to other people, and add or approve task categories."),
    _p("groups.create", "Create groups", "Tasks",
       "Start new groups; they run the groups they own.", upgrade=[{"from": "tasks.assign"}]),
    _p("templates.manage", "Task templates", "Tasks",
       "Create, edit and delete task templates, and copy templates from the directory.", upgrade=[{"from": "tasks.assign"}]),
    _p("directory.view", "Template directory", "Tasks",
       "Browse ready-made task templates and create tasks from them.", upgrade=EVERYONE),
    _p("tasks.reports", "Reports", "Tasks",
       "Employee reports, effort disputes and the group dashboard, for the people whose tasks they see.",
       upgrade=[{"from": "tasks.view", "fromScopes": ["department", "company"]}]),
    _p("tasks.team_performance", "Team performance", "Tasks",
       "Everyone in the company ranked by score, and sending the Monday overdue email.",
       upgrade=[{"from": "tasks.view", "fromScopes": ["company"]}]),
    _p("tasks.bin", "Deleted tasks", "Tasks",
       "Open the Deleted bin and restore tasks.", upgrade=[{"from": "tasks.view", "fromScopes": ["company"]}]),
    _p("tasks.delete_admin_work", "Delete work assigned to an admin", "Tasks",
       "Delete or cancel tasks given to an Admin-level person (nobody else can).", super_admin_only=True),
    _p("dashboard.view", "Team dashboard", "Tasks",
       "Lead and task totals for the people they see, on Tasks Home (with Leads on)."),
    _p("notifications.view", "Notifications", "Tasks",
       "Their notifications list and the bell.", upgrade=EVERYONE),
    _p("tasks.settings", "Task settings", "Tasks",
       "Completion rules (proof, remarks) and which events also go by email or WhatsApp.",
       upgrade=[{"from": "settings.manage"}]),
    # ── Leads ──
    _p("leads.view", "See leads", "Leads", "Whose leads they see.",
       {"own": "leads.view_own", "team": "leads.view_team", "department": "leads.view_department", "company": "leads.view_all"}),
    _p("leads.view_won", "See won leads (accounts)", "Leads", "Won leads only, for billing and accounts."),
    _p("leads.edit", "Edit leads", "Leads", "Whose leads they can change.",
       {"own": "leads.edit_own", "team": "leads.edit_team", "department": "leads.edit_department", "company": "leads.edit_all"}),
    _p("leads.assign", "Assign leads", "Leads", "Give leads to people and change who owns them."),
    _p("quotations.manage", "Quotations", "Leads", "Create and edit quotations on the leads they can edit."),
    _p("leads.delete", "Delete leads", "Leads", "Remove a lead for good.", upgrade=[{"minLevel": 3}]),
    _p("leads.rules", "Lead assignment rules", "Leads", "Decide who new leads go to automatically.",
       upgrade=[{"minLevel": 3}]),
    _p("intake.view", "AI inbox", "Leads", "Messages that came in by WhatsApp or email, and the leads they became."),
    # ── Notices ──
    _p("notices.view", "See notices", "Notices", "Read the notice board.", upgrade=EVERYONE),
    _p("notices.publish", "Publish notices", "Notices",
       "Write, schedule and take down notices for everyone or chosen people.", upgrade=[{"from": "settings.manage"}]),
    # ── Mistakes & SOPs ──
    _p("mistakes.view", "Mistakes and SOPs", "Mistakes & SOPs",
       "Their own mistakes (they can log their own) and the SOP library.", upgrade=EVERYONE),
    _p("mistakes.log", "Log mistakes for others", "Mistakes & SOPs",
       "Record a mistake against someone else.", upgrade=[{"from": "tasks.assign"}]),
    _p("mistakes.review", "Review mistakes", "Mistakes & SOPs",
       "See and close mistakes in their department or the whole company. A manager always reviews their own reports' mistakes.",
       _caps("mistakes.review", ("department", "company")),
       upgrade=[{"from": "tasks.view", "fromScopes": ["department"], "scope": "department"},
                {"from": "tasks.view", "fromScopes": ["company"], "scope": "company"}]),
    _p("sops.manage", "Write SOPs", "Mistakes & SOPs", "Add, edit and version SOPs.", upgrade=[{"from": "tasks.assign"}]),
    _p("mistakes.settings", "Mistake categories and rules", "Mistakes & SOPs",
       "Mistake categories and response-time rules.", upgrade=[{"from": "settings.manage"}]),
    # ── Links ── (Web forms and the Idea board were removed on 2026-10-13, PLAN.md §19.23: their
    # forms.* / ideas.* permissions are gone; leftover grants are deleted by accounts 0022 and ignored if pushed)
    _p("links.view", "Links", "Links", "Use the shared link library.", upgrade=EVERYONE),
    _p("links.manage", "Manage links", "Links",
       "Add link collections and edit anyone's links.", upgrade=[{"from": "tasks.assign"}]),
    # ── Attendance: their own ──
    _p("attendance.punch", "Punch in and out", "My attendance",
       "Mark their own attendance each day (with location and photo when the company asks).", upgrade=EVERYONE),
    _p("attendance.self", "My attendance", "My attendance",
       "Their attendance history, and asking for a correction.", upgrade=EVERYONE),
    _p("leave.self", "My leave", "My attendance", "Apply for leave and see their balances.", upgrade=EVERYONE),
    _p("holidays.view", "Holidays", "My attendance", "The company's holiday list.", upgrade=EVERYONE),
    _p("payroll.self", "My salary", "My attendance", "Their own payslips (with Payroll on).", upgrade=EVERYONE),
    # ── Attendance: other people ──
    _p("hr.approve", "Approve leave and corrections", "Team attendance",
       "Decide leave requests and attendance corrections for their team, their department or everyone.",
       _caps("hr.approve", _TEAM_UP, department_cap="hr.approve"),
       upgrade=[{"from": "hr.manage", "scope": "company"}], legacy_scope="department"),
    _p("hr.live", "Live attendance", "Team attendance", "Who is in, late or not in yet, right now.",
       _caps("hr.live", _TEAM_UP), upgrade=_ATTENDANCE_VIEW),
    _p("hr.daily", "Daily attendance", "Team attendance", "Everyone's attendance on any day.",
       _caps("hr.daily", _TEAM_UP), upgrade=_ATTENDANCE_VIEW),
    _p("hr.dashboard", "Attendance dashboard", "Team attendance",
       "Month totals per person: present, late, absent, leave.", _caps("hr.dashboard", _TEAM_UP), upgrade=_ATTENDANCE_VIEW),
    _p("hr.reports", "Attendance reports", "Team attendance",
       "Download daily, monthly, late and leave reports.", _caps("hr.reports", _TEAM_UP), upgrade=_ATTENDANCE_VIEW),
    _p("hr.import", "Import attendance", "Team attendance",
       "Upload attendance from a spreadsheet.", upgrade=[{"from": "hr.manage"}]),
    _p("hr.mark", "Mark attendance by hand", "Team attendance",
       "Set someone present, half day or absent for a day.", upgrade=[{"from": "hr.manage"}]),
    # ── HR administration ──
    _p("holidays.manage", "Manage holidays", "HR administration",
       "Add and remove company holidays.", upgrade=[{"from": "settings.manage"}]),
    _p("hr.settings", "HR settings", "HR administration",
       "Working hours, week-offs, punch-in locations and photo, leave types and approval rules.",
       upgrade=[{"from": "hr.manage"}]),
    _p("payroll.run", "Run payroll", "HR administration",
       "Create, generate, finalise and export payroll; see everyone's payslips.", upgrade=[{"from": "hr.manage"}]),
    _p("payroll.salaries", "Salaries and advances", "HR administration",
       "Set people's salary structures and record advances.", upgrade=[{"from": "hr.manage"}]),
    # ── Administration ──
    _p("users.manage", "Manage users", "Administration",
       "Tasks user accounts: add, edit and switch off (with the Platform, people are managed in Admin → People)."),
    _p("settings.manage", "Company settings", "Administration",
       "Departments, AI inbox test messages and the template directory library."),
]

# Permissions that no longer exist on their own: still accepted (old pushes, old roles) and read as what they used
# to cover, but not offered in the role builder; the upgrade replaces them with the permissions below.
RETIRED = {
    "hr.manage": {"hr.approve_all", "hr.live_all", "hr.daily_all", "hr.dashboard_all", "hr.reports_all",
                  "hr.import", "hr.mark", "hr.settings", "payroll.run", "payroll.salaries"},
}

# Powers only the Owner (Super Admin) role gets by default.
SUPER_ADMIN_ONLY = {p["key"] for p in CATALOGUE if p["super_admin_only"]}
_BY_KEY = {p["key"]: p for p in CATALOGUE}
# capability string -> (permission key, scope) for scoped capabilities
_SCOPED_CAP = {cap: (p["key"], scope) for p in CATALOGUE if p["scopes"] for scope, cap in p["scopes"].items()}


def catalogue() -> list[dict]:
    """What the Platform's role builder shows for Tasks (label, group, one-line description, scopes, upgrade rules)."""
    return [
        {"key": p["key"], "label": p["label"], "group": p["group"], "description": p["description"],
         "scopes": list(p["scopes"]) if p["scopes"] else None, "superAdminOnly": p["super_admin_only"],
         **({"legacyScope": p["legacy_scope"]} if p["legacy_scope"] else {}),
         **({"upgrade": p["upgrade"]} if p["upgrade"] else {})}
        for p in CATALOGUE
    ]


def grants_from_capabilities(capabilities) -> list[tuple[str, str]]:
    """Capability strings -> (permission, scope) grants."""
    out = {}
    for cap in capabilities:
        if cap in _SCOPED_CAP:
            key, scope = _SCOPED_CAP[cap]
            if key not in out or SCOPES.index(scope) > SCOPES.index(out[key]):
                out[key] = scope
        elif cap in _BY_KEY or cap in RETIRED:
            out[cap] = ""
    return sorted(out.items())


def _normal_scope(permission: str, scope: str) -> str:
    """A permission that gained scopes reads an old blank scope as what it meant before (hr.approve: department)."""
    entry = _BY_KEY.get(permission)
    if entry and entry["scopes"] and scope not in entry["scopes"] and entry["legacy_scope"]:
        return entry["legacy_scope"]
    return scope


def capabilities_from_grants(grants) -> set[str]:
    """(permission, scope) grants -> capability strings the code checks."""
    caps = set()
    for permission, scope in grants:
        if permission in RETIRED:
            caps |= RETIRED[permission]
            continue
        entry = _BY_KEY.get(permission)
        if entry is None:
            continue
        scopes = entry["scopes"]
        if scopes:
            scope = _normal_scope(permission, scope)
            if scope in scopes:
                caps.add(scopes[scope])
        else:
            caps.add(permission)
    return caps


def valid_grant(permission: str, scope: str) -> bool:
    if permission in RETIRED:
        return scope in ("", None)
    entry = _BY_KEY.get(permission)
    if entry is None:
        return False
    if entry["scopes"]:
        return scope in entry["scopes"] or (scope in ("", None) and bool(entry["legacy_scope"]))
    return scope in ("", None)


def _wider(a: str | None, b: str) -> str:
    if a is None:
        return b
    if a in SCOPES and b in SCOPES:
        return a if SCOPES.index(a) >= SCOPES.index(b) else b
    return a or b


def _rule_matches(rule: dict, had: dict, level: int) -> bool:
    if rule.get("everyone"):
        return True
    if "minLevel" in rule:
        return level >= int(rule["minLevel"])
    if "from" in rule:
        if rule["from"] not in had:
            return False
        return not rule.get("fromScopes") or had[rule["from"]] in rule["fromScopes"]
    return False


def upgrade_grants(grants: dict, level: int = 1, from_version: int = 1) -> dict:
    """A role's Tasks grants {permission: scope} saved under an older catalogue -> the same powers in this one.

    Only roles with at least one Tasks grant are touched (a role for another app stays empty here). Old blank scopes
    are read as before, every permission whose rules match is added at the widest matching scope, and retired
    permissions are replaced by what they covered. Nobody loses anything they could do."""
    if not grants or from_version >= CATALOGUE_VERSION:
        return dict(grants or {})
    had = {k: _normal_scope(k, v or "") for k, v in grants.items()}
    out = {k: v for k, v in had.items() if k not in RETIRED}
    for p in CATALOGUE:
        for rule in p["upgrade"]:
            if not _rule_matches(rule, had, level):
                continue
            scope = rule.get("scope", "") if p["scopes"] else ""
            out[p["key"]] = _wider(out.get(p["key"]), scope) if p["scopes"] else ""
    return out


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

    if "access_roles" in getattr(user, "_prefetched_objects_cache", {}):  # a list page prefetched them
        synced = [ar.role.code for ar in user.access_roles.all()]
    else:
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


def scope_of(user, permission: str) -> str | None:
    """How far a scoped permission reaches for this user ('team', 'department', 'company'…), "" for a yes/no
    permission they have, None when they do not have it."""
    entry = _BY_KEY[permission]
    caps = capabilities(user) if getattr(user, "is_authenticated", True) else set()
    if not entry["scopes"]:
        return "" if permission in caps else None
    for scope in reversed(SCOPES):
        cap = entry["scopes"].get(scope)
        if cap and cap in caps:
            return scope
    return None


def widest(*scopes) -> str | None:
    """The widest of these scopes (None ignored)."""
    out = None
    for s in scopes:
        if s is not None:
            out = _wider(out, s)
    return out


def level(user) -> int:
    """1 member, 2 manager, 3 admin: the highest of the user's roles."""
    from crm.scoping import ROLE_LEVEL

    table, any_role = _roles()
    codes = role_codes(user)
    if not any_role:
        return max(ROLE_LEVEL.get(c, 1) for c in codes)
    return max((table[c][1] for c in codes if c in table), default=1)


# --- questions the app asks instead of comparing role names --------------------

def is_admin(user) -> bool:
    """A company admin: any role at level 3 (built in: Admin and Super Admin)."""
    return bool(user and getattr(user, "is_authenticated", True)) and level(user) >= 3


def is_super_admin(user) -> bool:
    """The one power only Super Admin has: deleting work assigned to an admin."""
    from .permissions import has_capability
    return has_capability(user, "tasks.delete_admin_work")


def is_owner(user) -> bool:
    """The company Owner, the one person who may change their own attendance and pay records.

    Tasks keeps no owner flag of its own. The power only the Owner's role holds is `tasks.delete_admin_work`
    (super_admin_only: the Platform's Owner role, and the built-in Super Admin role in a standalone install),
    so holding it is what makes someone the Owner here. A Platform admin given Super Admin in Tasks counts too."""
    return is_super_admin(user)


def role_codes_with(capability: str) -> list[str]:
    from .permissions import ROLE_CAPABILITIES

    table, any_role = _roles()
    if not any_role:
        return [r for r, caps in ROLE_CAPABILITIES.items() if capability in caps]
    return [code for code, (caps, _lvl) in table.items() if capability in caps]


def role_codes_at_level(minimum: int) -> list[str]:
    from crm.scoping import ROLE_LEVEL

    table, any_role = _roles()
    if not any_role:
        return [r for r, lvl in ROLE_LEVEL.items() if lvl >= minimum]
    return [code for code, (_caps, lvl) in table.items() if lvl >= minimum]


def _holding(codes):
    """Active users whose counting roles include one of `codes` (see role_codes)."""
    from django.db.models import Q

    from .models import User

    return User.objects.filter(is_active=True).filter(
        Q(access_roles__isnull=True, role__in=codes) | Q(access_roles__role__code__in=codes, access_roles__role__archived=False)
    ).distinct()


def users_with(capability: str):
    return _holding(role_codes_with(capability))


def users_at_level(minimum: int):
    return _holding(role_codes_at_level(minimum))


def role_level(code: str) -> int:
    """Level of one role code (1 when unknown)."""
    from crm.scoping import ROLE_LEVEL

    table, any_role = _roles()
    if not any_role:
        return ROLE_LEVEL.get(code, 1)
    return table[code][1] if code in table else 1
