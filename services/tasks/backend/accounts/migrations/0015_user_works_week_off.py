# Reconstructed to match a migration that was applied to the production
# database but whose source was never committed. The name here is deliberately
# identical to the row already recorded in django_migrations, so Django treats
# it as applied on the existing database (no data is touched) while a fresh
# database still gets the column.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0014_alter_user_role'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='works_week_off',
            field=models.BooleanField(default=False, help_text='Works on the weekly off day -- used by HR for comp-off accrual.'),
        ),
    ]
