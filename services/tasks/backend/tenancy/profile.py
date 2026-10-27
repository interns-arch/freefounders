"""The company profile from the Kaampilot Platform (PLAN.md section 16).

The Platform owns the company's names, brand colour, logo and module
switches, and pushes a copy here (PUT /api/internal/company). It is kept in
the company's own CompanySetting table, so a standalone install -- which never
receives a profile -- looks and behaves exactly as before: every module on,
the built-in names and colours.
"""
import json
import threading
import time

from django.http import JsonResponse

from . import schemas

PROFILE_KEY = "FF_PROFILE"
VERSION_KEY = "FF_PROFILE_VERSION"

# key, label, description, on for a new company, the first URL segments under /api/ it owns.
# Modules not listed here (tasks, templates, groups, notices, attendance & leave) are always on.
MODULES = [
    ("leads", "Leads & quotations", "Sales pipeline, follow-ups, quotations and lead assignment rules", False,
     ("leads", "quotations", "assignment-rules")),
    ("intake", "AI inbox", "Reads the company mailbox and WhatsApp and turns messages into leads", False,
     ("intake", "webhooks")),
    ("payroll", "Payroll", "Salary structures, advances, payroll runs and payslips", False,
     ("salary-structures", "advances", "payroll-runs", "payslips")),
    ("mistakes", "Mistake register", "Mistakes, SOPs, escalations and digests", False,
     ("mistakes", "mistake-categories", "sops", "mistake-settings")),
    ("links", "Links", "Shared link collections", False, ("links", "link-collections")),
    ("visitors", "Visitors", "Gate register: visitors and vehicles in and out, open QR sign-in, guard activity", False,
     ("visitors",)),
]
# Modules added after companies already existed: a company that never chose is OFF (not on, as for the first ones), so
# a new module never appears by itself. A standalone install (no profile at all) still has everything on.
OPT_IN = {"visitors"}
_OWNER = {segment: key for key, _l, _d, _on, segments in MODULES for segment in segments}

# Plan areas (PLAN.md §24.1): Tasks and Attendance are sold one by one but live in this one app. The Platform pushes
# `tasks` / `attendance` in the profile's module switches from the company's plan (never from the Settings Center, so
# they are not in the catalogue above). Missing = on: a standalone install, Complete, the trial and older plans.
# key: (name in messages, the first URL segments under /api/ it owns)
PLAN_AREAS = {
    "tasks": ("Tasks", ("tasks", "task-categories", "task-change-requests", "task-completions", "task-settings",
                        "task-templates", "task-activities", "directory", "dashboard")),
    "attendance": ("Attendance", ("attendance", "attendance-corrections", "leave-types", "leaves", "office-locations",
                                  "hr", "holidays")),
}
_AREA_OF = {segment: area for area, (_n, segments) in PLAN_AREAS.items() for segment in segments}
# Switchable modules that come with a plan area: leads, AI inbox, mistakes and links with Tasks; payroll with Attendance.
MODULE_AREA = {"leads": "tasks", "intake": "tasks", "mistakes": "tasks", "links": "tasks", "payroll": "attendance"}
# Paths under a module's prefix that other, always-on screens use: the team list for Groups, templates, settings.
_SHARED = ("/api/leads/assignees/",)

_TTL = 30
_lock = threading.Lock()
_cache: dict[str, tuple[float, dict]] = {}


def _key() -> str:
    return schemas.current() or "-"


def profile() -> dict:
    """The last profile the Platform sent ({} when none)."""
    key = _key()
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _TTL:
            return hit[1]
    from .models import CompanySetting

    row = CompanySetting.objects.filter(key=PROFILE_KEY).first()
    try:
        data = json.loads(row.value) if row and row.value else {}
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    with _lock:
        _cache[key] = (now, data)
    return data


def forget() -> None:
    with _lock:
        _cache.clear()


def catalogue() -> list[dict]:
    """What the Platform's Settings Center can switch on or off."""
    return [{"key": k, "label": label, "description": d, "default": on, **({"optIn": True} if k in OPT_IN else {})}
            for k, label, d, on, _s in MODULES]


