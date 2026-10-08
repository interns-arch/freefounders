import uuid

from django.core.management.base import BaseCommand, CommandError

from tenancy import schemas


class Command(BaseCommand):
    help = "Create (or update) a company's schema in multi-company mode: company_create <company-id> <code> <name>"

    def add_arguments(self, parser):
        parser.add_argument("company_id")
        parser.add_argument("code")
        parser.add_argument("name")

    def handle(self, company_id, code, name, **opts):
        if not schemas.enabled():
            raise CommandError("Multi-company mode is off: set TENANCY=schemas and a postgres DATABASE_URL")
        try:
            company_id = str(uuid.UUID(company_id))
            schema = schemas.schema_for_code(code)
        except ValueError as exc:
            raise CommandError(str(exc))
        created = schemas.create_company(company_id, schema, name, verbosity=max(0, opts["verbosity"] - 1))
        self.stdout.write(self.style.SUCCESS(f"{'Created' if created else 'Updated'} {name} ({schema})"))
