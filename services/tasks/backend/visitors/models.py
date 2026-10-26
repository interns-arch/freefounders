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
    EXPECTED = "expected", "Expected"                   # invited in advance by an employee (V2), not at the gate yet
    WAITING = "waiting", "Waiting at the gate"          # sent from the open QR link, the guard has not seen them in
    WAITING_HOST = "waiting_host", "Waiting for the host"
    INSIDE = "inside", "Inside"
    OUT = "out", "Checked out"
    DENIED = "denied", "Denied by the host"
    REJECTED = "rejected", "Turned away at the gate"
    CANCELLED = "cancelled", "Invite cancelled"
    NO_SHOW = "no_show", "Did not come"


class VisitSource(models.TextChoices):
    GATE = "gate", "At the gate"
    OPEN_LINK = "open_link", "QR self sign-in"
    INVITE = "invite", "Invited in advance"


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
    # Pre-invites (V2): the window the host expects them in, who invited, a shared id for a group invite.
    email = models.EmailField(blank=True, default="")
    expected_at = models.DateTimeField(null=True, blank=True, db_index=True)
    expected_until = models.DateTimeField(null=True, blank=True)
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="visitor_invites")
    group = models.CharField(max_length=12, blank=True, default="", db_index=True)
    # The pass link sent to the visitor (WhatsApp / email): when, and what each channel answered.
    pass_sent_at = models.DateTimeField(null=True, blank=True)
    pass_channels = models.JSONField(default=list, blank=True)
    # Watchlist (V2): why the gate was warned about this visitor (kept with the visit).
    watch_note = models.CharField(max_length=200, blank=True, default="")
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


class DeliveryStatus(models.TextChoices):
    AT_GATE = "at_gate", "Waiting at the gate"
    COLLECTED = "collected", "Collected"
    RETURNED = "returned", "Returned to the courier"


class Delivery(models.Model):
    """A parcel / courier received at the gate (V2): the person it is for is told, and it is handed over later."""
    courier = models.CharField(max_length=60, blank=True, default="")
    tracking_no = models.CharField(max_length=60, blank=True, default="", db_index=True)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="deliveries")
    recipient_label = models.CharField(max_length=80, blank=True, default="")   # "Accounts", "Reception"…
    parcels = models.PositiveSmallIntegerField(default=1)
    description = models.CharField(max_length=200, blank=True, default="")
    photo = models.FileField(upload_to=photo_path, blank=True, default="")
    location = models.ForeignKey("hr.OfficeLocation", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="deliveries")
    status = models.CharField(max_length=10, choices=DeliveryStatus.choices, default=DeliveryStatus.AT_GATE,
                              db_index=True)
    received_at = models.DateTimeField(default=timezone.now, db_index=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    # Handed over: to whom (typed: the recipient or someone collecting for them), when, by which guard.
    collected_by_name = models.CharField(max_length=80, blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    notes = models.CharField(max_length=300, blank=True, default="")
    reminded_at = models.DateTimeField(null=True, blank=True)
    anonymised = models.BooleanField(default=False)

    class Meta:
        ordering = ["-received_at"]


class WatchEntry(models.Model):
    """Watchlist / blocklist (V2): a mobile number or name the gate is warned about. Only admins edit it; removing an
    entry keeps the row (who added / removed, when) for the record."""
    mobile = models.CharField(max_length=16, blank=True, default="", db_index=True)
    name = models.CharField(max_length=80, blank=True, default="")
    reason = models.CharField(max_length=200)
    active = models.BooleanField(default=True, db_index=True)
    added_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="+")
    added_at = models.DateTimeField(default=timezone.now)
    removed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="+")
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-added_at"]


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
    INVITE = "invite", "Visitor invited"
    INVITE_CANCEL = "invite_cancel", "Invite cancelled"
    PASS_SENT = "pass_sent", "Visitor pass sent"
    WATCH_ALERT = "watch_alert", "Watchlist match let in"
    WATCH_ADD = "watch_add", "Added to the watchlist"
    WATCH_REMOVE = "watch_remove", "Removed from the watchlist"
    DELIVERY_IN = "delivery_in", "Parcel received"
    DELIVERY_OUT = "delivery_out", "Parcel handed over"
    DELIVERY_RETURN = "delivery_return", "Parcel returned"
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
    delivery = models.ForeignKey(Delivery, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    summary = models.CharField(max_length=300, blank=True, default="")
    # {"field": [before, after]} for edits
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-at", "-id"]
