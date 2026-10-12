"""Face check removed (founder, 2026-10-12; PLAN.md §19.18): a punch is the office geofence + a selfie.

Switches FACE_RECOGNITION_ENABLED off in this database's company settings (in multi-company mode `migrate_companies`
runs this in every company schema, so every company is switched off). The code already treats face check as off; this
keeps the stored value honest for anyone reading the settings table. Face profiles and the face_verified /
face_confidence columns are kept (old data stays readable). Reversing does nothing: the old value is not known.
"""
from django.db import migrations


def switch_off(apps, schema_editor):
    CompanySetting = apps.get_model("tenancy", "CompanySetting")
    CompanySetting.objects.filter(key="FACE_RECOGNITION_ENABLED").exclude(value="false").update(value="false")


class Migration(migrations.Migration):

    dependencies = [
        ("hr", "0005_approval_reminders"),
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(switch_off, migrations.RunPython.noop),
    ]
