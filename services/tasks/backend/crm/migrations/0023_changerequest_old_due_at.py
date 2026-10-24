# Task chains / change-request ranking (PLAN.md §19.41): keep the due date a request wanted to move.

from django.db import migrations, models


def backfill(apps, schema_editor):
    """Pending requests: the task still holds the old date, so it can be kept now."""
    Req = apps.get_model("crm", "TaskChangeRequest")
    for r in Req.objects.filter(status="pending", old_due_at__isnull=True).select_related("task"):
        if "due_at" in (r.changes or {}) and r.task.due_at:
            Req.objects.filter(pk=r.pk).update(old_due_at=r.task.due_at)


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0022_ff_links_outbox'),
    ]

    operations = [
        migrations.AddField(
            model_name='taskchangerequest',
            name='old_due_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
