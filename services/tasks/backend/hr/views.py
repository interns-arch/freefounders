from django.utils import timezone
from rest_framework import status as http, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.negotiation import DefaultContentNegotiation
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import HasCapability, has_capability

from . import approvals, services
from .models import (
    Attendance, AttendanceCorrection, CorrectionStatus, FaceProfile,
    LeaveRequest, LeaveStatus, LeaveType, OfficeLocation,
)
from .serializers import (
    AttendanceSerializer, CorrectionSerializer, LeaveRequestSerializer,
    LeaveTypeSerializer, MarkSerializer, OfficeLocationSerializer,
)


def can_approve(user) -> bool:
    return has_capability(user, "hr.approve")


def can_manage_hr(user) -> bool:
    return has_capability(user, "hr.manage")


def other_approvers(user):
    """Everyone except `user` who could approve their request."""
    from accounts.access import users_with
    return users_with("hr.approve").exclude(pk=user.pk)


def _self_review_message(user) -> str:
    """Nobody approves their own request -- not even an admin. If there is
    literally no one else who can, say so plainly instead of allowing it."""
    base = "You cannot approve your own request — it must be reviewed by someone else."
    if not other_approvers(user).exists():
        return (base + " No other approver exists yet: add an HR Manager (or another "
                "admin) in My Team, and ask them to review it.")
    names = ", ".join(u.get_full_name() or u.username for u in other_approvers(user)[:5])
    return f"{base} Ask one of: {names}."


def _check_reviewer(reviewer, request_obj):
    """May this person decide this leave/correction? (PLAN.md §17.2; with the default setting: today's rule.)"""
    if request_obj is None or not approvals.is_approver(reviewer):
        raise PermissionDenied("You cannot review this request.")
    if request_obj.user_id == reviewer.id:
        raise PermissionDenied(_self_review_message(reviewer))
    if not approvals.may_review(reviewer, request_obj.user):
        raise PermissionDenied("You cannot review this request.")


def managed_users(user):
    """Employees whose attendance/leave this user may see."""
    if can_manage_hr(user):
        return User.objects.filter(is_active=True)
    if can_approve(user):
        return User.objects.filter(is_active=True, department=user.department)
    return User.objects.filter(pk=user.pk)


def _target_user(request, param="user"):
    """Resolve ?user=<id>, enforcing scope. Defaults to self."""
    uid = request.query_params.get(param)
    if not uid or str(uid) == str(request.user.id):
        return request.user
    target = managed_users(request.user).filter(pk=uid).first()
    if not target:
        raise PermissionDenied("You cannot view this employee's records.")
    return target


