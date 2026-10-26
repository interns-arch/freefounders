"""Catalogue version 3 (PLAN.md §22): the Visitors permissions for the roles that exist.

Admin-level roles get the gate, the register and the settings; every role with Tasks permissions gets "My visitors".
Only the version-3 rules apply (accounts.access.upgrade_grants from version 2). In multi-company mode the Platform
pushes its own copy of the roles, upgraded with the same rules.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    from accounts.access import upgrade_grants

    AccessRole = apps.get_model("accounts", "AccessRole")
    AccessGrant = apps.get_model("accounts", "AccessGrant")
    for role in AccessRole.objects.all():
        have = dict(AccessGrant.objects.filter(role=role).values_list("permission", "scope"))
        new = upgrade_grants(have, role.level or 1, from_version=2)
        for permission, scope in new.items():
            if permission not in have:
                AccessGrant.objects.create(role=role, permission=permission, scope=scope)


class Migration(migrations.Migration):
    dependencies = [("visitors", "0001_initial"), ("accounts", "0023_user_role_member")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
