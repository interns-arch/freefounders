"""The read-only Vehicle API (PLAN.md §22.12): a company gives its vehicle register to another system with an API key.

Server to server, no cookies, no Platform token. The key names its company (kpv_<code>_<secret>), so a request finds
its schema from the registry and looks the key up inside that schema only; nothing else about a company is shared.
Every bad key (malformed, unknown company, wrong secret, revoked, expired) gets the same 401. Only a SHA-256 of the key
is stored. Keys are managed at /api/visitors/api-keys/ by a company Owner or Admin.
"""
import functools
import hashlib
import hmac
import logging
import re
import secrets
import string
import time
from datetime import datetime, time as day_time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Prefetch
from django.db.models.functions import TruncDate
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts import access
from tenancy import log_sink, schemas
from tenancy.profile import module_on

from . import services as sv
from .models import GateAction, VehicleApiKey, VehicleEntry, VehicleType, Visit

logger = logging.getLogger("visitors.vehicle_api")

IST = ZoneInfo("Asia/Kolkata")
SCOPE = "vehicles:read"
SECRET_LENGTH = 40
PREFIX_LENGTH = 8
PREFIX_PATH = "/visitors/v1"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_SUMMARY_DAYS = 366
DEFAULT_RATE = "120/min"
LAST_USED_EVERY = timedelta(seconds=60)
# The secret has no "_", so the last "_" always ends the company code (which may hold one).
KEY_RE = re.compile(rf"^kpv_([a-z0-9_]{{1,50}})_([A-Za-z0-9]{{{SECRET_LENGTH}}})$")
RATE_RE = re.compile(r"(\d+)/([smhd])[a-z]*")
_ALPHABET = string.ascii_letters + string.digits
_PERIODS = {"s": 1, "m": 60, "h": 3600, "d": 86400}
_PASS_ON = ("from", "to", "status", "vehicle_number", "type", "purpose", "updated_since", "page_size")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _no_store(res):
    res["Cache-Control"] = "no-store"
    return res


def _error(status: int, code: str, message: str) -> JsonResponse:
    return _no_store(JsonResponse({"error": {"code": code, "message": message}}, status=status))


def _unauthorized() -> JsonResponse:
    res = _error(401, "unauthorized", "The API key is missing or not valid.")
    res["WWW-Authenticate"] = "Bearer"
    return res


# ---------------------------------------------------------------- keys

def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def make_key(name: str, actor, expires_at=None) -> tuple[VehicleApiKey, str]:
    """The new key's row and its full text: the only moment the text exists."""
    secret = "".join(secrets.choice(_ALPHABET) for _ in range(SECRET_LENGTH))
    raw = f"kpv_{sv.company_code()}_{secret}"
    row = VehicleApiKey.objects.create(name=name, prefix=secret[:PREFIX_LENGTH], key_hash=hash_key(raw), scope=SCOPE,
                                       created_by=actor, expires_at=expires_at)
    return row, raw


def _presented(request) -> str:
    """Only from the headers: a key in the URL would end up in every proxy log, so it is not read from there."""
    auth = request.headers.get("Authorization", "").strip()
    if auth:
        kind, _, value = auth.partition(" ")
        return value.strip() if kind.lower() == "bearer" else ""
    return request.headers.get("X-API-Key", "").strip()


def _find(raw: str, secret: str) -> VehicleApiKey | None:
    digest = hash_key(raw)
    found = None
    for row in VehicleApiKey.objects.filter(prefix=secret[:PREFIX_LENGTH]):
        if hmac.compare_digest(row.key_hash, digest):
            found = row
    if not found or found.scope != SCOPE or found.revoked_at or (found.expires_at and found.expires_at <= timezone.now()):
        return None
    return found


def _touch(key: VehicleApiKey) -> None:
    now = timezone.now()
    if not key.last_used_at or now - key.last_used_at >= LAST_USED_EVERY:
        VehicleApiKey.objects.filter(pk=key.pk).update(last_used_at=now)


