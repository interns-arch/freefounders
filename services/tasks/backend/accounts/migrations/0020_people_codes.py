# Employee code and designation from the Platform's People directory (PLAN.md §19.15).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0019_role_duties'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='employee_code',
            field=models.CharField(blank=True, db_index=True, default='', max_length=40),
        ),
        migrations.AddField(
            model_name='user',
            name='designation',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
    ]
