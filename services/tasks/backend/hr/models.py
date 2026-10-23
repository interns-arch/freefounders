"""Leave & Attendance.

Attendance is one row per employee per day. Check-in/out capture GPS (and
a punch photo when the company asks for one); the server decides status, lateness and
working hours -- never the client. Approved leave writes LEAVE days into
attendance so both modules agree on where someone was.
"""
from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone


class OfficeLocation(models.Model):
    """A geo-fence: employees may only mark attendance inside `radius_m`."""
    name = models.CharField(max_length=120, unique=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    radius_m = models.PositiveIntegerField(default=200)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.radius_m} m)"


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Present"
    ABSENT = "absent", "Absent"
    HALF_DAY = "half_day", "Half Day"
    LATE = "late", "Late"
    LEAVE = "leave", "Leave"
    HOLIDAY = "holiday", "Holiday"
    WEEK_OFF = "week_off", "Week Off"


def attendance_photo_path(instance, _filename):
    """Punch-in photos live under private/: never served by /media/, only through the
    permission-checked attendance photo endpoint (PLAN.md §16.4)."""
    import uuid
    day = instance.date or date.today()
    return f"private/attendance/{day:%Y/%m}/{uuid.uuid4().hex}.jpg"


class Attendance(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="attendance")
    date = models.DateField()
    check_in = models.DateTimeField(null=True, blank=True)
    check_out = models.DateTimeField(null=True, blank=True)
    check_in_lat = models.FloatField(null=True, blank=True)
    check_in_lng = models.FloatField(null=True, blank=True)
    check_out_lat = models.FloatField(null=True, blank=True)
    check_out_lng = models.FloatField(null=True, blank=True)
    location = models.ForeignKey(OfficeLocation, null=True, blank=True,
                                 on_delete=models.SET_NULL)
    status = models.CharField(max_length=10, choices=AttendanceStatus.choices,
                              default=AttendanceStatus.PRESENT)
    working_minutes = models.PositiveIntegerField(default=0)
    is_late = models.BooleanField(default=False)
    is_early_checkout = models.BooleanField(default=False)
    face_verified = models.BooleanField(default=False)
    face_confidence = models.FloatField(null=True, blank=True)
    leave_request = models.ForeignKey("hr.LeaveRequest", null=True, blank=True,
                                      on_delete=models.SET_NULL, related_name="attendance_days")
    note = models.CharField(max_length=300, blank=True, default="")
    # Photo taken at the punch (Kaampilot, PLAN.md §16.4); emptied after the retention period.
    check_in_photo = models.FileField(upload_to=attendance_photo_path, blank=True, default="")
    check_out_photo = models.FileField(upload_to=attendance_photo_path, blank=True, default="")
    # Answer to the company's uniform question at check-in (PLAN.md §19.27); empty when it was not asked.
    uniform_ok = models.BooleanField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["user", "date"], name="uniq_attendance_day")]
        indexes = [models.Index(fields=["user", "date"]), models.Index(fields=["date"])]

    @property
    def missing_checkout(self) -> bool:
        return bool(self.check_in and not self.check_out and self.date < timezone.localdate())

    def __str__(self):
        return f"{self.user} {self.date} {self.status}"


class CorrectionStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"


class AttendanceCorrection(models.Model):
    """"I forgot to check out" -- reviewed by a manager/admin."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="attendance_corrections")
    date = models.DateField()
    requested_check_in = models.DateTimeField(null=True, blank=True)
    requested_check_out = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(max_length=1000)
    status = models.CharField(max_length=10, choices=CorrectionStatus.choices,
                              default=CorrectionStatus.PENDING)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="reviewed_corrections")
    remarks = models.CharField(max_length=300, blank=True, default="")
    # Approval reminders (PLAN.md §17.2): when the approver was reminded, and when it went to HR.
    reminded_at = models.DateTimeField(null=True, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class LeaveType(models.Model):
    name = models.CharField(max_length=60, unique=True)
    annual_quota = models.PositiveIntegerField(default=12)
    paid = models.BooleanField(default=True)
    requires_document = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    # Comp-off is not drawn from annual_quota -- its balance is whatever the
    # person has banked in CompOff minus what they have already taken.
    is_comp_off = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CompOffSource(models.TextChoices):
    OPENING = "opening", "Opening balance"
    WORKED = "worked", "Worked a week off"
    MANUAL = "manual", "Added by HR"


class CompOff(models.Model):
    """One banked comp-off day: the person worked on a day they were off, so
    they may take one back later. One row per person per date -- working the
    same Sunday twice is not a thing."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="comp_offs")
    date = models.DateField()
    days = models.DecimalField(max_digits=3, decimal_places=1, default=1)
    source = models.CharField(max_length=12, choices=CompOffSource.choices,
                              default=CompOffSource.WORKED)
    note = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL,
                                   related_name="comp_offs_created")

    class Meta:
        ordering = ["-date"]
        constraints = [
            models.UniqueConstraint(fields=["user", "date"], name="one_comp_off_per_day"),
        ]

    def __str__(self):
        return f"{self.user} {self.date} ({self.days}d)"


class LeaveStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    CANCELLED = "cancelled", "Cancelled"


class LeaveRequest(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="leave_requests")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveIntegerField(default=1)
    # Half a day (one working day only): counts 0.5 against the balance (`days` stays 1).
    half_day = models.BooleanField(default=False)
    reason = models.TextField(max_length=1000)
    document = models.FileField(upload_to="leave_docs/", null=True, blank=True)
    status = models.CharField(max_length=10, choices=LeaveStatus.choices,
                              default=LeaveStatus.PENDING)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="reviewed_leaves")
    remarks = models.CharField(max_length=300, blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Approval reminders (PLAN.md §17.2): when the approver was reminded, and when it went to HR.
    reminded_at = models.DateTimeField(null=True, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)
    # Approved (or marked by HR) beyond the leave balance with the explicit override: who and when.
    beyond_balance = models.BooleanField(default=False)
    beyond_balance_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                          on_delete=models.SET_NULL, related_name="leaves_beyond_balance")
    beyond_balance_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def leave_days(self) -> float:
        """What this request takes from the balance: 0.5 for a half day, else its working days."""
        return 0.5 if self.half_day else float(self.days)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "status"])]

    def __str__(self):
        return f"{self.user} {self.leave_type} {self.start_date}..{self.end_date} [{self.status}]"


class FaceProfile(models.Model):
    """A face descriptor stored before face check was removed (PLAN.md §19.18).
    Kept readable for old data; nothing creates or matches one any more. HR can
    still delete a profile (DELETE /hr/face/<user>/), and deleting a person
    removes theirs."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                related_name="face_profile")
    descriptor = models.JSONField(default=list)
    enrolled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="enrolled_faces")
    enrolled_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Face profile: {self.user}"
