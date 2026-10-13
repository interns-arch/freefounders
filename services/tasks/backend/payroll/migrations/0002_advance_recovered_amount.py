from django.db import migrations, models
from django.db.models import F


def settled_advances_are_fully_recovered(apps, schema_editor):
    """Advances marked recovered before this field existed were recovered in full."""
    Advance = apps.get_model("payroll", "Advance")
    Advance.objects.filter(recovered=True).update(recovered_amount=F("amount"))


class Migration(migrations.Migration):

    dependencies = [
        ("payroll", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="advance",
            name="recovered_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.RunPython(settled_advances_are_fully_recovered, migrations.RunPython.noop),
    ]
