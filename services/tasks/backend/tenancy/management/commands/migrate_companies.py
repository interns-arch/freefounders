from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from tenancy import schemas


class Command(BaseCommand):
    help = "Deploy step in multi-company mode: migrate public, then every company's schema."

    def handle(self, **opts):
        if not schemas.enabled():
            raise CommandError("Multi-company mode is off: set TENANCY=schemas and a postgres DATABASE_URL")
        verbosity = opts["verbosity"]
        call_command("migrate", interactive=False, verbosity=verbosity)
        schemas.ensure_registry()
        done = schemas.migrate_all(verbosity=verbosity, stdout=self.stdout)
        self.stdout.write(self.style.SUCCESS(f"Migrated {len(done)} compan{'y' if len(done) == 1 else 'ies'}"))
