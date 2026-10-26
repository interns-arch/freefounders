"""Visitors V3 API (PLAN.md §22.10): contractors, material gate passes, patrol, incidents, one scan for every pass, the
ID card reader and the reports."""
import re
from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import ExtractHour, TruncDate
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.exports import export_file, export_format

from . import conf, services as sv, services_v3 as v3
from .models import (Checkpoint, ContractorPass, Delivery, Incident, IncidentKind, MaterialPass, MaterialStatus,
                     PatrolScan, VehicleEntry, Visit, VisitStatus)
from .views import _List, _aware, _brief, _day_range, _dt, _loc, _need, _photo


# ---------------------------------------------------------------- contractors

def entry_row(e, now=None):
    return {"id": e.pk, "in_at": _dt(e.in_at), "in_by": sv.name_of(e.in_by), "out_at": _dt(e.out_at),
            "out_by": sv.name_of(e.out_by), "people": e.people, "minutes_inside": e.minutes_inside(now)}


def contractor_row(c: ContractorPass, now=None):
    entry = next((e for e in c.entries.all() if e.out_at is None), None)
    today = timezone.localdate()
    return {
        "id": c.pk, "name": c.name, "mobile": c.mobile, "company": c.company, "people": c.people, "work": c.work,
        "permit_no": c.permit_no, "safety_note": c.safety_note, "supervisor": _brief(c.supervisor),
        "location": _loc(c.location), "task": {"id": c.task_id, "code": c.task.code, "title": c.task.title} if c.task else None,
        "valid_from": c.valid_from.isoformat(), "valid_to": c.valid_to.isoformat(), "state": v3.contractor_state(c, today),
        "days_left": max(0, (c.valid_to - today).days + 1) if c.valid_to >= today else 0,
        "inside": entry is not None, "since": _dt(entry.in_at) if entry else None, "has_photo": bool(c.photo),
        "id_type": c.id_type, "id_last4": c.id_last4, "pass_no": c.pass_no, "pass_token": c.pass_token,
        "pass_path": v3.contractor_path(c), "pass_sent_at": _dt(c.pass_sent_at), "pass_channels": c.pass_channels,
        "revoked_at": _dt(c.revoked_at), "revoked_by": sv.name_of(c.revoked_by), "created_by": sv.name_of(c.created_by),
        "created_at": _dt(c.created_at), "entries_today": sum(1 for e in c.entries.all() if e.in_at >= sv.day_start()),
    }


class ContractorViewSet(_List, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    export_name = "contractors"
    export_columns = [
        ("Pass", "pass_no"), ("Name", "name"), ("Mobile", "mobile"), ("Company", "company"), ("People", "people"),
        ("Work", "work"), ("Permit", "permit_no"), ("Supervisor", "supervisor.name"), ("From", "valid_from"),
        ("To", "valid_to"), ("State", "state"), ("Inside", lambda r: "yes" if r["inside"] else ""), ("Task", "task.code"),
    ]

    def row(self, c, now=None):
        return contractor_row(c, now)

    def get_queryset(self):
        u = self.request.user
        _need(sv.can_gate(u) or sv.can_view_all(u) or sv.can_invite(u))
        qs = v3.visible_contractors(u).select_related("supervisor", "location", "task", "revoked_by", "created_by") \
            .prefetch_related("entries")
        if self.action != "list":
            return qs
        p = self.request.query_params
        today = timezone.localdate()
        scope = p.get("scope") or ""
        if scope == "today":
            qs = qs.filter(revoked_at__isnull=True, valid_from__lte=today, valid_to__gte=today)
        elif scope == "inside":
            qs = qs.filter(entries__out_at__isnull=True, entries__isnull=False).distinct()
        elif scope == "upcoming":
            qs = qs.filter(revoked_at__isnull=True, valid_from__gt=today)
        elif scope == "mine":
            qs = qs.filter(Q(supervisor=u) | Q(created_by=u))
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(mobile__icontains=q) | Q(company__icontains=q) | Q(pass_no__iexact=q)
                           | Q(work__icontains=q) | Q(permit_no__icontains=q))
        return qs.order_by("valid_to" if scope == "today" else "-created_at")

    def create(self, request):
        return Response(contractor_row(v3.create_contractor(request.user, request.data)), status=201)

    @action(detail=True, methods=["post"], url_path="in")
    def check_in(self, request, pk=None):
        _need(sv.can_gate(request.user))
        c = self.get_object()
        v3.contractor_in(request.user, c, request.data)
        return Response(contractor_row(self.get_queryset().get(pk=c.pk)))

    @action(detail=True, methods=["post"], url_path="out")
    def check_out(self, request, pk=None):
        _need(sv.can_gate(request.user))
        c = self.get_object()
        v3.contractor_out(request.user, c)
        return Response(contractor_row(self.get_queryset().get(pk=c.pk)))

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        c = self.get_object()
        _need(v3.can_manage_contractor(request.user, c))
        v3.revoke_contractor(request.user, c, sv.text(request.data.get("reason"), 200))
        return Response(contractor_row(self.get_queryset().get(pk=c.pk)))

    @action(detail=True, methods=["post"])
    def send_pass(self, request, pk=None):
        c = self.get_object()
        _need(v3.can_manage_contractor(request.user, c))
        v3.send_contractor_pass(c, actor=request.user)
        return Response(contractor_row(self.get_queryset().get(pk=c.pk)))

    @action(detail=True, methods=["get"])
    def entries(self, request, pk=None):
        c = self.get_object()
        now = timezone.now()
        return Response([entry_row(e, now) for e in c.entries.select_related("in_by", "out_by")[:500]])

    @action(detail=True, methods=["get"])
    def photo(self, request, pk=None):
        return _photo(self.get_object().photo)


