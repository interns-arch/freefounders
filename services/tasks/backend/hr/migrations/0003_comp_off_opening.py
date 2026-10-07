# Reconstructed: applied to production but never committed.
#
# The original seeded opening comp-off balances seeded from an HR spreadsheet
# (25 rows, all source="opening", note "Opening balance from the HR sheet
# (Sundays worked)"). That data is specific to one company's history and is
# already present in the production database, so there is nothing to replay --
# reproducing it here would be inventing numbers.
#
# The migration exists so the graph matches the name already recorded in
# django_migrations. On a fresh database it correctly seeds nothing: a new
# deployment has no prior balances to carry over.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0002_leavetype_is_comp_off_compoff'),
    ]

    operations = []
