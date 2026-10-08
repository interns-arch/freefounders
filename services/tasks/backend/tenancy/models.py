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
