# Regularization added directly by HR / a manager (PLAN.md §19.38 addendum, 2026-10-24).

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0011_attendance_reminder_log'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='attendancecorrection',
            name='added_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name='added_regularizations', to=settings.AUTH_USER_MODEL),
        ),
    ]
