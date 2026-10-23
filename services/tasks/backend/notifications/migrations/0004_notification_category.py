# Notifications grouped by area + links to the item (PLAN.md §19.37).
# Adds Notification.category and fills it for the rows already there (from the type), and points the old links that
# opened only a list at the right screen where the row says enough: approvals → Attendance → Approvals, a leave
# decision → My leave, the task digests → My tasks.

from django.conf import settings
from django.db import migrations, models

APPROVAL_TYPES = {
    "leave_request", "correction_request", "approval_reminder", "approval_escalated",
    "task_change_request", "task_completion_review", "task_completion_reminder",
}
ATTENDANCE_PREFIXES = ("attendance", "leave", "correction", "payslip", "payroll", "salary", "punch", "hr_")
COMPANY_PREFIXES = ("notice", "billing", "plan_", "system", "company")


def _category(type_, link):
    t = (type_ or "").lower()
    if t in APPROVAL_TYPES or (t == "category_request" and link == "/settings"):
        return "approvals"
    if t.startswith(ATTENDANCE_PREFIXES):
        return "attendance"
    if t.startswith(COMPANY_PREFIXES):
        return "company"
    return "tasks"


def backfill(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    # Group by (type, link) so a big table is a handful of UPDATEs, not one per row.
    pairs = Notification.objects.order_by().values_list("type", "link").distinct()
    for type_, link in pairs:
        Notification.objects.filter(type=type_, link=link).update(category=_category(type_, link))
    Notification.objects.filter(link="/hr", type__in=["leave_request", "correction_request", "approval_reminder",
                                                      "approval_escalated"]).update(link="/hr?tab=approvals")
    Notification.objects.filter(link="/hr", type="leave_reviewed").update(link="/hr?tab=leave")
    Notification.objects.filter(link="/tasks", type__in=["task_daily", "task_day_end", "task_overdue_weekly",
                                                         "task_completion_accepted", "category_request"]
                                ).update(link="/tasks?tab=my")


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0003_notification_wa_deferred'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='category',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(fields=['user', 'category', 'read_at'], name='notif_user_cat_read'),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
