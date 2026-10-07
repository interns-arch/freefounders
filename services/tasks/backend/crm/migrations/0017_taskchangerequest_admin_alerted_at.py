# Reconstructed: applied to production but never committed. The name matches
# the row already in django_migrations, so it is a no-op on that database
# while a fresh one still gets the column.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0016_taskcompletion'),
    ]

    operations = [
        migrations.AddField(
            model_name='taskchangerequest',
            name='admin_alerted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
