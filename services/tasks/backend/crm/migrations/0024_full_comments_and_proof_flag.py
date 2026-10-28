# Port of the original's 0021_full_comments_and_proof_flag (d86d62b, PLAN.md §19.43):
# comments kept whole (up to 5000 characters) and completion proof flagged on its file.

import os

from django.db import migrations, models


PREFIX = "Completion proof attached: "


def mark_existing_proof(apps, schema_editor):
    """Files sent as completion proof were logged as such -- flag them, so
    only reference files travel to the next copy of a recurring task. The log
    keeps the name as sent; a photo may since have been stored as a smaller
    JPEG (config/images.py), so the name is matched without its extension."""
    Activity = apps.get_model("crm", "TaskActivity")
    Attachment = apps.get_model("crm", "TaskAttachment")
    for a in Activity.objects.filter(text__startswith=PREFIX).only("task_id", "text"):
        name = a.text[len(PREFIX):]
        stem = os.path.splitext(name)[0]
        Attachment.objects.filter(
            models.Q(filename__startswith=name) | models.Q(filename__startswith=stem + "."),
            task_id=a.task_id).update(is_proof=True)


class Migration(migrations.Migration):

    dependencies = [
        ("crm", "0023_changerequest_old_due_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="taskattachment",
            name="is_proof",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name="taskactivity",
            name="text",
            field=models.TextField(max_length=5000),
        ),
        migrations.RunPython(mark_existing_proof, migrations.RunPython.noop),
    ]