def plan_has(area: str) -> bool:
    """The company's plan includes this area ("tasks" / "attendance"); always true without a plan switch."""
    return (profile().get("modules") or {}).get(area) is not False


def module_on(key: str) -> bool:
    """A module is on unless the company switched it off (no profile = everything on; an opt-in module is off until the
    company switches it on) or its plan area is not in the plan."""
    if key in PLAN_AREAS:
        return plan_has(key)
    if key in MODULE_AREA and not plan_has(MODULE_AREA[key]):
        return False
    p = profile()
    switches = p.get("modules") or {}
    if key in switches:
        return switches[key] is not False
    return not (key in OPT_IN and p.get("name"))


def modules() -> dict[str, bool]:
    return {**{k: module_on(k) for k, *_rest in MODULES}, **{a: plan_has(a) for a in PLAN_AREAS}}


def brand() -> dict | None:
    """Names, colour and logo, or None for a standalone install (the app keeps its own look)."""
    p = profile()
    if not p.get("name"):
        return None
    return {"name": p["name"], "short_name": p.get("shortName") or p["name"], "colour": p.get("colour"), "logo_url": p.get("logoUrl")}


def app_name() -> str:
    """How emails and links name the app: the company's short name, else the original name."""
    b = brand()
    return b["short_name"] if b else "Automation Task"


def apply(data: dict) -> dict:
    """Stores a profile pushed by the Platform. An older version arriving late is ignored."""
    from .models import CompanySetting

    version = int(data.get("version"))
    row = CompanySetting.objects.filter(key=VERSION_KEY).first()
    current = int(row.value) if row and row.value.isdigit() else 0
    if version < current:
        return {"version": current, "applied": False}
    known = {k for k, *_rest in MODULES} | set(PLAN_AREAS)
    switches = {k: bool(v) for k, v in (data.get("modules") or {}).items() if k in known}
    stored = {
        "name": str(data.get("name") or "")[:120],
        "shortName": str(data.get("shortName") or "")[:40] or None,
        "colour": data.get("colour") if isinstance(data.get("colour"), str) and len(data["colour"]) == 7 else None,
        "logoUrl": data.get("logoUrl") if isinstance(data.get("logoUrl"), str) and data["logoUrl"].startswith("/") else None,
        "modules": switches,
    }
    CompanySetting.objects.update_or_create(key=PROFILE_KEY, defaults={"value": json.dumps(stored), "secret": False})
    CompanySetting.objects.update_or_create(key=VERSION_KEY, defaults={"value": str(version), "secret": False})
    forget()
    return {"version": version, "applied": True}


def module_for_path(path: str) -> str | None:
    """'/api/leads/5/' -> 'leads'; None for paths no switchable module owns."""
    parts = path.split("/")
    if len(parts) < 3 or parts[1] != "api" or path.startswith(_SHARED):
        return None
    return _OWNER.get(parts[2])


def area_for_path(path: str) -> str | None:
    """'/api/leaves/' -> 'attendance', '/api/leads/' -> 'tasks'; None for the shared parts (sign-in, people,
    notifications, badges, groups, notices, settings…), which stay open whatever the plan."""
    parts = path.split("/")
    if len(parts) < 3 or parts[1] != "api" or path.startswith(_SHARED):
        return None
    return _AREA_OF.get(parts[2]) or MODULE_AREA.get(_OWNER.get(parts[2], ""))


def not_in_plan(area: str) -> JsonResponse:
    return JsonResponse({"detail": f"{PLAN_AREAS[area][0]} is not in your plan. An owner can add it in Billing."},
                        status=403)


class ModuleGateMiddleware:
    """Answers 404 for the API of a module the company switched off (PLAN.md §16.2), and 403 for the API of a plan area
    (Tasks or Attendance) the company's plan does not include (§24.1).

    Runs after CompanyMiddleware, so the company is known. Without a company in
    multi-company mode it does nothing: that request fails closed anyway.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        area = area_for_path(request.path)
        key = module_for_path(request.path)
        if (area or key) and not (schemas.enabled() and not schemas.current()):
            if area and not plan_has(area):
                return not_in_plan(area)
            if key and not module_on(key):
                return JsonResponse({"detail": "This module is switched off"}, status=404)
        return self.get_response(request)