def _rate() -> tuple[int, int]:
    """VEHICLE_API_RATE like 120/min; anything unreadable is the default."""
    match = RATE_RE.fullmatch(str(getattr(settings, "VEHICLE_API_RATE", "") or "").strip())
    if not match or int(match[1]) < 1:
        match = RATE_RE.fullmatch(DEFAULT_RATE)
    return int(match[1]), _PERIODS[match[2]]


def _over_limit(key: VehicleApiKey) -> int:
    """Seconds to wait, or 0. A fixed window per key per company, counted in the cache."""
    limit, period = _rate()
    now = int(time.time())
    name = f"vehicle_api:{schemas.current() or '-'}:{key.pk}:{now // period}"
    cache.add(name, 0, period + 5)
    try:
        used = cache.incr(name)
    except ValueError:  # expired between the two calls
        cache.set(name, 1, period + 5)
        used = 1
    return (period - now % period) if used > limit else 0


# ---------------------------------------------------------------- the frame around every endpoint

def _company_id(schema: str) -> str | None:
    """The registered company of a schema, or None. The code in a key is never trusted by itself."""
    try:
        with connection.cursor() as cur:
            cur.execute(f"SELECT company_id::text FROM {schemas.REGISTRY} WHERE schema_name = %s", [schema])
            row = cur.fetchone()
    except Exception:  # noqa: BLE001 -- no registry = no companies
        return None
    return row[0] if row else None


def _inside_company(request, raw, secret, fn, kwargs, seen):
    key = _find(raw, secret)
    if not key:
        return _unauthorized()
    seen["prefix"] = key.prefix
    if not module_on("visitors"):
        return _error(403, "module_off", "The Visitors module is not on for this company.")
    wait = _over_limit(key)
    if wait:
        res = _error(429, "rate_limited", f"Too many requests. Try again in {wait} seconds.")
        res["Retry-After"] = str(wait)
        return res
    _touch(key)
    try:
        return fn(request, **kwargs)
    except ApiError as e:
        return _error(e.status, e.code, e.message)


def _serve(request, fn, kwargs, seen):
    if request.method != "GET":
        res = _error(405, "method_not_allowed", "This API is read-only: use GET.")
        res["Allow"] = "GET"
        return res
    raw = _presented(request)
    match = KEY_RE.match(raw) if len(raw) <= 120 else None
    if not match:
        return _unauthorized()
    code, secret = match[1], match[2]
    if not schemas.enabled():
        return _inside_company(request, raw, secret, fn, kwargs, seen)
    try:
        schema = schemas.schema_for_code(code)
    except ValueError:
        return _unauthorized()
    company_id = _company_id(schema)
    if not company_id:
        return _unauthorized()
    seen["company_id"] = company_id
    with schemas.use(schema):
        return _inside_company(request, raw, secret, fn, kwargs, seen)


def _log_access(request, route: str, status: int, seen: dict) -> None:
    """Key prefix, path, status: never the key, the query or the answer. The sink gets the route, not the id, so
    identical calls fold into one entry and a busy client cannot use up its per-minute budget for real errors."""
    prefix = seen.get("prefix") or "-"
    logger.info("vehicle api %s %s %s %s", prefix, request.method, request.path, status)
    log_sink.report("info", "event", f"Vehicle API {prefix} {status}", event="vehicle_api.request", method=request.method,
                    path=f"/api{PREFIX_PATH}{route}", status=status, company_id=seen.get("company_id"))


def endpoint(route: str):
    def wrap(fn):
        @csrf_exempt
        @functools.wraps(fn)
        def view(request, **kwargs):
            seen: dict = {}
            try:
                res = _serve(request, fn, kwargs, seen)
            except Exception:  # noqa: BLE001 -- the same JSON shape; the cause goes to the error log only
                logger.exception("Vehicle API failed", extra={"request": request, "status_code": 500})
                res = _error(500, "server_error", "Something went wrong on our side. Please try again.")
            _log_access(request, route, res.status_code, seen)
            return res
        return view
    return wrap


# ---------------------------------------------------------------- reading a request

