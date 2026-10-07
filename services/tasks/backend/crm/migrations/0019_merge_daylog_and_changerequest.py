# Production applied two parallel lines of work off 0016 -- the change-request
# alerting pair and the day-log pair -- leaving the crm app with two leaf
# migrations. Django refuses to run with an ambiguous leaf, so this joins them.
# It has no operations: nothing to do but record that the graph is linear again.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('crm', '0018_alter_taskchangerequest_status'),
        ('crm', '0018_taskdaylog'),
    ]

    operations = []
