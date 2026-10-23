import csv

from django.http import HttpResponse
from rest_framework import serializers, status as http, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import HasCapability, has_capability, refuse_own_records
from config.exports import ExportMixin, export_file, export_format, file_response
from crm.serializers import UserBriefSerializer

from . import services
from .models import Advance, PayrollRun, Payslip, RunStatus, SalaryStructure


def can_manage_payroll(user) -> bool:
    """Payroll runs and everyone's payslips (PLAN.md §19.19: Run payroll)."""
    return has_capability(user, "payroll.run")


def can_manage_salaries(user) -> bool:
    """Everyone's salary structures and advances (Salaries and advances)."""
    return has_capability(user, "payroll.salaries")


def sees_own_salary(user) -> bool:
    return has_capability(user, "payroll.self")


# ------------------------------------------------------------ serializers

class SalaryStructureSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)

    class Meta:
        model = SalaryStructure
        fields = ["id", "user", "user_detail", "monthly_gross", "basic", "pf_percent",
                  "professional_tax", "other_deduction", "effective_from", "note", "created_at"]

    def validate_monthly_gross(self, value):
        if value <= 0:
            raise serializers.ValidationError("Monthly gross must be greater than zero.")
        return value

    def validate(self, attrs):
        basic = attrs.get("basic", getattr(self.instance, "basic", None))
        gross = attrs.get("monthly_gross", getattr(self.instance, "monthly_gross", None))
        if basic and gross and basic > gross:
            raise serializers.ValidationError({"basic": "Basic cannot be more than the monthly gross."})
        return attrs


class AdvanceSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)
    # what is still to be recovered from coming payslips
    balance = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Advance
        fields = ["id", "user", "user_detail", "amount", "given_on", "reason",
                  "recovered", "recovered_amount", "balance", "created_at"]
        read_only_fields = ["recovered", "recovered_amount"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Advance must be greater than zero.")
        return value


class PayslipSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)
    total_deductions = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    month = serializers.IntegerField(source="run.month", read_only=True)
    year = serializers.IntegerField(source="run.year", read_only=True)
    run_status = serializers.CharField(source="run.status", read_only=True)

    class Meta:
        model = Payslip
        fields = ["id", "run", "month", "year", "run_status", "user", "user_detail",
                  "monthly_gross", "working_days", "payable_days", "lwp_days",
                  "earned_gross", "pf", "professional_tax", "advance_deduction",
                  "other_deduction", "total_deductions", "net_payable", "breakdown", "note"]


class PayrollRunSerializer(serializers.ModelSerializer):
    payslip_count = serializers.IntegerField(source="payslips.count", read_only=True)
    created_by_detail = UserBriefSerializer(source="created_by", read_only=True)

    class Meta:
        model = PayrollRun
        fields = ["id", "year", "month", "status", "working_days", "total_net",
                  "payslip_count", "created_by_detail", "finalised_at", "created_at"]
        read_only_fields = ["status", "working_days", "total_net", "finalised_at"]

    def validate(self, attrs):
        month = attrs.get("month")
        if month is not None and not 1 <= month <= 12:
            raise serializers.ValidationError({"month": "Month must be between 1 and 12."})
        return attrs


# ----------------------------------------------------------------- views

_PERSON = [("Employee", "user_detail.name"), ("Username", "user_detail.username")]


class SalaryStructureViewSet(ExportMixin, viewsets.ModelViewSet):
    """Salary is sensitive: HR/Admin see everyone, employees see only their own."""
    permission_classes = [IsAuthenticated]
    serializer_class = SalaryStructureSerializer
    pagination_class = None
    export_name = "salaries"
    export_columns = _PERSON + [
        ("Monthly gross", "monthly_gross"), ("Basic", "basic"), ("PF %", "pf_percent"),
        ("Professional tax", "professional_tax"), ("Other deduction", "other_deduction"),
        ("Effective from", "effective_from"), ("Note", "note"),
    ]

    def get_queryset(self):
        qs = SalaryStructure.objects.select_related("user")
        if not can_manage_salaries(self.request.user):
            return qs.filter(user=self.request.user) if sees_own_salary(self.request.user) else qs.none()
        if self.request.query_params.get("user"):
            qs = qs.filter(user_id=self.request.query_params["user"])
        return qs

    def _guard(self):
        if not can_manage_salaries(self.request.user):
            raise PermissionDenied("Your role does not include Salaries and advances.")

    def create(self, request, *args, **kwargs):
        self._guard()
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        self._guard()
        refuse_own_records(self.request.user, serializer.validated_data.get("user"))
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._guard()
        refuse_own_records(self.request.user, serializer.instance.user_id, serializer.validated_data.get("user"))
        serializer.save()

    def perform_destroy(self, instance):
        self._guard()
        refuse_own_records(self.request.user, instance.user_id)
        if Payslip.objects.filter(breakdown__structure_id=instance.pk).exists():
            raise ValidationError({"detail": "This salary has already been used in a payslip — "
                                             "add a new one with a later effective date instead."})
        instance.delete()


