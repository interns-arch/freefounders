# Reconstructed: applied to production but never committed. Adds the "closed"
# choice, which 13 live rows already use.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0017_taskchangerequest_admin_alerted_at'),
    ]

    operations = [
        migrations.AlterField(
            model_name='taskchangerequest',
            name='status',
            field=models.CharField(
                choices=[('pending', 'Pending'), ('approved', 'Approved'),
                         ('rejected', 'Rejected'), ('closed', 'Closed')],
                default='pending', max_length=10),
        ),
    ]
