"""Visitor management (PLAN.md §22): the digital gate register of one company.

Everything lives in the company's own schema (§14), like HR. Photos are stored under private/ and only served by the
permission-checked photo endpoints (never by /media/), like punch photos. Only the last 4 digits of an ID number are
ever kept. Every gate action writes a GateLog row (who, when, what, before -> after).
"""
import secrets
import uuid
from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone


def photo_path(instance, _filename):
    """Private: never served by /media/, only by the visitors photo endpoints."""
    day = date.today()
    return f"private/visitors/{day:%Y/%m}/{uuid.uuid4().hex}.jpg"


def new_token() -> str:
    return secrets.token_urlsafe(16)


class Visitor(models.Model):
    """One person who came to the gate, found again by mobile number (returning visitors fill themselves in)."""
    name = models.CharField(max_length=80)
    mobile = models.CharField(max_length=16, db_index=True, blank=True, default="")
    company = models.CharField(max_length=120, blank=True, default="")
    photo = models.FileField(upload_to=photo_path, blank=True, default="")
    id_type = models.CharField(max_length=30, blank=True, default="")
    id_last4 = models.CharField(max_length=4, blank=True, default="")
    first_visit_at = models.DateTimeField(default=timezone.now)
    last_visit_at = models.DateTimeField(default=timezone.now)
    visits = models.PositiveIntegerField(default=0)
    anonymised = models.BooleanField(default=False)

    class Meta:
        ordering = ["-last_visit_at"]

    def __str__(self):
        return f"{self.name} ({self.mobile})"


class VisitStatus(models.TextChoices):
    WAITING = "waiting", "Waiting at the gate"          # sent from the open QR link, the guard has not seen them in
    WAITING_HOST = "waiting_host", "Waiting for the host"
    INSIDE = "inside", "Inside"
    OUT = "out", "Checked out"
    DENIED = "denied", "Denied by the host"
    REJECTED = "rejected", "Turned away at the gate"


class VisitSource(models.TextChoices):
    GATE = "gate", "At the gate"
    OPEN_LINK = "open_link", "QR self sign-in"


class GateLink(models.Model):
    """The company's one open QR link (founder, 2026-10-26: one fixed QR per company, printed once). "Make a new QR"
    replaces the token, so a leaked old QR stops working. The guard picks the gate at check-in."""
    token = models.CharField(max_length=40, unique=True, default=new_token)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]


