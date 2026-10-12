"""Every feature is its own permission (PLAN.md §19.19, catalogue version 2).

Each role keeps exactly what it could do: the fine-grained permissions it had through a broader one are added
(e.g. hr.manage -> payroll, HR settings, import, manual marking, approving for everyone; tasks.assign -> groups,
templates, SOPs, forms, links, ideas; settings.manage -> notices, holidays, task settings; everyone -> punch in,
my attendance, my leave, notices, links, ideas, forms). hr.manage itself is replaced by those. A role with no Tasks
permission at all (a role for another app) is left empty. The rules are frozen in accounts.access (version 2).
"""
from django.db import migrations


def forwards(apps, schema_editor):
    from accounts.access import upgrade_grants

    AccessRole = apps.get_model("accounts", "AccessRole")
    AccessGrant = apps.get_model("accounts", "AccessGrant")
    for role in AccessRole.objects.all():
        have = dict(AccessGrant.objects.filter(role=role).values_list("permission", "scope"))
        new = upgrade_grants(have, role.level or 1, from_version=1)
        if new == have:
            continue
        AccessGrant.objects.filter(role=role).exclude(permission__in=list(new)).delete()
        for permission, scope in new.items():
            if have.get(permission) != scope:
                AccessGrant.objects.update_or_create(role=role, permission=permission, defaults={"scope": scope})


class Migration(migrations.Migration):
    dependencies = [("accounts", "0020_people_codes")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
