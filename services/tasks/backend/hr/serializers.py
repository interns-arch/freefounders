from datetime import timedelta

from rest_framework import serializers

from config.media import file_url

from crm.serializers import UserBriefSerializer

from .models import (
    Attendance, AttendanceCorrection, LeaveRequest, LeaveType, OfficeLocation,
)


class OfficeLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = OfficeLocation
        fields = ["id", "name", "latitude", "longitude", "radius_m", "active"]

    def validate(self, attrs):
        lat = attrs.get("latitude", getattr(self.instance, "latitude", 0))
        lng = attrs.get("longitude", getattr(self.instance, "longitude", 0))
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            raise serializers.ValidationError({"latitude": "Invalid coordinates."})
        return attrs


class AttendanceSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True, default=None)
    missing_checkout = serializers.BooleanField(read_only=True)
    has_check_in_photo = serializers.SerializerMethodField()
    has_check_out_photo = serializers.SerializerMethodField()

    def get_has_check_in_photo(self, obj):
        return bool(obj.check_in_photo)

    def get_has_check_out_photo(self, obj):
        return bool(obj.check_out_photo)

    class Meta:
        model = Attendance
        fields = ["id", "user", "user_detail", "date", "check_in", "check_out",
                  "status", "status_display", "working_minutes", "is_late",
                  "is_early_checkout", "missing_checkout", "face_verified",
                  "face_confidence", "location_name", "note", "has_check_in_photo", "has_check_out_photo",
                  "uniform_ok"]


class MarkSerializer(serializers.Serializer):
    """Payload for check-in/out. The client sends raw GPS + an optional punch
    photo; every decision is made server-side. `face_descriptor` is still
    accepted from older clients and ignored (no face check, PLAN.md §19.18)."""
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    face_descriptor = serializers.ListField(
        child=serializers.FloatField(), required=False, allow_null=True, max_length=512)
    # Punch photo as a data URL (JPEG ≤ 400 KB once decoded); kept only when the company asks for it.
    photo = serializers.CharField(required=False, allow_null=True, allow_blank=True, max_length=600_000)
    # Check-in only: "are you wearing the company shirt / jersey?" (needed when the company asks, PLAN.md §19.27).
    uniform = serializers.BooleanField(required=False, allow_null=True)
    # The phone's GPS accuracy in metres: a rough fix near the office gets "not accurate enough" (PLAN.md §19.36).
    accuracy = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=1_000_000)


class CorrectionSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)
    reviewed_by_detail = UserBriefSerializer(source="reviewed_by", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = AttendanceCorrection
        fields = ["id", "user", "user_detail", "date", "requested_check_in",
                  "requested_check_out", "reason", "status", "status_display",
                  "reviewed_by_detail", "remarks", "created_at"]
        read_only_fields = ["user", "status", "reviewed_by_detail", "remarks"]

    def validate(self, attrs):
        if not attrs.get("requested_check_in") and not attrs.get("requested_check_out"):
            raise serializers.ValidationError("Provide a corrected check-in or check-out time.")
        from django.utils import timezone
        if attrs.get("date") and attrs["date"] > timezone.localdate():
            raise serializers.ValidationError({"date": "A correction is for a day that has already started."})
        return attrs


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ["id", "name", "annual_quota", "paid", "requires_document", "active"]


class LeaveRequestSerializer(serializers.ModelSerializer):
    user_detail = UserBriefSerializer(source="user", read_only=True)
    reviewed_by_detail = UserBriefSerializer(source="reviewed_by", read_only=True)
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    document_url = serializers.SerializerMethodField()
    leave_days = serializers.FloatField(read_only=True)
    beyond_balance_by_detail = UserBriefSerializer(source="beyond_balance_by", read_only=True)
    balance_check = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = ["id", "user", "user_detail", "leave_type", "leave_type_name",
                  "start_date", "end_date", "days", "half_day", "leave_days", "reason", "document", "document_url",
                  "status", "status_display", "reviewed_by_detail", "remarks",
                  "reviewed_at", "beyond_balance", "beyond_balance_by_detail", "beyond_balance_at",
                  "balance_check", "created_at"]
        read_only_fields = ["user", "days", "status", "reviewed_by_detail",
                            "remarks", "reviewed_at", "beyond_balance", "beyond_balance_at"]
        extra_kwargs = {"document": {"write_only": True, "required": False}}

    def get_document_url(self, obj):
        return file_url(obj.document)

    def get_balance_check(self, obj):
        """Pending requests only: would approving it go beyond the person's balance? (The approval screen warns.)"""
        if obj.status != "pending":
            return None
        from .services import leave_balance_check
        return leave_balance_check(obj.user, obj.leave_type, obj.start_date, obj.leave_days, exclude_pk=obj.pk)

    def validate_document(self, value):
        from config.images import check_size, compress_upload
        try:
            check_size(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        return compress_upload(value)  # a photo is stored as a smaller JPEG (PLAN.md §19.20)

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "End date cannot be before the start date."})
        if start and end and (end - start) > timedelta(days=90):
            raise serializers.ValidationError({"end_date": "Leave range cannot exceed 90 days."})
        if attrs.get("half_day"):
            s, e = start or getattr(self.instance, "start_date", None), end or getattr(self.instance, "end_date", None)
            if s and e and s != e:
                raise serializers.ValidationError({"half_day": "A half day is one date: make the start and end date the same."})
        leave_type = attrs.get("leave_type")
        if leave_type and leave_type.requires_document and not attrs.get("document"):
            raise serializers.ValidationError({"document": f"{leave_type.name} requires a supporting document."})
        return attrs