# ---------------------------------------------------------------- material gate pass

def material_row(m: MaterialPass, user=None):
    items = list(m.items.all())
    return {
        "id": m.pk, "pass_no": m.pass_no, "pass_token": m.pass_token, "direction": m.direction,
        "direction_display": m.get_direction_display(), "purpose": m.purpose, "carrier_name": m.carrier_name,
        "carrier_company": m.carrier_company, "vehicle_no": m.vehicle_no, "returnable": m.returnable,
        "expected_return": m.expected_return.isoformat() if m.expected_return else None, "location": _loc(m.location),
        "status": m.status, "status_display": m.get_status_display(), "requested_by": _brief(m.requested_by),
        "requested_at": _dt(m.requested_at), "decided_by": sv.name_of(m.decided_by), "decided_at": _dt(m.decided_at),
        "decision_note": m.decision_note, "gate_by": sv.name_of(m.gate_by), "gate_at": _dt(m.gate_at),
        "gate_note": m.gate_note, "returned_by": sv.name_of(m.returned_by), "returned_at": _dt(m.returned_at),
        "notes": m.notes, "overdue": bool(m.returnable and m.status == MaterialStatus.PASSED and m.expected_return
                                          and m.expected_return < timezone.localdate()),
        "items": [{"id": i.pk, "description": i.description, "quantity": f"{i.quantity.normalize():f}", "unit": i.unit,
                   "asset_id": i.asset_id, "asset_tag": i.asset_tag, "returned_qty": f"{i.returned_qty.normalize():f}"}
                  for i in items],
        "summary": v3.items_text(m),
        "can_decide": bool(user and m.status == MaterialStatus.PENDING and v3.can_decide(user, m)),
    }


