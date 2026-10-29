"""Visitors V4.1 (PLAN.md §22.11, 2026-10-29): "Ask visitors whom they are meeting" became a company setting that is
off for a new company. A company that already uses Visitors (it has visits, its visitor QR, or saved visitor settings)
keeps asking: its VISITORS_SETTINGS get whom_to_meet = true. Data only, no table changes; runs once per company
schema (migrate_companies) and does nothing on a new, empty company.
"""
import json

from django.db import migrations

KEY = "VISITORS_SETTINGS"


def keep_whom_to_meet(apps, schema_editor):
    Setting = apps.get_model("tenancy", "CompanySetting")
    Visit = apps.get_model("visitors", "Visit")
    GateLink = apps.get_model("visitors", "GateLink")
    row = Setting.objects.filter(key=KEY).first()
    if not (row or Visit.objects.exists() or GateLink.objects.exists()):
        return
    try:
        saved = json.loads(row.value) if row and row.value else {}
    except ValueError:
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    if "whom_to_meet" in saved:
        return
    saved["whom_to_meet"] = True
    if row:
        row.value = json.dumps(saved)
        row.save(update_fields=["value", "updated_at"])
    else:
        Setting.objects.create(key=KEY, value=json.dumps(saved), secret=False)


class Migration(migrations.Migration):

    dependencies = [
        ("visitors", "0005_v4_codes_checkout_host_answer"),
        ("tenancy", "0003_setting_change"),
    ]

    operations = [migrations.RunPython(keep_whom_to_meet, migrations.RunPython.noop)]
