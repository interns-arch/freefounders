from django.db import models


class CompanySetting(models.Model):
    """A company's own value for something that is an environment variable in
    a single-company install (HR hours, geofence, WhatsApp/Gmail/AI keys...).

    Lives in each company's schema. Secrets are stored encrypted with
    SETTINGS_KEY (see company_settings.py). Edited from the Settings Center
    (Phase 4); until then by `manage.py company_setting`.
    """

    key = models.CharField(max_length=100, unique=True)
    value = models.TextField(blank=True, default="")
    secret = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.key


class OutboxEvent(models.Model):
    """An event for the Kaampilot Platform (PLAN.md §17.4); it reads them with GET /api/internal/events and
    runs its cross-app rules. Only written when the app runs with Platform sign-in."""

    type = models.CharField(max_length=60)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class SettingChange(models.Model):
    """Who changed a company setting from Settings → Integrations, and when (PLAN.md §19.40). Never the value."""

    key = models.CharField(max_length=100)
    action = models.CharField(max_length=10)          # "set" or "removed"
    actor_id = models.IntegerField(null=True, blank=True)
    actor_name = models.CharField(max_length=150, blank=True, default="")
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