def _when(request, name: str, end: bool = False) -> datetime | None:
    """A date (IST; as an end it means the end of that day) or an ISO date-time (IST unless it has an offset)."""
    raw = (request.GET.get(name) or "").strip()
    if not raw:
        return None
    # An unencoded "+05:30" in a query string arrives as " 05:30".
    raw = re.sub(r"^(.+[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?) (\d\d:\d\d)$", r"\1+\2", raw)
    try:
        day = parse_date(raw)
        if day:
            return datetime.combine(day, day_time.max if end else day_time.min, IST)
        value = parse_datetime(raw)
    except ValueError:
        value = None
    if not value:
        raise ApiError(400, "bad_request", f"{name}: use a date like 2026-11-02 or a date-time like 2026-11-02T14:30:00+05:30.")
    return value if timezone.is_aware(value) else value.replace(tzinfo=IST)


def _whole(request, name: str, default: int) -> int:
    raw = (request.GET.get(name) or "").strip()
    if not raw:
        return default
    if not re.fullmatch(r"\d{1,7}", raw) or int(raw) < 1:
        raise ApiError(400, "bad_request", f"{name}: use a whole number from 1.")
    return int(raw)


def _base(request) -> str:
    """This API's own address as the caller sees it: the gateways (which set X-Forwarded-Host) serve /api as /tasks/api."""
    prefix = "/tasks/api" if request.META.get("HTTP_X_FORWARDED_HOST") else "/api"
    return f"{request.scheme}://{request.get_host()}{prefix}{PREFIX_PATH}"


def _iso(value) -> str | None:
    return value.astimezone(IST).isoformat(timespec="seconds") if value else None


def _host(visit: Visit) -> dict | None:
    if visit.host_id:
        return {"name": sv.name_of(visit.host), "department": visit.host.get_department_display()}
    return {"name": visit.host_label, "department": ""} if visit.host_label else None


def _row(e: VehicleEntry, base: str, now) -> dict:
    visits = list(e.visits.all())

    def photo(which, f):
        return f"{base}/vehicles/{e.pk}/photos/{which}/" if f else None

    return {
        "id": e.pk,
        "vehicle_number": e.number,
        "type": e.type,
        "type_label": e.get_type_display(),
        "driver_name": e.driver_name,
        "driver_mobile": e.driver_mobile,
        "company": e.company,
        "purpose": e.purpose,
        "host": next((h for h in map(_host, visits) if h), None),
        "visits": [{"id": v.pk, "visitor_name": v.name, "people": v.people, "host": _host(v)} for v in visits],
        "visitor_names": [v.name for v in visits],
        "in_time": _iso(e.in_at),
        "out_time": _iso(e.out_at),
        "minutes_inside": e.minutes_inside(now),
        "status": "inside" if e.out_at is None else "out",
        "gate": {"id": e.location.pk, "name": e.location.name} if e.location else None,
        "parking_slot": e.parking_slot,
        "checked_in_by": sv.name_of(e.in_by) or None,
        "checked_out_by": sv.name_of(e.out_by) or None,
        "items": e.items,
        "notes": e.notes,
        "photos": {"in": photo("in", e.photo_in), "out": photo("out", e.photo_out)},
        "anonymised": e.anonymised,
        "updated_at": _iso(e.updated_at),
    }


def _rows():
    linked = Visit.objects.select_related("host").order_by("id")
    return (VehicleEntry.objects.select_related("location", "in_by", "out_by")
            .prefetch_related(Prefetch("visits", queryset=linked)).order_by("-in_at", "-id"))


