from django.core.management.base import BaseCommand

from crm.reminders import send_followup_reminders


class Command(BaseCommand):
    help = ("Send the automated reminders and digests. Sends nothing on a "
            "non-working day (HR_WEEK_OFF_DAYS + the Holiday calendar) "
            "unless --force is given.")

    def add_arguments(self, parser):
        parser.add_argument(
            "--force", action="store_true",
            help="Send even on a Sunday or a declared holiday.")

    def handle(self, *args, **opts):
        sent = send_followup_reminders(force=opts["force"])
        self.stdout.write(self.style.SUCCESS(f"Sent {sent} follow-up reminder(s)."))
