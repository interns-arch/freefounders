# Visitors V4 (PLAN.md §22.11): codes, device binding, check-out QR, host answer, feedback.

import django.db.models.deletion
import visitors.models
from django.conf import settings
from django.db import migrations, models


def fill_checkout_tokens(apps, schema_editor):
    GateLink = apps.get_model("visitors", "GateLink")
    for link in GateLink.objects.all():
        link.checkout_token = visitors.models.new_token()
        link.save(update_fields=["checkout_token"])


class Migration(migrations.Migration):

    dependencies = [
        ('visitors', '0004_v3_contractors_material_patrol_incidents'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='gatelink',
            name='checkout_rotated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        # A unique token per existing row: add it plain, fill each row, then make it unique.
        migrations.AddField(
            model_name='gatelink',
            name='checkout_token',
            field=models.CharField(default=visitors.models.new_token, max_length=40, null=True),
        ),
        migrations.RunPython(fill_checkout_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='gatelink',
            name='checkout_token',
            field=models.CharField(default=visitors.models.new_token, max_length=40, unique=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='check_in_via',
            field=models.CharField(blank=True, default='', max_length=6),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_code',
            field=models.CharField(blank=True, db_index=True, default='', max_length=8),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_code_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_held_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_hold_note',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_requested_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='checkout_via',
            field=models.CharField(blank=True, default='', max_length=6),
        ),
        migrations.AddField(
            model_name='visit',
            name='code_expires_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='device_hash',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='visit',
            name='feedback_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='feedback_comment',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='visit',
            name='feedback_rating',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='host_answer',
            field=models.CharField(blank=True, default='', max_length=12),
        ),
        migrations.AddField(
            model_name='visit',
            name='host_answered_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='host_note',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='visit',
            name='host_notified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='host_place',
            field=models.CharField(blank=True, default='', max_length=80),
        ),
        migrations.AddField(
            model_name='visit',
            name='sent_to_place_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='visit',
            name='sent_to_place_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='gatelog',
            name='action',
            field=models.CharField(choices=[('visit_in', 'Visitor checked in'), ('visit_out', 'Visitor checked out'), ('visit_waiting_host', 'Visitor waiting for the host'), ('visit_edit', 'Visitor record changed'), ('open_accept', 'QR sign-in accepted'), ('open_reject', 'QR sign-in turned away'), ('host_allow', 'Host allowed'), ('host_deny', 'Host denied'), ('vehicle_in', 'Vehicle in'), ('vehicle_out', 'Vehicle out'), ('vehicle_edit', 'Vehicle record changed'), ('invite', 'Visitor invited'), ('invite_cancel', 'Invite cancelled'), ('pass_sent', 'Visitor pass sent'), ('watch_alert', 'Watchlist match let in'), ('watch_add', 'Added to the watchlist'), ('watch_remove', 'Removed from the watchlist'), ('delivery_in', 'Parcel received'), ('delivery_out', 'Parcel handed over'), ('delivery_return', 'Parcel returned'), ('contractor_pass', 'Contractor pass made'), ('contractor_in', 'Contractor in'), ('contractor_out', 'Contractor out'), ('contractor_revoke', 'Contractor pass revoked'), ('material_request', 'Material pass asked'), ('material_decide', 'Material pass decided'), ('material_gate', 'Material passed the gate'), ('material_return', 'Material returned'), ('patrol', 'Patrol checkpoint scanned'), ('checkpoint', 'Patrol checkpoints changed'), ('incident', 'Incident reported'), ('incident_close', 'Incident closed'), ('id_scan', 'ID card read'), ('code_approve', 'Check-in code approved'), ('code_miss', 'Wrong code entered'), ('host_answer', 'Host said where to wait'), ('sent_to_place', 'Visitor sent to the waiting place'), ('checkout_request', 'Check-out asked from the phone'), ('checkout_approve', 'Check-out approved'), ('checkout_hold', 'Check-out held'), ('settings', 'Visitor settings changed'), ('link', 'Visitor QR link changed')], db_index=True, max_length=20),
        ),
    ]