def _page(request, qs, default_size: int = DEFAULT_PAGE_SIZE) -> JsonResponse:
    size = min(_whole(request, "page_size", default_size), MAX_PAGE_SIZE)
    page = _whole(request, "page", 1)
    count = qs.count()
    base = _base(request)
    now = timezone.now()
    results = [_row(e, base, now) for e in qs[(page - 1) * size:page * size]]

    def link(number):
        query = request.GET.copy()
        for name in list(query):
            if name not in _PASS_ON:
                del query[name]
        query["page"] = number
        return f"{base}{request.path.split(PREFIX_PATH, 1)[1]}?{query.urlencode()}"

    last = max(1, (count + size - 1) // size)
    return _no_store(JsonResponse({"count": count, "next": link(page + 1) if page < last else None,
                                   "previous": link(min(page - 1, last)) if page > 1 else None, "results": results}))


# ---------------------------------------------------------------- the endpoints

@endpoint("/vehicles/")
def vehicles(request):
    qs = _rows()
    start, end, since = _when(request, "from"), _when(request, "to", end=True), _when(request, "updated_since")
    if start:
        qs = qs.filter(in_at__gte=start)
    if end:
        qs = qs.filter(in_at__lte=end)
    if since:
        qs = qs.filter(updated_at__gte=since)
    status = (request.GET.get("status") or "all").strip().lower()
    if status not in ("inside", "out", "all"):
        raise ApiError(400, "bad_request", "status: use inside, out or all.")
    if status != "all":
        qs = qs.filter(out_at__isnull=status == "inside")
    raw_number = request.GET.get("vehicle_number") or ""
    if raw_number.strip():
        number = re.sub(r"[^A-Z0-9]", "", raw_number.upper())
        if not number:
            raise ApiError(400, "bad_request", "vehicle_number: use letters and digits, like MH12.")
        qs = qs.filter(number__icontains=number)
    kind = (request.GET.get("type") or "").strip().lower()
    if kind:
        if kind not in VehicleType.values:
            raise ApiError(400, "bad_request", f"type: use one of {', '.join(VehicleType.values)}.")
        qs = qs.filter(type=kind)
    purpose = (request.GET.get("purpose") or "").replace("\x00", "").strip()
    if purpose:
        qs = qs.filter(purpose__icontains=purpose[:120])
    return _page(request, qs)


@endpoint("/vehicles/inside/")
def vehicles_inside(request):
    return _page(request, _rows().filter(out_at__isnull=True), default_size=MAX_PAGE_SIZE)


@endpoint("/vehicles/summary/")
def vehicles_summary(request):
    today = timezone.localtime(timezone=IST).date()
    end = _when(request, "to", end=True) or datetime.combine(today, day_time.max, IST)
    start = _when(request, "from") or datetime.combine(end.astimezone(IST).date() - timedelta(days=29), day_time.min, IST)
    first, last = start.astimezone(IST).date(), end.astimezone(IST).date()
    if first > last:
        raise ApiError(400, "bad_request", "from must not be after to.")
    if (last - first).days >= MAX_SUMMARY_DAYS:
        raise ApiError(400, "range_too_long", f"Ask for at most {MAX_SUMMARY_DAYS} days at a time.")
    qs = VehicleEntry.objects.filter(in_at__gte=start, in_at__lte=end).order_by()
    per_day = dict(qs.annotate(day=TruncDate("in_at", tzinfo=IST)).values_list("day").annotate(n=Count("id")))
    per_type = dict(qs.values_list("type").annotate(n=Count("id")))
    stays = qs.filter(out_at__isnull=False).annotate(stay=ExpressionWrapper(F("out_at") - F("in_at"), DurationField()))
    out = stays.aggregate(n=Count("id"), average=Avg("stay"), longest=Max("stay"))

    def minutes(stay):
        return max(0, int(stay.total_seconds() // 60)) if stay is not None else None

    total = sum(per_day.values())
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    return _no_store(JsonResponse({
        "from": first.isoformat(),
        "to": last.isoformat(),
        "entries": total,
        "checked_out": out["n"],
        "still_inside": total - out["n"],
        "average_minutes_inside": minutes(out["average"]),
        "longest_minutes_inside": minutes(out["longest"]),
        "per_day": [{"date": d.isoformat(), "count": per_day.get(d, 0)} for d in days],
        "per_type": [{"type": value, "label": label, "count": per_type[value]}
                     for value, label in VehicleType.choices if value in per_type],
    }))


def _one(pk) -> VehicleEntry:
    e = _rows().filter(pk=int(pk)).first()
    if not e:
        raise ApiError(404, "not_found", "No vehicle record with this id.")
    return e


@endpoint("/vehicles/<id>/")
def vehicle_detail(request, pk):
    return _no_store(JsonResponse(_row(_one(pk), _base(request), timezone.now())))


@endpoint("/vehicles/<id>/photos/<which>/")
def vehicle_photo(request, pk, which):
    e = _one(pk)
    f = e.photo_in if which == "in" else e.photo_out
    if not f:
        raise ApiError(404, "not_found", "This record has no such photo.")
    try:
        handle = f.open("rb")
    except OSError:
        raise ApiError(404, "not_found", "This record has no such photo.") from None
    # Every gate photo is stored as a JPEG (services.store_photo).
    res = FileResponse(handle, content_type="image/jpeg", filename=f"vehicle-{e.pk}-{which}.jpg")
    res["Cache-Control"] = "private, no-store"
    res["X-Content-Type-Options"] = "nosniff"
    return res


@endpoint("/<unknown>")
def not_found(request):
    raise ApiError(404, "not_found", "No such address in this API.")


# ---------------------------------------------------------------- Visitors -> Settings -> API access

def can_manage(user) -> bool:
    """Owner or Admin only: a key reads every vehicle record, drivers' numbers included, with no person behind it."""
    return access.is_admin(user) or access.is_owner(user)


def _key_row(k: VehicleApiKey) -> dict:
    now = timezone.now()
    state = "revoked" if k.revoked_at else "expired" if k.expires_at and k.expires_at <= now else "active"
    return {"id": k.pk, "name": k.name, "hint": f"kpv_{sv.company_code()}_{k.prefix}…", "scope": k.scope,
            "created_by": sv.name_of(k.created_by) or None, "created_at": _iso(k.created_at),
            "last_used_at": _iso(k.last_used_at), "expires_at": _iso(k.expires_at), "revoked_at": _iso(k.revoked_at),
            "revoked_by": sv.name_of(k.revoked_by) or None, "state": state}


def _need_manager(user) -> None:
    if not can_manage(user):
        raise PermissionDenied("Only an Owner or Admin can manage API keys.")


def _expiry(raw) -> datetime | None:
    """A date or a date-time in the future; a date means the end of that day (IST)."""
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        day = parse_date(text)
        value = datetime.combine(day, day_time.max, IST) if day else parse_datetime(text)
    except ValueError:
        value = None
    if not value:
        raise ValidationError({"expires_at": "Enter a date like 2027-03-31."})
    value = value if timezone.is_aware(value) else value.replace(tzinfo=IST)
    if value <= timezone.now():
        raise ValidationError({"expires_at": "The end date must be in the future."})
    return value


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def api_keys_view(request):
    _need_manager(request.user)
    if request.method == "GET":
        return Response([_key_row(k) for k in VehicleApiKey.objects.select_related("created_by", "revoked_by")])
    data = request.data if isinstance(request.data, dict) else {}
    name = " ".join(str(data.get("name") or "").split())[:80]
    if not name:
        raise ValidationError({"name": "Say who the key is for, e.g. Senior manager."})
    row, raw = make_key(name, request.user, _expiry(data.get("expires_at")))
    sv.log(request.user, GateAction.API_KEY, f"Vehicle API key made: {name} ({row.prefix})")
    return _no_store(Response({**_key_row(row), "key": raw}, status=201))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def api_key_revoke_view(request, pk):
    _need_manager(request.user)
    row = VehicleApiKey.objects.select_related("created_by", "revoked_by").filter(pk=pk).first()
    if not row:
        return Response({"detail": "This key was not found."}, status=404)
    if not row.revoked_at:
        row.revoked_at, row.revoked_by = timezone.now(), request.user
        row.save(update_fields=["revoked_at", "revoked_by"])
        sv.log(request.user, GateAction.API_KEY, f"Vehicle API key revoked: {row.name} ({row.prefix})")
    return Response(_key_row(row))