class Visit(models.Model):
    visitor = models.ForeignKey(Visitor, on_delete=models.PROTECT, related_name="visit_set")
    # Copies as they were on the day (the visitor's own row changes on the next visit).
    name = models.CharField(max_length=80)
    mobile = models.CharField(max_length=16, blank=True, default="")
    company = models.CharField(max_length=120, blank=True, default="")
    host = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                             related_name="visitor_visits")
    # "Reception", a department, or the name the visitor typed on the open link (the guard picks the person).
    host_label = models.CharField(max_length=80, blank=True, default="")
    location = models.ForeignKey("hr.OfficeLocation", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="visits")
    purpose = models.CharField(max_length=60, blank=True, default="")
    people = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=14, choices=VisitStatus.choices, default=VisitStatus.INSIDE, db_index=True)
    source = models.CharField(max_length=10, choices=VisitSource.choices, default=VisitSource.GATE)
    pass_no = models.CharField(max_length=20, blank=True, default="", db_index=True)
    pass_token = models.CharField(max_length=40, unique=True, default=new_token)
    # What the visitor sees on the open link's thank-you screen and tells the guard.
    short_code = models.CharField(max_length=8, blank=True, default="", db_index=True)
    photo = models.FileField(upload_to=photo_path, blank=True, default="")
    id_type = models.CharField(max_length=30, blank=True, default="")
    id_last4 = models.CharField(max_length=4, blank=True, default="")
    vehicle_no = models.CharField(max_length=15, blank=True, default="")
    vehicle = models.ForeignKey("VehicleEntry", null=True, blank=True, on_delete=models.SET_NULL, related_name="visits")
    items = models.CharField(max_length=300, blank=True, default="")
    notes = models.CharField(max_length=500, blank=True, default="")
    consent_at = models.DateTimeField(null=True, blank=True)
    host_decision_at = models.DateTimeField(null=True, blank=True)
    host_decision_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                         related_name="+")
    check_in_at = models.DateTimeField(null=True, blank=True, db_index=True)
    check_in_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    check_out_at = models.DateTimeField(null=True, blank=True)
    check_out_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name="+")
    overstay_alerted_at = models.DateTimeField(null=True, blank=True)
    # Open link: a one-way hash of the sender's address (rate limit per address), never the address itself.
    ip_hash = models.CharField(max_length=24, blank=True, default="", db_index=True)
    gate_link = models.ForeignKey(GateLink, null=True, blank=True, on_delete=models.SET_NULL, related_name="visits")
    anonymised = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def minutes_inside(self, now=None) -> int | None:
        if not self.check_in_at:
            return None
        end = self.check_out_at or now or timezone.now()
        return max(0, int((end - self.check_in_at).total_seconds() // 60))


class VehicleType(models.TextChoices):
    CAR = "car", "Car"
    BIKE = "bike", "Bike / scooter"
    TRUCK = "truck", "Truck"
    TEMPO = "tempo", "Tempo / van"
    OTHER = "other", "Other"


class VehicleEntry(models.Model):
    """One vehicle in and (later) out of the premises."""
    number = models.CharField(max_length=15, db_index=True)
    type = models.CharField(max_length=10, choices=VehicleType.choices, default=VehicleType.CAR)
    driver_name = models.CharField(max_length=80, blank=True, default="")
    driver_mobile = models.CharField(max_length=16, blank=True, default="")
    purpose = models.CharField(max_length=120, blank=True, default="")
    company = models.CharField(max_length=120, blank=True, default="")
    items = models.CharField(max_length=300, blank=True, default="")
    parking_slot = models.CharField(max_length=30, blank=True, default="")
    notes = models.CharField(max_length=500, blank=True, default="")
    location = models.ForeignKey("hr.OfficeLocation", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="vehicle_entries")
    photo_in = models.FileField(upload_to=photo_path, blank=True, default="")
    photo_out = models.FileField(upload_to=photo_path, blank=True, default="")
    in_at = models.DateTimeField(default=timezone.now, db_index=True)
    in_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    out_at = models.DateTimeField(null=True, blank=True)
    out_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    anonymised = models.BooleanField(default=False)

    class Meta:
        ordering = ["-in_at"]

    @property
    def inside(self) -> bool:
        return self.out_at is None

    def minutes_inside(self, now=None) -> int:
        end = self.out_at or now or timezone.now()
        return max(0, int((end - self.in_at).total_seconds() // 60))


class GateAction(models.TextChoices):
    VISIT_IN = "visit_in", "Visitor checked in"
    VISIT_OUT = "visit_out", "Visitor checked out"
    VISIT_WAITING_HOST = "visit_waiting_host", "Visitor waiting for the host"
    VISIT_EDIT = "visit_edit", "Visitor record changed"
    OPEN_ACCEPT = "open_accept", "QR sign-in accepted"
    OPEN_REJECT = "open_reject", "QR sign-in turned away"
    HOST_ALLOW = "host_allow", "Host allowed"
    HOST_DENY = "host_deny", "Host denied"
    VEHICLE_IN = "vehicle_in", "Vehicle in"
    VEHICLE_OUT = "vehicle_out", "Vehicle out"
    VEHICLE_EDIT = "vehicle_edit", "Vehicle record changed"
    SETTINGS = "settings", "Visitor settings changed"
    LINK = "link", "Visitor QR link changed"


class GateLog(models.Model):
    """Every gate action (PLAN.md §22.5: the register is never changed silently)."""
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                              related_name="gate_logs")
    at = models.DateTimeField(default=timezone.now, db_index=True)
    action = models.CharField(max_length=20, choices=GateAction.choices, db_index=True)
    visit = models.ForeignKey(Visit, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    vehicle = models.ForeignKey(VehicleEntry, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    summary = models.CharField(max_length=300, blank=True, default="")
    # {"field": [before, after]} for edits
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-at", "-id"]
