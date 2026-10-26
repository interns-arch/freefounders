"""Visitors API (PLAN.md §22): /api/visitors/..."""
import hashlib
import hmac
import re
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import connection
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from config.exports import ExportMixin, export_file, export_format

from . import conf, services as sv
from .models import GateAction, GateLog, VehicleEntry, Visit, VisitStatus


def _brief(u):
    return {"id": u.pk, "name": sv.name_of(u), "department": u.get_department_display()} if u else None


def _loc(location):
    return {"id": location.pk, "name": location.name} if location else None


def _dt(v):
    return timezone.localtime(v).isoformat() if v else None


def visit_row(v: Visit, now=None):
    mins = v.minutes_inside(now)
    return {
        "id": v.pk, "visitor": v.visitor_id, "name": v.name, "mobile": v.mobile, "company": v.company,
        "host": _brief(v.host), "host_label": v.host_label, "location": _loc(v.location), "purpose": v.purpose,
        "people": v.people, "status": v.status, "status_display": v.get_status_display(), "source": v.source,
        "pass_no": v.pass_no, "pass_token": v.pass_token, "short_code": v.short_code, "has_photo": bool(v.photo),
        "id_type": v.id_type, "id_last4": v.id_last4, "vehicle_no": v.vehicle_no, "vehicle": v.vehicle_id,
        "items": v.items, "notes": v.notes, "created_at": _dt(v.created_at), "check_in_at": _dt(v.check_in_at),
        "check_in_by": sv.name_of(v.check_in_by), "check_out_at": _dt(v.check_out_at),
        "check_out_by": sv.name_of(v.check_out_by), "minutes_inside": mins, "overstay": bool(v.overstay_alerted_at),
        "host_decision_at": _dt(v.host_decision_at), "returning": (v.visitor.visits if v.visitor_id else 0) > 1,
    }


def vehicle_row(e: VehicleEntry, now=None):
    return {
        "id": e.pk, "number": e.number, "type": e.type, "type_display": e.get_type_display(),
        "driver_name": e.driver_name, "driver_mobile": e.driver_mobile, "purpose": e.purpose, "company": e.company,
        "items": e.items, "parking_slot": e.parking_slot, "notes": e.notes, "location": _loc(e.location),
        "has_photo_in": bool(e.photo_in), "has_photo_out": bool(e.photo_out), "in_at": _dt(e.in_at),
        "in_by": sv.name_of(e.in_by), "out_at": _dt(e.out_at), "out_by": sv.name_of(e.out_by), "inside": e.out_at is None,
        "minutes_inside": e.minutes_inside(now), "visits": [{"id": v.pk, "name": v.name} for v in e.visits.all()],
    }


def _day_range(request):
    def parse(name):
        raw = request.query_params.get(name) or ""
        try:
            return datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            return None
    return parse("date_from"), parse("date_to")


def _aware(d, end=False):
    return timezone.make_aware(datetime.combine(d + (timedelta(days=1) if end else timedelta()), time.min))


def _photo(f):
    if not f:
        raise Http404("No photo")
    res = FileResponse(f.open("rb"), content_type="image/jpeg")
    res["Cache-Control"] = "private, max-age=3600"
    res["X-Content-Type-Options"] = "nosniff"
    return res


def _need(ok, what="Your role does not include this."):
    if not ok:
        raise PermissionDenied(what)


class _List(ExportMixin):
    """List rows built by a function (not a serializer)."""
    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(qs)
        now = timezone.now()
        rows = [self.row(x, now) for x in (page if page is not None else qs)]
        return self.get_paginated_response(rows) if page is not None else Response(rows)

    def retrieve(self, request, *args, **kwargs):
        return Response(self.row(self.get_object()))


