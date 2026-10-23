from django.conf import settings
from django.db import models

from .categories import CATEGORIES, category_for


class Notification(models.Model):
    """One in-app notification for one user. `channels` records what the
    fan-out did on every configured channel, e.g.
    [{"channel": "whatsapp", "status": "skipped", "detail": "not configured"}]
    so delivery is auditable per notification.
    """
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=40)          # lead_assigned, follow_up_due, status_change, ...
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True, default="")
    link = models.CharField(max_length=200, blank=True, default="")
    # attendance | tasks | approvals | company (notifications/categories.py, PLAN.md §19.37); filled from the type.
    category = models.CharField(max_length=20, blank=True, default="")
    channels = models.JSONField(default=list, blank=True)
    # A WhatsApp held back because it came up outside the company's sending hours
    # (WHATSAPP_HOURS, default 10 AM - 7 PM): {"template": name|None, "params": [...], "text": str}.
    # Sent at the next opening, then cleared.
    wa_deferred = models.JSONField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "read_at"]),
                   models.Index(fields=["user", "category", "read_at"], name="notif_user_cat_read")]

    def save(self, *args, **kwargs):
        if not self.category or self.category not in CATEGORIES:
            self.category = category_for(self.type)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"[{self.type}] {self.title} -> {self.user}"


# Delivery outcomes for WhatsApp live in their own module but must be
# imported here so Django picks the model up.
from .delivery import WhatsAppDelivery  # noqa: E402,F401
