# The Vehicle API (PLAN.md §22.12): API keys, updated_at for incremental sync, the audit action.

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models
from django.db.models.functions import Coalesce


def backfill_updated_at(apps, schema_editor):
    """Existing rows: the last time they really changed, not the day of this migration."""
    VehicleEntry = apps.get_model("visitors", "VehicleEntry")
    VehicleEntry.objects.update(updated_at=Coalesce("out_at", "in_at"))


class Migration(migrations.Migration):

    dependencies = [
        ('visitors', '0006_v41_keep_whom_to_meet'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='vehicleentry',
            name='updated_at',
            field=models.DateTimeField(auto_now=True, db_index=True),
        ),
        migrations.AlterField(
            model_name='gatelog',
            name='action',
            field=models.CharField(choices=[('visit_in', 'Visitor checked in'), ('visit_out', 'Visitor checked out'), ('visit_waiting_host', 'Visitor waiting for the host'), ('visit_edit', 'Visitor record changed'), ('open_accept', 'QR sign-in accepted'), ('open_reject', 'QR sign-in turned away'), ('host_allow', 'Host allowed'), ('host_deny', 'Host denied'), ('vehicle_in', 'Vehicle in'), ('vehicle_out', 'Vehicle out'), ('vehicle_edit', 'Vehicle record changed'), ('invite', 'Visitor invited'), ('invite_cancel', 'Invite cancelled'), ('pass_sent', 'Visitor pass sent'), ('watch_alert', 'Watchlist match let in'), ('watch_add', 'Added to the watchlist'), ('watch_remove', 'Removed from the watchlist'), ('delivery_in', 'Parcel received'), ('delivery_out', 'Parcel handed over'), ('delivery_return', 'Parcel returned'), ('contractor_pass', 'Contractor pass made'), ('contractor_in', 'Contractor in'), ('contractor_out', 'Contractor out'), ('contractor_revoke', 'Contractor pass revoked'), ('material_request', 'Material pass asked'), ('material_decide', 'Material pass decided'), ('material_gate', 'Material passed the gate'), ('material_return', 'Material returned'), ('patrol', 'Patrol checkpoint scanned'), ('checkpoint', 'Patrol checkpoints changed'), ('incident', 'Incident reported'), ('incident_close', 'Incident closed'), ('id_scan', 'ID card read'), ('code_approve', 'Check-in code approved'), ('code_miss', 'Wrong code entered'), ('host_answer', 'Host said where to wait'), ('sent_to_place', 'Visitor sent to the waiting place'), ('checkout_request', 'Check-out asked from the phone'), ('checkout_approve', 'Check-out approved'), ('checkout_hold', 'Check-out held'), ('settings', 'Visitor settings changed'), ('link', 'Visitor QR link changed'), ('api_key', 'Vehicle API key changed')], db_index=True, max_length=20),
        ),
        migrations.CreateModel(
            name='VehicleApiKey',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=80)),
                ('prefix', models.CharField(db_index=True, max_length=8)),
                ('key_hash', models.CharField(max_length=64, unique=True)),
                ('scope', models.CharField(default='vehicles:read', max_length=20)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('last_used_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('revoked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.RunPython(backfill_updated_at, migrations.RunPython.noop),
    ]
