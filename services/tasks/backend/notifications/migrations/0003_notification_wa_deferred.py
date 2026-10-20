from django.db import migrations, models


class Migration(migrations.Migration):
    """WhatsApp only inside the company's hours (original app d40034c): a held message waits here."""

    dependencies = [
        ('notifications', '0002_whatsappdelivery'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='wa_deferred',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