class VisitViewSet(_List, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    export_name = "visitors"
    export_columns = [
        ("Pass", "pass_no"), ("Name", "name"), ("Mobile", "mobile"), ("From", "company"), ("Purpose", "purpose"),
        ("Host", lambda r: (r["host"] or {}).get("name") or r["host_label"]), ("Gate", "location.name"),
        ("People", "people"), ("Status", "status_display"), ("In", "check_in_at"), ("Out", "check_out_at"),
        ("Minutes inside", "minutes_inside"), ("Vehicle", "vehicle_no"), ("Items", "items"), ("ID", lambda r: f"{r['id_type']} …{r['id_last4']}" if r["id_last4"] else ""),
        ("Checked in by", "check_in_by"), ("Checked out by", "check_out_by"), ("Came by", "source"), ("Notes", "notes"),
    ]

    def row(self, v, now=None):
        return visit_row(v, now)

    def get_queryset(self):
        u = self.request.user
        qs = sv.visible_visits(u).select_related("host", "location", "visitor", "check_in_by", "check_out_by")
        if self.action != "list":
            return qs
        p = self.request.query_params
        scope = p.get("scope") or ""
        start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
        if scope == "today":
            qs = qs.filter(Q(created_at__gte=start) | Q(status__in=sv.ACTIVE))
        elif scope == "inside":
            qs = qs.filter(status=VisitStatus.INSIDE)
        elif scope == "waiting":
            qs = qs.filter(status__in=(VisitStatus.WAITING, VisitStatus.WAITING_HOST))
        elif scope == "mine":
            qs = qs.filter(host=u)
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        d1, d2 = _day_range(self.request)
        if d1:
            qs = qs.filter(created_at__gte=_aware(d1))
        if d2:
            qs = qs.filter(created_at__lt=_aware(d2, end=True))
        for key, field in (("host", "host_id"), ("location", "location_id")):
            if (p.get(key) or "").isdigit():
                qs = qs.filter(**{field: int(p[key])})
        if p.get("purpose"):
            qs = qs.filter(purpose__iexact=p["purpose"])
        if p.get("company"):
            qs = qs.filter(company__icontains=p["company"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(mobile__icontains=q) | Q(company__icontains=q) | Q(pass_no__iexact=q)
                           | Q(short_code__iexact=q) | Q(vehicle_no__icontains=q.replace(" ", "").upper()))
        return qs.order_by("-created_at")

    def create(self, request):
        _need(sv.can_gate(request.user))
        return Response(visit_row(sv.check_in(request.user, request.data)), status=201)

    def partial_update(self, request, pk=None):
        v = self.get_object()
        _need(sv.can_gate(request.user) or sv.can_view_all(request.user))
        return Response(visit_row(sv.edit_visit(request.user, v, request.data)))

    @action(detail=True, methods=["post"])
    def checkout(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return Response(visit_row(sv.check_out(request.user, self.get_object())))

    @action(detail=False, methods=["post"])
    def checkout_pass(self, request):
        _need(sv.can_gate(request.user))
        v = sv.find_pass(request.data.get("code"))
        if not v:
            raise ValidationError({"code": "No visitor pass with this code."})
        return Response(visit_row(sv.check_out(request.user, v)))

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return Response(visit_row(sv.accept(request.user, self.get_object(), request.data)))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return Response(visit_row(sv.reject(request.user, self.get_object(), sv.text(request.data.get("reason"), 200))))

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        decision = request.data.get("decision")
        if decision not in ("allow", "deny"):
            raise ValidationError({"decision": "allow or deny"})
        return Response(visit_row(sv.decide(request.user, self.get_object(), decision == "allow")))

    @action(detail=True, methods=["get"])
    def photo(self, request, pk=None):
        return _photo(self.get_object().photo)


class VehicleViewSet(_List, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    export_name = "vehicles"
    export_columns = [
        ("Number", "number"), ("Type", "type_display"), ("Driver", "driver_name"), ("Driver mobile", "driver_mobile"),
        ("Purpose", "purpose"), ("Company", "company"), ("Items", "items"), ("Parking", "parking_slot"),
        ("Gate", "location.name"), ("In", "in_at"), ("In by", "in_by"), ("Out", "out_at"), ("Out by", "out_by"),
        ("Minutes inside", "minutes_inside"), ("Notes", "notes"),
    ]

    def row(self, e, now=None):
        return vehicle_row(e, now)

    def get_queryset(self):
        _need(sv.can_gate(self.request.user) or sv.can_view_all(self.request.user))
        qs = sv.visible_vehicles(self.request.user).select_related("location", "in_by", "out_by").prefetch_related("visits")
        if self.action != "list":
            return qs
        p = self.request.query_params
        if p.get("scope") == "inside":
            qs = qs.filter(out_at__isnull=True)
        elif p.get("scope") == "today":
            start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
            qs = qs.filter(Q(in_at__gte=start) | Q(out_at__isnull=True))
        d1, d2 = _day_range(self.request)
        if d1:
            qs = qs.filter(in_at__gte=_aware(d1))
        if d2:
            qs = qs.filter(in_at__lt=_aware(d2, end=True))
        q = re.sub(r"[\s\-.]", "", p.get("q") or "").upper()
        if q:
            qs = qs.filter(Q(number__icontains=q) | Q(driver_name__icontains=p["q"].strip()))
        return qs.order_by("-in_at")

    def create(self, request):
        _need(sv.can_gate(request.user))
        return Response(vehicle_row(sv.vehicle_in(request.user, request.data)), status=201)

    def partial_update(self, request, pk=None):
        _need(sv.can_gate(request.user) or sv.can_view_all(request.user))
        return Response(vehicle_row(sv.edit_vehicle(request.user, self.get_object(), request.data)))

    @action(detail=True, methods=["post"])
    def checkout(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return Response(vehicle_row(sv.vehicle_out(request.user, self.get_object(), request.data)))

    @action(detail=True, methods=["get"], url_path=r"photo/(?P<which>in|out)")
    def photo(self, request, pk=None, which="in"):
        e = self.get_object()
        return _photo(e.photo_in if which == "in" else e.photo_out)


class ActivityViewSet(_List, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Guard activity (view_all): every gate action."""
    permission_classes = [IsAuthenticated]
    export_name = "guard-activity"
    export_columns = [("When", "at"), ("Guard", "actor.name"), ("Action", "action_display"), ("What", "summary"),
                      ("Changes", lambda r: "; ".join(f"{k}: {a} → {b}" for k, (a, b) in (r["changes"] or {}).items()))]

    def row(self, g, now=None):
        return {"id": g.pk, "at": _dt(g.at), "actor": _brief(g.actor), "action": g.action,
                "action_display": g.get_action_display(), "summary": g.summary, "changes": g.changes,
                "visit": g.visit_id, "vehicle": g.vehicle_id}

    def get_queryset(self):
        _need(sv.can_view_all(self.request.user))
        qs = GateLog.objects.select_related("actor")
        p = self.request.query_params
        if (p.get("actor") or "").isdigit():
            qs = qs.filter(actor_id=int(p["actor"]))
        if p.get("action"):
            qs = qs.filter(action__in=p["action"].split(","))
        if (p.get("visit") or "").isdigit():
            qs = qs.filter(visit_id=int(p["visit"]))
        d1, d2 = _day_range(self.request)
        if d1:
            qs = qs.filter(at__gte=_aware(d1))
        if d2:
            qs = qs.filter(at__lt=_aware(d2, end=True))
        return qs


def _locations():
    from hr.models import OfficeLocation
    return [{"id": o.pk, "name": o.name} for o in OfficeLocation.objects.filter(active=True)]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def config_view(request):
    u = request.user
    s = conf.get()
    can = {"gate": sv.can_gate(u), "invite": sv.can_invite(u), "view_all": sv.can_view_all(u), "settings": sv.can_settings(u)}
    _need(any(can.values()))
    return Response({
        "can": can, "purposes": s["purposes"], "host_approval": s["host_approval"], "photo_visitor": s["photo_visitor"],
        "photo_vehicle": s["photo_vehicle"], "id_proof": s["id_proof"], "id_types": conf.ID_TYPES,
        "overstay_hours": s["overstay_hours"], "locations": _locations(),
        "vehicle_types": [{"value": k, "label": v} for k, v in VehicleEntry._meta.get_field("type").choices],
    })


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def settings_view(request):
    _need(sv.can_settings(request.user), "Your role does not include visitor settings.")
    if request.method == "PUT":
        before = conf.get()
        new, errors = conf.clean(request.data)
        if errors:
            return Response(errors, status=400)
        conf.save(new)
        changes = {k: [before[k], new[k]] for k in new if before[k] != new[k]}
        if changes:
            sv.log(request.user, GateAction.SETTINGS, f"Settings: {', '.join(changes)}", changes=changes)
    return Response(conf.get())


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def link_view(request):
    """The company's one open QR link. GET: the link (settings or the gate). POST {regenerate|enabled}: settings only."""
    u = request.user
    _need(sv.can_settings(u) or sv.can_gate(u))
    link = sv.the_link()
    if request.method == "POST":
        _need(sv.can_settings(u), "Only an admin can change the visitor QR.")
        if request.data.get("regenerate"):
            link.token, link.rotated_at = sv.new_token_value(), timezone.now()
            sv.log(u, GateAction.LINK, "Made a new visitor QR (the old one stops working)")
        if isinstance(request.data.get("enabled"), bool):
            link.enabled = request.data["enabled"]
            sv.log(u, GateAction.LINK, f"Visitor QR {'on' if link.enabled else 'off'}")
        link.save()
    from tenancy.profile import brand
    b = brand()
    return Response({"path": f"/v/{sv.company_code()}/{link.token}", "enabled": link.enabled and conf.get()["open_link"],
                     "rotated_at": _dt(link.rotated_at), "company": b["name"] if b else "", "logo_url": b["logo_url"] if b else None,
                     "can_change": sv.can_settings(u)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def hosts_view(request):
    from accounts.models import User
    _need(sv.can_gate(request.user) or sv.can_view_all(request.user))
    q = (request.query_params.get("q") or "").strip()
    qs = User.objects.filter(is_active=True)
    for word in q.split()[:3]:
        qs = qs.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(username__icontains=word))
    return Response([_brief(x) for x in qs.order_by("first_name", "last_name")[:20]])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def lookup_view(request):
    """A returning visitor by mobile: what the guard would type again."""
    from .models import Visitor
    _need(sv.can_gate(request.user))
    try:
        mobile = sv.clean_mobile(request.query_params.get("mobile"), required=True)
    except ValidationError:
        return Response({"found": False})
    vis = Visitor.objects.filter(mobile=mobile, anonymised=False).first()
    if not vis:
        return Response({"found": False})
    last = vis.visit_set.order_by("-created_at").first()
    return Response({"found": True, "id": vis.pk, "name": vis.name, "company": vis.company, "visits": vis.visits,
                     "has_photo": bool(vis.photo), "id_type": vis.id_type, "id_last4": vis.id_last4,
                     "last_purpose": last.purpose if last else "", "last_host": _brief(last.host) if last else None,
                     "last_host_label": last.host_label if last else "",
                     "last_visit_at": _dt(vis.last_visit_at)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def visitor_photo_view(request, pk):
    from .models import Visitor
    _need(sv.can_gate(request.user) or sv.can_view_all(request.user))
    vis = Visitor.objects.filter(pk=pk).first()
    return _photo(vis.photo if vis else None)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def inside_view(request):
    """Emergency roll call: visitors and vehicles inside + employees punched in today and not out."""
    from hr.models import Attendance
    _need(sv.can_gate(request.user) or sv.can_view_all(request.user))
    now = timezone.now()
    visits = [visit_row(v, now) for v in Visit.objects.filter(status=VisitStatus.INSIDE).select_related("host", "location", "visitor", "check_in_by")]
    vehicles = [vehicle_row(e, now) for e in VehicleEntry.objects.filter(out_at__isnull=True).select_related("location").prefetch_related("visits")]
    staff = [{"id": a.user_id, "name": sv.name_of(a.user), "department": a.user.get_department_display(), "check_in": _dt(a.check_in)}
             for a in Attendance.objects.filter(date=timezone.localdate(), check_in__isnull=False, check_out__isnull=True)
             .select_related("user").order_by("user__first_name")]
    fmt = export_format(request)
    if fmt:
        rows = ([["Visitor", v["name"], v["company"], v["mobile"], (v["host"] or {}).get("name") or v["host_label"], v["check_in_at"]] for v in visits]
                + [["Vehicle", e["number"], e["type_display"], e["driver_mobile"], e["driver_name"], e["in_at"]] for e in vehicles]
                + [["Employee", s["name"], s["department"], "", "", s["check_in"]] for s in staff])
        return export_file(fmt, "Who is inside", f"inside-now-{timezone.localdate()}", ["Kind", "Name / number", "From / type", "Mobile", "Host / driver", "Since"], rows)
    return Response({"visitors": visits, "vehicles": vehicles, "employees": staff})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def guards_view(request):
    """People who can work the gate or did (for the Guard activity filter)."""
    from accounts.access import users_with
    from accounts.models import User
    _need(sv.can_view_all(request.user))
    ids = set(users_with("visitors.gate").values_list("pk", flat=True)) | set(GateLog.objects.exclude(actor=None).values_list("actor_id", flat=True).distinct())
    return Response([_brief(u) for u in User.objects.filter(pk__in=ids).order_by("first_name")])


# ---------------------------------------------------------------- public (no sign-in)

NOT_FOUND = {"detail": "This visitor link is not valid. Please ask the guard."}


class PublicThrottle(AnonRateThrottle):
    scope = "visitor_public"

    def allow_request(self, request, view):
        return request.method != "POST" or super().allow_request(request, view)


def _ip_hash(request) -> str:
    ip = PublicThrottle().get_ident(request) or ""
    day = timezone.localdate().isoformat()
    return hmac.new(settings.SECRET_KEY.encode(), f"{ip}|{day}".encode(), hashlib.sha256).hexdigest()[:24]


def _registered(schema: str) -> bool:
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1 FROM public.ff_companies WHERE schema_name = %s", [schema])
            return cur.fetchone() is not None
    except Exception:  # noqa: BLE001
        return False


PER_IP_HOUR = 10
PER_LINK_HOUR = 120


def _public(request, code, token):
    from tenancy.profile import brand, module_on

    from .models import GateLink
    if not module_on("visitors"):
        return Response(NOT_FOUND, status=404)
    s = conf.get()
    link = GateLink.objects.filter(token=token).first()
    if not link or not link.enabled or not s["open_link"]:
        return Response(NOT_FOUND, status=404)
    if request.method == "GET":
        b = brand()
        return Response({"company": b["name"] if b else "", "logo_url": b["logo_url"] if b else None,
                         "purposes": s["purposes"], "photo": s["public_photo"], "consent_text": s["consent_text"]})
    data = request.data if isinstance(request.data, dict) else {}
    if str(data.get("website") or "").strip():  # honeypot: a bot filled the hidden field
        return Response({"code": "".join(sv.secrets.choice(sv.CODE_ALPHABET) for _ in range(6))}, status=201)
    hour_ago = timezone.now() - timedelta(hours=1)
    ip = _ip_hash(request)
    recent = Visit.objects.filter(source="open_link", created_at__gte=hour_ago)
    if recent.filter(ip_hash=ip).count() >= PER_IP_HOUR or recent.filter(gate_link=link).count() >= PER_LINK_HOUR:
        return Response({"detail": "Too many sign-ins from here. Please ask the guard."}, status=429)
    v = sv.public_submit(link, data, ip)
    return Response({"code": v.short_code}, status=201)


@api_view(["GET", "POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([PublicThrottle])
def public_view(request, code, token):
    from tenancy import schemas
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,50}", code or "") or not re.fullmatch(r"[A-Za-z0-9_\-]{10,60}", token or ""):
        return Response(NOT_FOUND, status=404)
    if not schemas.enabled():
        return _public(request, code, token)
    try:
        schema = schemas.schema_for_code(code)
    except ValueError:
        return Response(NOT_FOUND, status=404)
    if not _registered(schema):
        return Response(NOT_FOUND, status=404)
    with schemas.use(schema):
        return _public(request, code, token)
