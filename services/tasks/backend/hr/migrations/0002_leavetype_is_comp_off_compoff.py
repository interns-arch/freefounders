# Reconstructed: applied to production but never committed. The name matches
# the row already in django_migrations, so it is a no-op on that database
# while a fresh one gets both the column and the table.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='leavetype',
            name='is_comp_off',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='CompOff',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField()),
                ('days', models.DecimalField(decimal_places=1, default=1, max_digits=3)),
                ('source', models.CharField(choices=[('opening', 'Opening balance'), ('worked', 'Worked a week off'), ('manual', 'Added by HR')], default='worked', max_length=12)),
                ('note', models.CharField(blank=True, default='', max_length=300)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='comp_offs_created', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comp_offs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-date'],
                'constraints': [models.UniqueConstraint(fields=('user', 'date'), name='one_comp_off_per_day')],
            },
        ),
    ]
