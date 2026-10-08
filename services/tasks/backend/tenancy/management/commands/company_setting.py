from django.core.management.base import BaseCommand, CommandError

from tenancy import schemas
from tenancy.company_settings import set_value


class Command(BaseCommand):
    help = "Set a company's own value for a setting: company_setting <code> <NAME> <value> (blank value = use the env var)"

    def add_arguments(self, parser):
        parser.add_argument("code")
        parser.add_argument("name")
        parser.add_argument("value", nargs="?", default="")

    def handle(self, code, name, value, **opts):
        if not schemas.enabled():
            raise CommandError("Multi-company mode is off: set TENANCY=schemas and a postgres DATABASE_URL")
        schema = schemas.schema_for_code(code)
        if schema not in {c["schema"] for c in schemas.companies()}:
            raise CommandError(f"No company with code {code}")
        with schemas.use(schema):
            set_value(name.strip().upper(), value)
        self.stdout.write(self.style.SUCCESS(f"{name} set for {schema}"))