class AdvanceViewSet(ExportMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AdvanceSerializer
    pagination_class = None
    export_name = "advances"
    export_columns = _PERSON + [
        ("Amount", "amount"), ("Given on", "given_on"), ("Reason", "reason"),
        ("Recovered so far", "recovered_amount"), ("Still to recover", "balance"),
        ("Status", lambda r: "Recovered" if r.get("recovered") else "Pending"),
    ]

    def get_queryset(self):
        qs = Advance.objects.select_related("user")
        if not can_manage_salaries(self.request.user):
            return qs.filter(user=self.request.user) if sees_own_salary(self.request.user) else qs.none()
        p = self.request.query_params
        if p.get("user"):
            qs = qs.filter(user_id=p["user"])
        if p.get("pending") == "true":
            qs = qs.filter(recovered=False)
        return qs

    def _guard(self):
        if not can_manage_salaries(self.request.user):
            raise PermissionDenied("Your role does not include Salaries and advances.")

    def create(self, request, *args, **kwargs):
        self._guard()
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        self._guard()
        refuse_own_records(self.request.user, serializer.validated_data.get("user"))
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._guard()
        adv = serializer.instance
        refuse_own_records(self.request.user, adv.user_id, serializer.validated_data.get("user"))
        if adv.recovered:
            raise ValidationError({"detail": "A recovered advance cannot be edited."})
        if adv.recovered_amount > 0:
            # part of it is already in a finalised payslip: the person and the amount below that stay fixed
            new_user = serializer.validated_data.get("user")
            if new_user is not None and new_user.pk != adv.user_id:
                raise ValidationError({"user": "Part of this advance is already recovered; it stays with this person."})
            if serializer.validated_data.get("amount", adv.amount) < adv.recovered_amount:
                raise ValidationError({"amount": f"{adv.recovered_amount} of this advance is already recovered; "
                                                 "the amount cannot be less than that."})
        serializer.save()

    def perform_destroy(self, instance):
        self._guard()
        refuse_own_records(self.request.user, instance.user_id)
        if instance.recovered or instance.recovered_amount > 0:
            raise ValidationError({"detail": "A recovered advance cannot be deleted."})
        instance.delete()


class PayrollRunViewSet(ExportMixin, viewsets.ModelViewSet):
    permission_classes = [HasCapability.of("payroll.run")]
    serializer_class = PayrollRunSerializer
    queryset = PayrollRun.objects.select_related("created_by").all()
    pagination_class = None
    export_name = "payroll-runs"
    export_columns = [
        ("Year", "year"), ("Month", "month"),
        ("Status", lambda r: "Finalised" if r.get("status") == "finalised" else "Draft"),
        ("Working days", "working_days"), ("Payslips", "payslip_count"), ("Total net", "total_net"),
        ("Finalised at", "finalised_at"), ("Created by", "created_by_detail.name"),
    ]

    def perform_create(self, serializer):
        run = serializer.save(created_by=self.request.user)
        services.generate_run(run, User.objects.filter(is_active=True))

    def perform_update(self, serializer):
        if serializer.instance.status == RunStatus.FINALISED:
            raise ValidationError({"detail": "A finalised payroll cannot be changed."})
        serializer.save()

    def perform_destroy(self, instance):
        if instance.status == RunStatus.FINALISED:
            raise ValidationError({"detail": "A finalised payroll cannot be deleted."})
        instance.delete()

    @action(detail=True, methods=["post"])
    def generate(self, request, pk=None):
        """Recalculate a draft run — safe to press after fixing attendance."""
        run = self.get_object()
        try:
            result = services.generate_run(run, User.objects.filter(is_active=True))
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        run.refresh_from_db()
        return Response({**result, "run": PayrollRunSerializer(run).data})

    @action(detail=True, methods=["post"])
    def finalise(self, request, pk=None):
        run = self.get_object()
        try:
            result = services.finalise(run)
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)})
        run.refresh_from_db()
        return Response({**result, "run": PayrollRunSerializer(run).data})

    @action(detail=True, methods=["get"])
    def payslips(self, request, pk=None):
        run = self.get_object()
        slips = run.payslips.select_related("user", "run")
        return Response(PayslipSerializer(slips, many=True).data)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """The run's payslips as a sheet: CSV (as before) or ?export=xlsx."""
        run = self.get_object()
        header = ["Employee", "Username", "Monthly gross", "Working days",
                  "Payable days", "LWP days", "Earned gross", "PF",
                  "Professional tax", "Advance", "Other deduction", "Net payable"]
        rows = [[
            s.user.get_full_name() or s.user.username, s.user.username,
            s.monthly_gross, s.working_days, s.payable_days, s.lwp_days,
            s.earned_gross, s.pf, s.professional_tax, s.advance_deduction,
            s.other_deduction, s.net_payable,
        ] for s in run.payslips.select_related("user")]
        stem = f"payroll-{run.year}-{run.month:02d}"
        if export_format(request) == "xlsx":
            total = [""] * (len(header) - 2) + ["TOTAL", run.total_net]
            return export_file("xlsx", f"Payroll {run.month:02d}-{run.year}", stem, header, rows + [[], total])
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{stem}.csv"'
        from config.exports import safe_row
        writer = csv.writer(response)
        writer.writerow(header)
        for r in rows:
            writer.writerow(safe_row(r))
        writer.writerow([])
        writer.writerow([""] * (len(header) - 2) + ["TOTAL", run.total_net])
        return response

    @action(detail=True, methods=["get"])
    def payslips_pdf(self, request, pk=None):
        """Every payslip of the run as PDFs: ?bundle=zip (one PDF each, default) or ?bundle=pdf (one combined PDF)."""
        from .pdf import payslip_pdf, payslips_zip
        run = self.get_object()
        slips = list(run.payslips.select_related("user", "user__reporting_manager", "run"))
        if not slips:
            raise ValidationError({"detail": "This payroll has no payslips yet."})
        stem = f"payslips-{run.year}-{run.month:02d}"
        if request.query_params.get("bundle") == "pdf":
            return file_response(payslip_pdf(slips), f"{stem}.pdf")
        return file_response(payslips_zip(slips), f"{stem}.zip")


