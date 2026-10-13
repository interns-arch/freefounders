"""The company profile from the FreeFounders Platform (PLAN.md section 16).

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
]
_OWNER = {segment: key for key, _l, _d, _on, segments in MODULES for segment in segments}
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
    return [{"key": k, "label": label, "description": d, "default": on} for k, label, d, on, _s in MODULES]


def module_on(key: str) -> bool:
    """A module is on unless the company switched it off (no profile = everything on)."""
    return (profile().get("modules") or {}).get(key, True) is not False


def modules() -> dict[str, bool]:
    return {k: module_on(k) for k, *_rest in MODULES}


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
    known = {k for k, *_rest in MODULES}
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


class ModuleGateMiddleware:
    """Answers 404 for the API of a module the company switched off (PLAN.md §16.2).

    Runs after CompanyMiddleware, so the company is known. Without a company in
    multi-company mode it does nothing: that request fails closed anyway.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        key = module_for_path(request.path)
        if key and not (schemas.enabled() and not schemas.current()) and not module_on(key):
            return JsonResponse({"detail": "This module is switched off"}, status=404)
        return self.get_response(request)