class MaterialViewSet(_List, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    export_name = "material-passes"
    export_columns = [
        ("Pass", "pass_no"), ("Direction", "direction_display"), ("Items", "summary"), ("Purpose", "purpose"),
        ("Asked by", "requested_by.name"), ("Asked", "requested_at"), ("Status", "status_display"),
        ("Decided by", "decided_by"), ("At the gate", "gate_at"), ("Guard", "gate_by"), ("Carrier", "carrier_name"),
        ("Vehicle", "vehicle_no"), ("Returnable", lambda r: "yes" if r["returnable"] else ""),
        ("Expected back", "expected_return"), ("Returned", "returned_at"),
    ]

    def row(self, m, now=None):
        return material_row(m, self.request.user)

    def retrieve(self, request, *args, **kwargs):
        return Response(material_row(self.get_object(), request.user))

    def get_queryset(self):
        u = self.request.user
        _need(sv.can_gate(u) or sv.can_view_all(u) or sv.can_invite(u))
        qs = v3.visible_material(u).select_related("requested_by", "decided_by", "gate_by", "returned_by", "location") \
            .prefetch_related("items")
        if self.action != "list":
            return qs
        p = self.request.query_params
        scope = p.get("scope") or ""
        if scope == "mine":
            qs = qs.filter(requested_by=u)
        elif scope == "approvals":
            qs = qs.filter(status=MaterialStatus.PENDING).exclude(requested_by=u) if sv.can_view_all(u) else \
                qs.filter(status=MaterialStatus.PENDING, requested_by__reporting_manager=u)
        elif scope == "gate":
            qs = qs.filter(Q(status=MaterialStatus.APPROVED) | Q(status=MaterialStatus.PASSED, returnable=True))
        elif scope == "out":
            qs = qs.filter(status=MaterialStatus.PASSED, returnable=True)
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        d1, d2 = _day_range(self.request)
        if d1:
            qs = qs.filter(requested_at__gte=_aware(d1))
        if d2:
            qs = qs.filter(requested_at__lt=_aware(d2, end=True))
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(pass_no__iexact=q) | Q(purpose__icontains=q) | Q(items__description__icontains=q)
                           | Q(items__asset_tag__icontains=q) | Q(carrier_name__icontains=q)).distinct()
        return qs.order_by("-requested_at")

    def create(self, request):
        m = v3.create_material(request.user, request.data if isinstance(request.data, dict) else {})
        return Response(material_row(self.get_queryset().get(pk=m.pk), request.user), status=201)

    def _done(self, m):
        return Response(material_row(self.get_queryset().get(pk=m.pk), self.request.user))

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        decision = request.data.get("decision")
        if decision not in ("approve", "reject"):
            raise ValidationError({"decision": "approve or reject"})
        return self._done(v3.decide_material(request.user, self.get_object(), decision == "approve",
                                             request.data.get("note") or ""))

    @action(detail=True, methods=["post"])
    def gate(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return self._done(v3.gate_material(request.user, self.get_object(), request.data.get("note") or ""))

    @action(detail=True, methods=["post"], url_path="return")
    def return_(self, request, pk=None):
        _need(sv.can_gate(request.user))
        return self._done(v3.return_material(request.user, self.get_object(), request.data))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._done(v3.cancel_material(request.user, self.get_object()))


# ---------------------------------------------------------------- patrol

def checkpoint_row(cp: Checkpoint, now=None, with_token=False):
    row = {"id": cp.pk, "name": cp.name, "location": _loc(cp.location), "order": cp.order, "active": cp.active,
           "last_scan_at": _dt(cp.last_scan_at), "overdue": v3.checkpoint_overdue(cp, now)}
    if with_token:
        row["code"] = f"KPP:{cp.token}"
    return row


class CheckpointViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        u = self.request.user
        _need(sv.can_gate(u) or sv.can_view_all(u) or sv.can_settings(u))
        qs = Checkpoint.objects.select_related("location")
        if self.request.query_params.get("all") != "1":
            qs = qs.filter(active=True)
        return qs

    def list(self, request, *args, **kwargs):
        now = timezone.now()
        settings_ = sv.can_settings(request.user)
        s = conf.get()
        return Response({
            "checkpoints": [checkpoint_row(cp, now, settings_) for cp in self.get_queryset()],
            "every_hours": s["patrol_every_hours"], "patrol_from": s["patrol_from"], "patrol_to": s["patrol_to"],
            "in_hours": v3.in_patrol_hours(now),
        })

    def create(self, request):
        _need(sv.can_settings(request.user), "Only an admin can change the checkpoints.")
        return Response(checkpoint_row(v3.save_checkpoint(request.user, request.data), with_token=True), status=201)

    def partial_update(self, request, pk=None):
        _need(sv.can_settings(request.user), "Only an admin can change the checkpoints.")
        cp = Checkpoint.objects.filter(pk=pk).first()
        if not cp:
            raise ValidationError({"detail": "No such checkpoint."})
        return Response(checkpoint_row(v3.save_checkpoint(request.user, request.data, cp), with_token=True))

    @action(detail=False, methods=["post"])
    def scan(self, request):
        _need(sv.can_gate(request.user))
        scan = v3.patrol_scan(request.user, request.data.get("code"), request.data)
        return Response(scan_row(scan), status=201)

    @action(detail=False, methods=["get"])
    def scans(self, request):
        u = request.user
        qs = PatrolScan.objects.select_related("checkpoint", "guard")
        if not sv.can_view_all(u):
            qs = qs.filter(guard=u, at__gte=sv.day_start() - timedelta(days=1))
        p = request.query_params
        d1, d2 = _day_range(request)
        if d1:
            qs = qs.filter(at__gte=_aware(d1))
        if d2:
            qs = qs.filter(at__lt=_aware(d2, end=True))
        if (p.get("guard") or "").isdigit():
            qs = qs.filter(guard_id=int(p["guard"]))
        rows = [scan_row(x) for x in qs[:1000]]
        fmt = export_format(request)
        if fmt:
            return export_file(fmt, "Patrol rounds", f"patrol-{timezone.localdate()}",
                               ["When", "Checkpoint", "Guard", "All OK", "Note"],
                               [[r["at"], r["checkpoint"]["name"], (r["guard"] or {}).get("name", ""),
                                 "yes" if r["all_ok"] else "NO", r["note"]] for r in rows])
        return Response(rows)


def scan_row(x: PatrolScan):
    return {"id": x.pk, "at": _dt(x.at), "checkpoint": {"id": x.checkpoint_id, "name": x.checkpoint.name},
            "guard": _brief(x.guard), "note": x.note, "all_ok": x.all_ok,
            "has_location": x.latitude is not None}


# ---------------------------------------------------------------- incidents

def incident_row(i: Incident):
    return {
        "id": i.pk, "kind": i.kind, "kind_display": i.get_kind_display(), "severity": i.severity,
        "severity_display": i.get_severity_display(), "title": i.title, "description": i.description, "place": i.place,
        "location": _loc(i.location), "occurred_at": _dt(i.occurred_at), "reported_by": _brief(i.reported_by),
        "reported_at": _dt(i.reported_at), "status": i.status, "action_taken": i.action_taken,
        "closed_by": sv.name_of(i.closed_by), "closed_at": _dt(i.closed_at),
        "photos": [p.pk for p in i.photos.all()], "visit": {"id": i.visit_id, "name": i.visit.name} if i.visit else None,
    }


class IncidentViewSet(_List, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    export_name = "incidents"
    export_columns = [
        ("When", "occurred_at"), ("Severity", "severity_display"), ("Kind", "kind_display"), ("What", "title"),
        ("Details", "description"), ("Where", lambda r: r["place"] or (r["location"] or {}).get("name", "")),
        ("Reported by", "reported_by.name"), ("Status", "status"), ("Action taken", "action_taken"),
        ("Closed by", "closed_by"), ("Closed", "closed_at"),
    ]

    def row(self, i, now=None):
        return incident_row(i)

    def get_queryset(self):
        u = self.request.user
        _need(sv.can_gate(u) or sv.can_view_all(u))
        qs = v3.visible_incidents(u).select_related("reported_by", "closed_by", "location", "visit").prefetch_related("photos")
        if self.action != "list":
            return qs
        p = self.request.query_params
        if p.get("status") in ("open", "closed"):
            qs = qs.filter(status=p["status"])
        if p.get("severity"):
            qs = qs.filter(severity__in=p["severity"].split(","))
        if p.get("kind"):
            qs = qs.filter(kind__in=p["kind"].split(","))
        d1, d2 = _day_range(self.request)
        if d1:
            qs = qs.filter(occurred_at__gte=_aware(d1))
        if d2:
            qs = qs.filter(occurred_at__lt=_aware(d2, end=True))
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(description__icontains=q) | Q(place__icontains=q))
        return qs.order_by("-occurred_at")

    def create(self, request):
        return Response(incident_row(v3.report_incident(request.user, request.data)), status=201)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        _need(sv.can_view_all(request.user), "Only the security head can close an incident.")
        return Response(incident_row(v3.close_incident(request.user, self.get_object(), request.data.get("action_taken"))))

    @action(detail=True, methods=["get"], url_path=r"photo/(?P<photo_id>\d+)")
    def photo(self, request, pk=None, photo_id=None):
        ph = self.get_object().photos.filter(pk=photo_id).first()
        return _photo(ph.photo if ph else None)


# ---------------------------------------------------------------- one scan for every pass

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def scan_view(request):
    """The gate scans anything (visitor pass, contractor pass, material pass) or types its number: what it is."""
    from .views import visit_row as vrow
    _need(sv.can_gate(request.user))
    raw = str(request.query_params.get("code") or "").strip()
    token = raw.split(":", 1)[1] if re.match(r"^KP[VCMP]:", raw, re.I) else raw.rstrip("/").rsplit("/", 1)[-1]
    prefix = raw[:3].upper() if re.match(r"^KP[VCMP]:", raw, re.I) else ""
    up = token.upper()
    if prefix in ("", "KPC"):
        c = ContractorPass.objects.filter(Q(pass_token=token) | Q(pass_no=up)).prefetch_related("entries") \
            .select_related("supervisor", "location", "task").first()
        if c:
            return Response({"kind": "contractor", "data": contractor_row(c)})
    if prefix in ("", "KPM"):
        m = MaterialPass.objects.filter(Q(pass_token=token) | Q(pass_no=up)).prefetch_related("items").first()
        if m:
            return Response({"kind": "material", "data": material_row(m, request.user)})
    if prefix == "KPP":
        raise ValidationError({"code": "This is a patrol checkpoint: scan it on the Patrol screen."})
    v = sv.find_pass(raw)
    if v:
        return Response({"kind": "visit", "data": vrow(v)})
    raise ValidationError({"code": "No pass with this code."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def id_scan_view(request):
    _need(sv.can_gate(request.user))
    return Response(v3.read_id_card(request.user, request.data.get("photo")))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def task_options_view(request):
    """Tasks a contractor pass can be linked to (my own, or any for the register)."""
    from crm.models import Task
    u = request.user
    _need(sv.can_invite(u) or sv.can_gate(u) or sv.can_view_all(u))
    qs = Task.objects.exclude(status="done")
    if not sv.can_view_all(u):
        qs = qs.filter(Q(assigned_to=u) | Q(created_by=u))
    q = (request.query_params.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(pk=int(q.lstrip("Tt#-")) if q.lstrip("Tt#-").isdigit() else 0))
    return Response([{"id": t.pk, "code": t.code, "title": t.title} for t in qs.order_by("-pk")[:20]])


# ---------------------------------------------------------------- reports

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def reports_view(request):
    """The numbers for a period (default: the last 30 days): visits, time inside, purposes, hosts, companies, peak
    hours, parcels, vehicles, contractors, material passes, incidents, patrol."""
    _need(sv.can_view_all(request.user))
    d1, d2 = _day_range(request)
    today = timezone.localdate()
    d2 = d2 or today
    d1 = d1 or d2 - timedelta(days=29)
    if (d2 - d1).days > 366:
        raise ValidationError({"date_from": "At most one year at a time."})
    a, b = _aware(d1), _aware(d2, end=True)
    visits = Visit.objects.filter(created_at__gte=a, created_at__lt=b)
    came = visits.filter(check_in_at__isnull=False)
    per_day = {r["d"]: r["n"] for r in came.annotate(d=TruncDate("check_in_at")).values("d").annotate(n=Count("id"))}
    days, cur = [], d1
    while cur <= d2:
        days.append({"date": cur.isoformat(), "visits": per_day.get(cur, 0)})
        cur += timedelta(days=1)
    hours = Counter({r["h"]: r["n"] for r in came.annotate(h=ExtractHour("check_in_at")).values("h").annotate(n=Count("id"))})
    done = came.filter(check_out_at__isnull=False)
    mins = [int((v.check_out_at - v.check_in_at).total_seconds() // 60) for v in done.only("check_in_at", "check_out_at")[:20000]]
    top = lambda qs, field, n=8: [{"name": r[field] or "Not given", "count": r["n"]}  # noqa: E731
                                  for r in qs.values(field).annotate(n=Count("id")).order_by("-n")[:n]]
    hosts = defaultdict(int)
    for r in came.values("host__first_name", "host__last_name", "host_label").annotate(n=Count("id")):
        hosts[(f"{r['host__first_name'] or ''} {r['host__last_name'] or ''}".strip() or r["host_label"] or "Not given")] += r["n"]
    by_status = Counter(dict(visits.values_list("status").annotate(n=Count("id"))))
    out = {
        "date_from": d1.isoformat(), "date_to": d2.isoformat(),
        "totals": {
            "visits": came.count(), "people": sum(came.values_list("people", flat=True)),
            "unique_visitors": came.values("visitor_id").distinct().count(),
            "returning": came.filter(visitor__visits__gt=1).values("visitor_id").distinct().count(),
            "avg_minutes": round(sum(mins) / len(mins)) if mins else 0,
            "overstays": came.filter(overstay_alerted_at__isnull=False).count(),
            "turned_away": by_status.get(VisitStatus.REJECTED, 0) + by_status.get(VisitStatus.DENIED, 0),
            "invited": visits.filter(source="invite").count(), "no_shows": by_status.get(VisitStatus.NO_SHOW, 0),
            "qr_sign_ins": visits.filter(source="open_link").count(),
            "parcels": Delivery.objects.filter(received_at__gte=a, received_at__lt=b).count(),
            "vehicles": VehicleEntry.objects.filter(in_at__gte=a, in_at__lt=b).count(),
            "contractor_entries": sum(c.entries.filter(in_at__gte=a, in_at__lt=b).count() for c in ContractorPass.objects.filter(
                valid_to__gte=d1, valid_from__lte=d2)),
            "material_passes": MaterialPass.objects.filter(requested_at__gte=a, requested_at__lt=b).count(),
            "incidents": Incident.objects.filter(occurred_at__gte=a, occurred_at__lt=b).count(),
            "incidents_open": Incident.objects.filter(status="open").count(),
            "patrol_scans": PatrolScan.objects.filter(at__gte=a, at__lt=b).count(),
            "patrol_problems": PatrolScan.objects.filter(at__gte=a, at__lt=b, all_ok=False).count(),
        },
        "per_day": days,
        "per_hour": [{"hour": h, "visits": hours.get(h, 0)} for h in range(24)],
        "purposes": top(came, "purpose"),
        "companies": top(came.exclude(company=""), "company"),
        "hosts": [{"name": k, "count": v} for k, v in sorted(hosts.items(), key=lambda kv: -kv[1])[:8]],
        "sources": [{"name": dict(Visit._meta.get_field("source").choices).get(r["source"], r["source"]), "count": r["n"]}
                    for r in visits.values("source").annotate(n=Count("id")).order_by("-n")],
        "incidents_by_kind": [{"name": dict(IncidentKind.choices).get(r["kind"], r["kind"]), "count": r["n"]}
                              for r in Incident.objects.filter(occurred_at__gte=a, occurred_at__lt=b)
                              .values("kind").annotate(n=Count("id")).order_by("-n")],
    }
    fmt = export_format(request)
    if fmt:
        t = out["totals"]
        rows = [["Total", k.replace("_", " "), v] for k, v in t.items()] + \
               [["Day", r["date"], r["visits"]] for r in days] + \
               [["Purpose", r["name"], r["count"]] for r in out["purposes"]] + \
               [["Host", r["name"], r["count"]] for r in out["hosts"]] + \
               [["Company", r["name"], r["count"]] for r in out["companies"]]
        return export_file(fmt, "Visitor report", f"visitor-report-{d1}-{d2}", ["Section", "What", "Number"], rows)
    return Response(out)


def inside_contractors(now=None):
    """Contractors inside now (for the roll call)."""
    rows = []
    for c in ContractorPass.objects.filter(entries__out_at__isnull=True, entries__isnull=False).distinct() \
            .prefetch_related("entries").select_related("supervisor", "location", "task"):
        rows.append(contractor_row(c, now))
    return rows