class _FileNegotiation(DefaultContentNegotiation):
    """File endpoints take ?format=xlsx|csv as their own parameter (DRF would read it as a renderer); errors stay JSON."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def _file(content: bytes, filename: str):
    from django.http import HttpResponse
    kind = ("text/csv; charset=utf-8" if filename.endswith(".csv")
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res = HttpResponse(content, content_type=kind)
    res["Content-Disposition"] = f'attachment; filename="{filename}"'
    res["Access-Control-Expose-Headers"] = "Content-Disposition"
    res["Cache-Control"] = "no-store"
    return res


# ------------------------------------------------------------ attendance

class AttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AttendanceSerializer

    def get_queryset(self):
        qs = Attendance.objects.select_related("user", "location").filter(
            user__in=managed_users(self.request.user))
        p = self.request.query_params
        if p.get("user"):
            qs = qs.filter(user_id=p["user"])
        elif p.get("scope") != "team":
            qs = qs.filter(user=self.request.user)
        if p.get("from"):
            qs = qs.filter(date__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(date__lte=p["to"])
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        return qs

    @action(detail=False, methods=["get"])
    def today(self, request):
        rec = Attendance.objects.filter(user=request.user, date=timezone.localdate()).first()
        conf = services.cfg()
        return Response({
            "attendance": AttendanceSerializer(rec).data if rec else None,
            "can_check_in": not (rec and rec.check_in),
            "can_check_out": bool(rec and rec.check_in and not rec.check_out),
            "geofence_enabled": conf["geofence_enabled"],
            "face_enabled": conf["face_enabled"],
            "face_self_enroll": conf["face_self_enroll"],
            "face_enrolled": FaceProfile.objects.filter(user=request.user).exists(),
            "work_start": conf["work_start"], "work_end": conf["work_end"],
            "photo": conf["photo"],
        })

    @action(detail=True, methods=["get"], url_path=r"photo/(?P<which>in|out)")
    def photo(self, request, pk=None, which="in"):
        """A punch photo: for the person themself and whoever may see their attendance."""
        from django.http import FileResponse, Http404

        rec = Attendance.objects.filter(pk=pk, user__in=managed_users(request.user)).first()
        f = rec and (rec.check_in_photo if which == "in" else rec.check_out_photo)
        if not f:
            raise Http404("No photo")
        res = FileResponse(f.open("rb"), content_type="image/jpeg")
        res["Cache-Control"] = "private, max-age=3600"
        res["X-Content-Type-Options"] = "nosniff"
        return res

    def _mark(self, request, fn):
        ser = MarkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        try:
            rec = fn(request.user, d.get("latitude"), d.get("longitude"), d.get("face_descriptor"), photo=d.get("photo"))
        except services.HRError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(AttendanceSerializer(rec).data, status=http.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def check_in(self, request):
        return self._mark(request, services.check_in)

    @action(detail=False, methods=["post"])
    def check_out(self, request):
        return self._mark(request, services.check_out)

    @action(detail=False, methods=["get"])
    def monthly(self, request):
        today = timezone.localdate()
        try:
            year = int(request.query_params.get("year", today.year))
            month = int(request.query_params.get("month", today.month))
            if not 1 <= month <= 12:
                raise ValueError
        except ValueError:
            raise ValidationError({"month": "Invalid year/month."})
        target = _target_user(request)
        data = services.monthly_report(target, year, month)
        data["user"] = {"id": target.id, "name": target.get_full_name() or target.username}
        return Response(data)

    @action(detail=False, methods=["get"], permission_classes=[HasCapability.of("hr.approve")])
    def team_today(self, request):
        return Response(services.today_summary(list(managed_users(request.user))))

    # ---- attendance for managers (PLAN.md §19.15): live / daily / dashboard / reports / import

    def _team(self, request):
        from . import team
        p = request.query_params
        return team.team_users(request.user, inactive=p.get("inactive") in ("1", "true"),
                               department=p.get("department", ""), q=p.get("q", ""))

    @action(detail=False, methods=["get"])
    def team_day(self, request):
        """Everyone's status for one day (default today)."""
        from . import team
        day = team.parse_day(request.query_params["date"]) if request.query_params.get("date") else timezone.localdate()
        return Response(team.team_day(self._team(request), day))

    @action(detail=False, methods=["get"])
    def team_month(self, request):
        """Per-person totals for a month (the attendance dashboard)."""
        from . import team
        year, month, first, last = team.parse_month(request.query_params)
        return Response(team.team_month(self._team(request), year, month, first, last))

    @action(detail=False, methods=["get"], content_negotiation_class=_FileNegotiation)
    def report(self, request):
        """A report file: ?type=daily|monthly_summary|monthly_register|late|leave&format=xlsx|csv."""
        from . import team
        kind = request.query_params.get("type", "daily")
        fmt = request.query_params.get("format", "xlsx")
        if kind not in team.REPORT_TYPES:
            raise ValidationError({"type": f"Use one of: {', '.join(team.REPORT_TYPES)}."})
        if fmt not in ("xlsx", "csv"):
            raise ValidationError({"format": "Use xlsx or csv."})
        title, stem, header, rows = team.build_report(kind, self._team(request), request.query_params)
        return _file(team.to_xlsx(title, header, rows) if fmt == "xlsx" else team.to_csv(header, rows), f"{stem}.{fmt}")

    @action(detail=False, methods=["get"], permission_classes=[HasCapability.of("hr.manage")],
            content_negotiation_class=_FileNegotiation)
    def import_template(self, request):
        from . import team
        if request.query_params.get("format", "xlsx") == "csv":
            return _file(team.to_csv(team.TEMPLATE_HEADER, []), "attendance-import-template.csv")
        return _file(team.to_xlsx("Attendance", team.TEMPLATE_HEADER, [], extra_sheet=("How to fill", team.TEMPLATE_NOTES)),
                     "attendance-import-template.xlsx")

    @action(detail=False, methods=["post"], url_path="import", permission_classes=[HasCapability.of("hr.manage")],
            parser_classes=[MultiPartParser, FormParser])
    def import_rows(self, request):
        """Upload an XLSX/CSV of days: dry_run=true (default) previews, dry_run=false applies in one transaction."""
        from . import team
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "Choose a file to upload."})
        dry_run = str(request.data.get("dry_run", "true")).lower() not in ("false", "0", "no")
        return Response(team.import_attendance(upload, request.user, dry_run=dry_run))

    @action(detail=False, methods=["post"], permission_classes=[HasCapability.of("hr.manage")])
    def manual_mark(self, request):
        """HR override: mark an employee present/half-day/absent by hand —
        for the day the face lock (or their phone) refuses to cooperate.
        Always audited: the record notes who marked it."""
        target = User.objects.filter(pk=request.data.get("user"), is_active=True).first()
        if not target:
            raise ValidationError({"user": "Unknown or inactive employee."})
        status_value = request.data.get("status", "present")
        if status_value not in ("present", "half_day", "absent"):
            raise ValidationError({"status": "Use present, half_day or absent."})
        try:
            day = (timezone.datetime.strptime(request.data["date"], "%Y-%m-%d").date()
                   if request.data.get("date") else timezone.localdate())
        except (ValueError, TypeError):
            raise ValidationError({"date": "Use YYYY-MM-DD."})
        if day > timezone.localdate():
            raise ValidationError({"date": "Cannot mark attendance for a future date."})

        record, _ = Attendance.objects.get_or_create(user=target, date=day)
        record.status = status_value
        reason = str(request.data.get("reason", "")).strip()[:120]
        record.note = (f"Marked {status_value} by {request.user.get_full_name() or request.user.username}"
                       + (f": {reason}" if reason else ""))
        record.save(update_fields=["status", "note"])
        return Response(AttendanceSerializer(record).data)


class CorrectionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = CorrectionSerializer

    def get_queryset(self):
        qs = AttendanceCorrection.objects.select_related("user", "reviewed_by")
        if self.request.query_params.get("scope") == "team" and approvals.is_approver(self.request.user):
            return qs.filter(user__in=approvals.reviewable_users(self.request.user))
        return qs.filter(user=self.request.user)

    def perform_create(self, serializer):
        correction = serializer.save(user=self.request.user)
        approvals.notify_submitted("correction", correction)

    def perform_destroy(self, instance):
        if instance.user_id != self.request.user.id or instance.status != CorrectionStatus.PENDING:
            raise PermissionDenied("Only your own pending requests can be withdrawn.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        correction = AttendanceCorrection.objects.select_related("user").filter(pk=pk).first()
        _check_reviewer(request.user, correction)
        if correction.status != CorrectionStatus.PENDING:
            raise ValidationError({"detail": "This request has already been reviewed."})
        decision = request.data.get("decision")
        if decision not in ("approved", "rejected"):
            raise ValidationError({"decision": "Use 'approved' or 'rejected'."})
        correction.status = decision
        correction.reviewed_by = request.user
        correction.remarks = str(request.data.get("remarks", ""))[:300]
        correction.save()

        if decision == CorrectionStatus.APPROVED:
            rec, _ = Attendance.objects.get_or_create(user=correction.user, date=correction.date)
            if correction.requested_check_in:
                rec.check_in = correction.requested_check_in
            if correction.requested_check_out:
                rec.check_out = correction.requested_check_out
            if rec.check_in and rec.check_out:
                rec.working_minutes = max(0, int((rec.check_out - rec.check_in).total_seconds() // 60))
                hours = rec.working_minutes / 60
                rec.status = ("half_day" if hours < services.cfg()["half_day_hours"]
                              else "late" if rec.is_late else "present")
            rec.note = f"Corrected by {request.user.username}"
            rec.save()
        return Response(CorrectionSerializer(correction).data)


# ----------------------------------------------------------------- leave

class LeaveTypeViewSet(viewsets.ModelViewSet):
    serializer_class = LeaveTypeSerializer
    queryset = LeaveType.objects.all()
    pagination_class = None

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        return [HasCapability.of("hr.manage")()]


class LeaveRequestViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = LeaveRequestSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        qs = LeaveRequest.objects.select_related("user", "leave_type", "reviewed_by")
        p = self.request.query_params
        if p.get("scope") == "team" and approvals.is_approver(self.request.user):
            qs = qs.filter(user__in=approvals.reviewable_users(self.request.user))
        else:
            qs = qs.filter(user=self.request.user)
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        return qs

    def perform_create(self, serializer):
        data = serializer.validated_data
        days = len(services.leave_working_days(data["start_date"], data["end_date"]))
        if days == 0:
            raise ValidationError({"start_date": "That range has no working days (holidays/week-offs only)."})
        overlap = LeaveRequest.objects.filter(
            user=self.request.user,
            status__in=[LeaveStatus.PENDING, LeaveStatus.APPROVED],
            start_date__lte=data["end_date"], end_date__gte=data["start_date"],
        ).exists()
        if overlap:
            raise ValidationError({"detail": "You already have a leave request covering these dates."})
        leave = serializer.save(user=self.request.user, days=days)
        approvals.notify_submitted("leave", leave)

    def perform_update(self, serializer):
        if self.get_object().status != LeaveStatus.PENDING:
            raise ValidationError({"detail": "Only pending requests can be edited."})
        serializer.save()

    def perform_destroy(self, instance):
        raise PermissionDenied("Cancel the request instead of deleting it.")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        leave = self.get_object()
        if leave.user_id != request.user.id:
            raise PermissionDenied("You can only cancel your own leave.")
        if leave.status not in (LeaveStatus.PENDING, LeaveStatus.APPROVED):
            raise ValidationError({"detail": "This request cannot be cancelled."})
        if leave.status == LeaveStatus.APPROVED and leave.start_date <= timezone.localdate():
            raise ValidationError({"detail": "Approved leave that has already started cannot be cancelled."})
        was_approved = leave.status == LeaveStatus.APPROVED
        leave.status = LeaveStatus.CANCELLED
        leave.save(update_fields=["status"])
        if was_approved:
            services.revoke_leave_attendance(leave)
        return Response(LeaveRequestSerializer(leave).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        leave = LeaveRequest.objects.select_related("user", "leave_type").filter(pk=pk).first()
        _check_reviewer(request.user, leave)
        if leave.status != LeaveStatus.PENDING:
            raise ValidationError({"detail": "This request has already been reviewed."})
        decision = request.data.get("decision")
        if decision not in ("approved", "rejected"):
            raise ValidationError({"decision": "Use 'approved' or 'rejected'."})
        leave.status = decision
        leave.reviewed_by = request.user
        leave.remarks = str(request.data.get("remarks", ""))[:300]
        leave.reviewed_at = timezone.now()
        leave.save()
        if decision == LeaveStatus.APPROVED:
            services.apply_leave_to_attendance(leave)

        from notifications.service import notify
        notify(leave.user, "leave_reviewed",
               f"Leave {leave.get_status_display().lower()}: {leave.leave_type.name}",
               f"{leave.start_date} to {leave.end_date} ({leave.days} day(s))"
               + (f"\nRemarks: {leave.remarks}" if leave.remarks else ""),
               link="/hr")
        return Response(LeaveRequestSerializer(leave).data)

    @action(detail=False, methods=["get"])
    def balances(self, request):
        target = _target_user(request)
        return Response(services.leave_balances(target))


# ------------------------------------------------------- admin/geo/face

class OfficeLocationViewSet(viewsets.ModelViewSet):
    serializer_class = OfficeLocationSerializer
    queryset = OfficeLocation.objects.all()
    pagination_class = None

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        return [HasCapability.of("hr.manage")()]


@api_view(["POST", "DELETE"])
@permission_classes([HasCapability.of("hr.manage")])
def face_enrolment(request, user_id):
    """Admin-only enrolment/removal. Stores only a numeric descriptor."""
    target = User.objects.filter(pk=user_id).first()
    if not target:
        return Response({"detail": "Unknown user."}, status=404)
    if request.method == "DELETE":
        FaceProfile.objects.filter(user=target).delete()
        return Response({"enrolled": False})
    descriptor = request.data.get("descriptor")
    if not isinstance(descriptor, list) or not 32 <= len(descriptor) <= 512:
        return Response({"descriptor": "Send the face descriptor vector (32-512 floats)."}, status=400)
    try:
        descriptor = [float(x) for x in descriptor]
    except (TypeError, ValueError):
        return Response({"descriptor": "Descriptor must be numeric."}, status=400)
    FaceProfile.objects.update_or_create(
        user=target, defaults={"descriptor": descriptor, "enrolled_by": request.user})
    return Response({"enrolled": True, "user": target.id})


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def hr_settings(request):
    """HR rules the company edits itself (PLAN.md §16.1). GET: current values and where they come from.
    PUT: {key: value}; a blank value goes back to the server default. HR administrators only."""
    from tenancy.company_settings import set_value

    if not can_manage_hr(request.user):
        raise PermissionDenied("Only an HR administrator can change HR settings.")
    if request.method == "PUT":
        errors, clean = {}, {}
        for key, value in (request.data or {}).items():
            if key not in services.EDITABLE:
                errors[key] = "Not an HR setting."
                continue
            try:
                clean[key] = services.clean_setting(key, value)
            except ValueError as exc:
                errors[key] = str(exc)
        if errors:
            return Response(errors, status=400)
        for key, text in clean.items():
            set_value(services.EDITABLE[key][0], text)
    from tenancy.models import CompanySetting

    conf = services.cfg()
    saved = set(CompanySetting.objects.exclude(value="").values_list("key", flat=True))
    return Response({
        # custom: the company saved its own value (else the server default applies)
        key: {"value": conf[key], "custom": env in saved,
              "kind": kind, "choices": list(extra) if kind == "choice" else None,
              "range": list(extra) if kind in ("int", "float") else None}
        for key, (env, kind, extra) in services.EDITABLE.items()
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def hr_config(request):
    conf = services.cfg()
    return Response({
        "geofence_enabled": conf["geofence_enabled"],
        "face_enabled": conf["face_enabled"],
        "work_start": conf["work_start"], "work_end": conf["work_end"],
        "week_offs": conf["week_offs"],
        "can_approve": approvals.is_approver(request.user),
        "can_manage": can_manage_hr(request.user),
    })