class PayslipViewSet(ExportMixin, viewsets.ReadOnlyModelViewSet):
    """Employees can read their own payslips — only from finalised runs, so
    nobody sees a half-computed draft figure."""
    permission_classes = [IsAuthenticated]
    serializer_class = PayslipSerializer
    pagination_class = None
    export_name = "payslips"
    export_columns = [
        ("Year", "year"), ("Month", "month"), ("Employee", "user_detail.name"),
        ("Monthly gross", "monthly_gross"), ("Working days", "working_days"), ("Paid days", "payable_days"),
        ("LWP days", "lwp_days"), ("Earned gross", "earned_gross"), ("PF", "pf"),
        ("Professional tax", "professional_tax"), ("Advance recovered", "advance_deduction"),
        ("Other deduction", "other_deduction"), ("Total deductions", "total_deductions"),
        ("Net pay", "net_payable"),
    ]

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """One payslip as a PDF: the same rows as viewing it (own finalised payslips with payroll.self,
        everyone's with payroll.run)."""
        from .pdf import payslip_pdf, slip_filename
        slip = self.get_object()
        return file_response(payslip_pdf([slip]), slip_filename(slip))

    def get_queryset(self):
        qs = Payslip.objects.select_related("user", "run", "user__reporting_manager")
        if can_manage_payroll(self.request.user):
            p = self.request.query_params
            if p.get("user"):
                qs = qs.filter(user_id=p["user"])
            if p.get("status") in (RunStatus.DRAFT, RunStatus.FINALISED):
                qs = qs.filter(run__status=p["status"])   # My salary: finalised months only
            return qs
        if not sees_own_salary(self.request.user):
            return qs.none()
        return qs.filter(user=self.request.user, run__status=RunStatus.FINALISED)
