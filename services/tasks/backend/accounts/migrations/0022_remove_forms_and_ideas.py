"""Web forms and the Idea board are gone (the founder's request, PLAN.md §19.23, 2026-10-13).

- The `webforms` app was taken out of INSTALLED_APPS, and removing an app does not drop its tables: they are dropped
  here (in every company schema too: migrate_companies runs this in each one, and an unqualified name is the schema
  in use). A database that never had them is fine (IF EXISTS). Its django_migrations rows go with them, so the app
  could come back one day with a clean slate.
- The Idea board's tables are dropped by workspace 0002.
- The content types of both (and the Django permissions / admin log entries hanging off them) are removed.
- Roles lose the grants of the removed permissions (forms.view, forms.build, forms.all, ideas.view, ideas.review).
  They would be ignored anyway (no longer in the catalogue), this just keeps the table clean.

Not reversible: the data is deleted on purpose.
"""
from django.db import migrations

WEBFORMS_TABLES = ("webforms_submissionfile", "webforms_formsubmission", "webforms_formfield", "webforms_form")
REMOVED_PERMISSIONS = ("forms.view", "forms.build", "forms.all", "ideas.view", "ideas.review")


def forwards(apps, schema_editor):
    cascade = " CASCADE" if schema_editor.connection.vendor == "postgresql" else ""
    for table in WEBFORMS_TABLES:  # children first (SQLite has no CASCADE)
        schema_editor.execute(f"DROP TABLE IF EXISTS {schema_editor.quote_name(table)}{cascade}")
    schema_editor.execute("DELETE FROM django_migrations WHERE app = %s", ["webforms"])

    ContentType = apps.get_model("contenttypes", "ContentType")
    ContentType.objects.filter(app_label="webforms").delete()
    ContentType.objects.filter(app_label="workspace", model__in=["idea", "ideacomment"]).delete()

    AccessGrant = apps.get_model("accounts", "AccessGrant")
    AccessGrant.objects.filter(permission__in=REMOVED_PERMISSIONS).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0021_fine_grained_permissions"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("admin", "0003_logentry_add_action_flag_choices"),
        ("workspace", "0002_remove_idea_board"),
    ]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
