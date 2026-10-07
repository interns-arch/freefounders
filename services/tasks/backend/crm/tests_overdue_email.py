"""Monday email to everyone: overdue tasks (or "pipeline is clear") plus
their performance for the month. Gmail stays inert in tests -- we assert
the notification row the email is recorded on."""
import os
from datetime import datetime, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from notifications.models import Notification

from .models import Holiday, Task, TaskStatus
from .reminders import send_weekly_overdue_email

MONDAY = timezone.make_aware(datetime(2026, 9, 7, 11, 0))
MONDAY_EARLY = timezone.make_aware(datetime(2026, 9, 7, 9, 30))
TUESDAY = timezone.make_aware(datetime(2026, 9, 8, 11, 0))


class OverdueEmailTests(TestCase):
    def setUp(self):
        for flag in ("WHATSAPP_ENABLED", "GMAIL_ENABLED"):
            os.environ[flag] = "false"
        self.boss = User.objects.create_user("oe.boss", "b@x.com", "pass@12345",
                                             role=Role.ADMIN, department="management")
        self.emp = User.objects.create_user("oe.emp", "e@x.com", "pass@12345",
                                            role=Role.SALES_EXECUTIVE, department="sales")
        self.late = Task.objects.create(title="Send quote", assigned_to=self.emp,
                                        created_by=self.boss,
                                        due_at=MONDAY - timedelta(days=3))
        Task.objects.create(title="Not yet due", assigned_to=self.emp,
                            created_by=self.boss, due_at=MONDAY + timedelta(days=2))
        Task.objects.create(title="Done late", assigned_to=self.emp, created_by=self.boss,
                            status=TaskStatus.DONE, due_at=MONDAY - timedelta(days=5))

    def run_at(self, when, force=False, status="sent"):
        real = timezone.localtime       # fake "now" only; real due dates still convert
        fake = lambda value=None, *a, **k: when if value is None else real(value, *a, **k)
        result = {"channel": "gmail", "status": status, "detail": ""}
        with (mock.patch("django.utils.timezone.localtime", side_effect=fake),
              mock.patch("notifications.channels.gmail.send_email", return_value=result)):
            return send_weekly_overdue_email(force=force)

    def mails(self):
        return Notification.objects.filter(type="task_overdue_weekly")

    def test_monday_mail_lists_only_overdue_tasks_and_score_impact(self):
        self.assertEqual(self.run_at(MONDAY), 2)
        n = self.mails().get(user=self.emp)
        self.assertIn(self.late.code, n.body)
        self.assertIn("3 day(s) overdue", n.body)
        self.assertIn("MISSED deadline", n.body)
        self.assertNotIn("Not yet due", n.body)
        self.assertNotIn("Done late", n.body)
        self.assertIn("Score this month", n.body)
        self.assertEqual(n.channels[0]["channel"], "gmail")

    def test_people_with_nothing_overdue_hear_their_pipeline_is_clear(self):
        self.run_at(MONDAY)
        n = self.mails().get(user=self.boss)
        self.assertIn("pipeline is clear", n.title)
        self.assertIn("Your pipeline is clear", n.body)
        self.assertIn("Score this month", n.body)
        self.assertNotIn("MISSED", n.body)

    def test_inactive_and_address_less_people_are_skipped(self):
        User.objects.create_user("oe.gone", "g@x.com", "pass@12345", is_active=False)
        User.objects.create_user("oe.nomail", "", "pass@12345")
        self.assertEqual(self.run_at(MONDAY), 2)

    def test_once_a_week_however_often_the_ticker_runs(self):
        self.run_at(MONDAY)
        self.run_at(MONDAY)
        self.run_at(TUESDAY)
        self.assertEqual(self.mails().count(), 2)

    def test_not_before_ten_and_not_midweek(self):
        self.assertEqual(self.run_at(MONDAY_EARLY), 0)
        self.assertEqual(self.run_at(TUESDAY), 0)

    def test_holiday_monday_moves_it_to_tuesday(self):
        Holiday.objects.create(name="Festival", date=MONDAY.date())
        self.assertEqual(self.run_at(MONDAY), 0)
        self.assertEqual(self.run_at(TUESDAY), 2)

    def test_send_now_works_midweek_but_only_once_a_day(self):
        self.assertEqual(self.run_at(TUESDAY, force=True), 2)
        self.assertEqual(self.run_at(TUESDAY, force=True), 0)

    def test_failed_mail_blocks_the_ticker_but_send_now_retries_it(self):
        self.assertEqual(self.run_at(MONDAY, status="error"), 0)
        self.assertEqual(self.run_at(MONDAY), 0)            # no 5-minutely retries
        self.assertEqual(self.run_at(MONDAY, force=True), 2)
        self.assertEqual(self.mails().count(), 2)           # failed rows replaced
        self.assertEqual(self.run_at(MONDAY, force=True), 0)

    def test_send_now_endpoint_is_admin_only(self):
        client = APIClient()
        for user, code in ((self.emp, 403), (self.boss, 200)):
            res = client.post("/api/auth/login",
                              {"username": user.username, "password": "pass@12345"})
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
            self.assertEqual(
                client.post("/api/tasks/send_overdue_email/").status_code, code)
        self.assertTrue(self.mails().filter(user=self.emp).exists())
