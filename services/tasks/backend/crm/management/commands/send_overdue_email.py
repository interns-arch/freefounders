from django.core.management.base import BaseCommand

from crm.reminders import send_weekly_overdue_email


class Command(BaseCommand):
    help = ("Email every active person their overdue tasks (or 'pipeline is "
            "clear') and their performance. Runs "
            "automatically on Monday mornings; use this to send it right now. "
            "At most once per person per day.")

    def handle(self, *args, **opts):
        sent = send_weekly_overdue_email(force=True)
        self.stdout.write(self.style.SUCCESS(f"Sent {sent} overdue email(s)."))
