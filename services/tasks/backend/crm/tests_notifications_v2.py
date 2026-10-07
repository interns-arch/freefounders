"""WhatsApp-automation groundwork: full-detail assignment ping (A),
completion fan-out to everyone involved (B), 2-hourly overdue re-pings and
the morning daily digest (C). Channels stay inert in tests — we assert the
notification rows that WhatsApp/Gmail will carry once credentials are live."""
import os
from datetime import datetime, timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import Role, User

from notifications.models import Notification

from .models import Task, TaskStatus
from .reminders import REMIND_EVERY_HOURS, send_daily_task_digest, send_task_reminders
from .tests_task_engine import Base


class AssignmentDetailTests(Base):
    def test_assignment_ping_carries_all_details(self):
        self.create_task(self.manager, self.rahul, title="Call Ravi",
                         description="revised quote", priority="high",
                         category="Calls", effort_minutes=45,
                         due_at=(timezone.now() + timedelta(days=1)).isoformat())
        n = Notification.objects.get(user=self.rahul, type="task_assigned")
        for piece in ("T-", "revised quote", "Effort: 45m", "Priority: High",
                      "Category: Calls", "Due:", "Assigned by: "):
            self.assertIn(piece, n.body)


class CompletionFanoutTests(Base):
    def test_completion_notifies_creator_and_followers_not_actor(self):
        res = self.create_task(self.manager, self.rahul, effort_minutes=30,
                               in_loop=[self.amit.id])
        task_id = res.data["id"]
        self.as_(self.rahul)
        self.client.post(f"/api/tasks/{task_id}/complete/",
                         {"remarks": "sab ho gaya", "actual_minutes": 40}, format="json")
        for user in (self.manager, self.amit):        # creator + in-loop
            n = Notification.objects.get(user=user, type="task_completed")
            self.assertIn("took 40m", n.body)
            self.assertIn("(assigned 30m)", n.body)
            self.assertIn("sab ho gaya", n.body)
        self.assertFalse(Notification.objects.filter(       # never the actor
            user=self.rahul, type="task_completed").exists())

    def test_admin_closing_someone_elses_task_notifies_the_assignee(self):
        task = Task.objects.create(title="X", assigned_to=self.rahul,
                                   created_by=self.manager)
        self.as_(self.admin)
        self.client.post(f"/api/tasks/{task.id}/complete/",
                         {"remarks": "closed by admin", "actual_minutes": 5},
                         format="json")
        self.assertTrue(Notification.objects.filter(
            user=self.rahul, type="task_completed").exists())


class OverdueRepingTests(Base):
    def test_overdue_repings_every_two_hours(self):
        task = Task.objects.create(title="Late", assigned_to=self.rahul,
                                   due_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(send_task_reminders(), 1)
        self.assertEqual(send_task_reminders(), 0)          # inside the window
        Task.objects.filter(pk=task.pk).update(
            reminded_at=timezone.now() - timedelta(hours=REMIND_EVERY_HOURS, minutes=1))
        self.assertEqual(send_task_reminders(), 1)          # 2h later -> again
        n = Notification.objects.filter(user=self.rahul, type="task_due").latest("id")
        self.assertIn("OVERDUE", n.body)


class DailyDigestTests(Base):
    def test_one_morning_digest_per_person(self):
        now = timezone.now()
        Task.objects.create(title="Overdue one", assigned_to=self.rahul,
                            due_at=now - timedelta(hours=3))
        Task.objects.create(title="Open no due", assigned_to=self.rahul)
        self.assertEqual(send_daily_task_digest(force=True), 1)
        self.assertEqual(send_daily_task_digest(force=True), 0)   # date guard
        n = Notification.objects.get(user=self.rahul, type="task_daily")
        self.assertIn("1 overdue", n.title)
        self.assertIn("2 open", n.title)
        self.assertIn("Overdue one", n.body)


class DelegatedInDigestTests(TestCase):
    """Founders Desk, 05 Sep: the daily summaries covered your OWN work only.
    Anyone who hands work out also needs to know what happened to it."""

    def setUp(self):
        for flag in ("WHATSAPP_ENABLED", "GMAIL_ENABLED"):
            os.environ[flag] = "false"
        self.boss = User.objects.create_user("dig.boss", "b@x.com", "pass@12345",
                                             role=Role.SALES_MANAGER, department="sales")
        self.emp = User.objects.create_user("dig.emp", "e@x.com", "pass@12345",
                                            role=Role.SALES_EXECUTIVE, department="sales")

    def snap(self, since=None):
        from crm.reminders import delegated_snapshot
        return delegated_snapshot(self.boss, timezone.now(), since)

    def give(self, **kw):
        return Task.objects.create(title=kw.pop("title", "Given"), assigned_to=self.emp,
                                   created_by=self.boss, **kw)

    def test_it_counts_what_i_gave_out(self):
        self.give(due_at=timezone.now() + timedelta(days=1))
        self.give(due_at=timezone.now() - timedelta(days=1))          # overdue
        s = self.snap()
        self.assertEqual(len(s["open"]), 2)
        self.assertEqual(len(s["overdue"]), 1)

    def test_my_own_tasks_are_not_counted_here(self):
        """They are the other half of the same message -- counting them twice
        would double every number a manager reads."""
        Task.objects.create(title="Mine", assigned_to=self.boss, created_by=self.boss,
                            due_at=timezone.now() - timedelta(days=1))
        self.assertEqual(len(self.snap()["open"]), 0)

    def test_completed_work_shows_up(self):
        now = timezone.now()
        self.give(due_at=now - timedelta(days=1), status=TaskStatus.DONE, completed_at=now)
        self.assertEqual(len(self.snap()["done"]), 1)

    def test_the_evening_only_counts_what_closed_today(self):
        now = timezone.now()
        self.give(title="Old", due_at=now - timedelta(days=9),
                  status=TaskStatus.DONE, completed_at=now - timedelta(days=8))
        self.give(title="Today", due_at=now, status=TaskStatus.DONE, completed_at=now)
        today = timezone.localtime(now).date()
        self.assertEqual(len(self.snap(today)["done"]), 1)
        self.assertEqual(len(self.snap()["done"]), 2)        # morning: all of them

    def test_somebody_who_gave_nothing_gets_no_section(self):
        """An empty heading is noise in a message people skim on a phone."""
        from crm.reminders import delegated_lines
        self.assertEqual(delegated_lines(self.snap(), "Closed today"), [])

    def test_the_section_names_who_is_sitting_on_what(self):
        from crm.reminders import delegated_lines
        self.give(title="Chase Ravi", due_at=timezone.now() - timedelta(days=2))
        text = "\n".join(delegated_lines(self.snap(), "Closed today"))
        self.assertIn("Work you gave others", text)
        self.assertIn("Chase Ravi", text)
        self.assertIn("dig.emp", text)

    def test_the_morning_digest_carries_it(self):
        from crm.reminders import send_daily_task_digest
        from notifications.models import Notification
        self.give(title="Chase Ravi", due_at=timezone.now() - timedelta(days=2))
        Task.objects.create(title="My own", assigned_to=self.boss, created_by=self.emp,
                            due_at=timezone.now() + timedelta(hours=2))
        send_daily_task_digest(force=True)
        n = Notification.objects.get(user=self.boss, type="task_daily")
        self.assertIn("Work you gave others", n.body)
        self.assertIn("Chase Ravi", n.body)


class NoDigestOnADayOffTests(TestCase):
    """The daily summaries were going out on Sundays too.

    Which days are off is already decided once, for attendance:
    HR_WEEK_OFF_DAYS plus the Holiday calendar. The digests read the same
    answer, so changing the week-off moves the messages with it.
    """

    def setUp(self):
        for flag in ("WHATSAPP_ENABLED", "GMAIL_ENABLED"):
            os.environ[flag] = "false"
        self.who = User.objects.create_user("off.emp", "o@x.com", "pass@12345",
                                            role=Role.SALES_EXECUTIVE, department="sales")
        self.boss = User.objects.create_user("off.boss", "ob@x.com", "pass@12345",
                                             role=Role.SALES_MANAGER, department="sales")
        Task.objects.create(title="Something open", assigned_to=self.who,
                            created_by=self.boss,
                            due_at=timezone.now() + timedelta(hours=3))

    def on(self, when, fn):
        """Run a digest as if today were `when`."""
        from unittest import mock
        from notifications.models import Notification
        Notification.objects.all().delete()
        with mock.patch("django.utils.timezone.localtime", return_value=when):
            fn()
        return Notification.objects.count()

    # 07 Sep 2026 is a Sunday; 08 Sep is the Monday after it
    SUNDAY = datetime(2026, 9, 6, 10, 0)      # Sunday
    MONDAY = datetime(2026, 9, 7, 10, 0)      # Monday
    SUN_EVE = datetime(2026, 9, 6, 20, 0)
    MON_EVE = datetime(2026, 9, 7, 20, 0)

    def test_sunday_is_actually_a_sunday(self):
        """If this ever fails the dates below stopped meaning what they say."""
        self.assertEqual(self.SUNDAY.weekday(), 6)
        self.assertEqual(self.MONDAY.weekday(), 0)

    def test_no_morning_digest_on_sunday(self):
        from crm.reminders import send_daily_task_digest
        self.assertEqual(self.on(timezone.make_aware(self.SUNDAY), send_daily_task_digest), 0)

    def test_morning_digest_still_goes_on_monday(self):
        from crm.reminders import send_daily_task_digest
        self.assertGreater(self.on(timezone.make_aware(self.MONDAY), send_daily_task_digest), 0)

    def test_no_evening_digest_on_sunday(self):
        from crm.reminders import send_day_end_digest
        self.assertEqual(self.on(timezone.make_aware(self.SUN_EVE), send_day_end_digest), 0)

    def test_evening_digest_still_goes_on_monday(self):
        from crm.reminders import send_day_end_digest
        self.assertGreater(self.on(timezone.make_aware(self.MON_EVE), send_day_end_digest), 0)

    def test_a_declared_holiday_is_quiet_too(self):
        """Diwali is not a working day either, and HR already knows the date."""
        from crm.models import Holiday
        from crm.reminders import send_daily_task_digest
        Holiday.objects.create(name="Diwali", date=self.MONDAY.date())
        self.assertEqual(self.on(timezone.make_aware(self.MONDAY), send_daily_task_digest), 0)

    def test_forcing_it_by_hand_still_works(self):
        """How the digests are tested, and how they can be fired manually."""
        from crm.reminders import send_daily_task_digest
        from notifications.models import Notification
        Notification.objects.all().delete()
        send_daily_task_digest(force=True)
        self.assertGreater(Notification.objects.count(), 0)

    def test_the_week_off_comes_from_the_hr_setting(self):
        """Move the week-off to Monday and the digests move with it."""
        from crm.reminders import is_working_day
        os.environ["HR_WEEK_OFF_DAYS"] = "0"          # Monday
        try:
            from hr.services import cfg
            cfg.cache_clear() if hasattr(cfg, "cache_clear") else None
            self.assertFalse(is_working_day(self.MONDAY.date()))
            self.assertTrue(is_working_day(self.SUNDAY.date()))
        finally:
            os.environ["HR_WEEK_OFF_DAYS"] = "6"


class EverythingQuietOnADayOffTests(TestCase):
    """"Sunday aur holiday pe sab band" -- everything, not just the digests.

    Guarding senders one at a time leaves the next one somebody writes
    unguarded, so the check sits on the ticker: the single door every
    automated message goes out through.
    """

    SUNDAY = datetime(2026, 9, 6, 11, 0)
    MONDAY = datetime(2026, 9, 7, 11, 0)

    def setUp(self):
        for flag in ("WHATSAPP_ENABLED", "GMAIL_ENABLED"):
            os.environ[flag] = "false"
        self.who = User.objects.create_user("q.emp", "q@x.com", "pass@12345",
                                            role=Role.SALES_EXECUTIVE, department="sales")
        self.boss = User.objects.create_user("q.boss", "qb@x.com", "pass@12345",
                                             role=Role.SALES_MANAGER, department="sales")
        # Overdue two days before the FIXED Sunday this test pretends it is
        # -- not before the real today, or the task stops being overdue as
        # soon as the calendar moves past it.
        Task.objects.create(title="Late thing", assigned_to=self.who, created_by=self.boss,
                            due_at=timezone.make_aware(self.SUNDAY) - timedelta(days=2))

    def tick(self, when):
        from unittest import mock
        from crm.reminders import send_followup_reminders
        from notifications.models import Notification
        Notification.objects.all().delete()
        aware = timezone.make_aware(when)
        with mock.patch("django.utils.timezone.localtime", return_value=aware), \
             mock.patch("django.utils.timezone.now", return_value=aware):
            send_followup_reminders()
        return Notification.objects.count()

    def test_nothing_at_all_goes_out_on_sunday(self):
        self.assertEqual(self.tick(self.SUNDAY), 0)

    def test_the_overdue_reping_returns_on_monday(self):
        """Whatever was overdue on Sunday is still overdue on Monday."""
        self.assertGreater(self.tick(self.MONDAY), 0)

    def test_nothing_goes_out_on_a_declared_holiday(self):
        from crm.models import Holiday
        Holiday.objects.create(name="Diwali", date=self.MONDAY.date())
        self.assertEqual(self.tick(self.MONDAY), 0)

    def test_housekeeping_still_runs_on_a_day_off(self):
        """Deleting an expired attachment disturbs nobody, and skipping it
        would only pile a day's work up."""
        from unittest import mock
        from crm.reminders import send_followup_reminders
        aware = timezone.make_aware(self.SUNDAY)
        with mock.patch("django.utils.timezone.localtime", return_value=aware), \
             mock.patch("django.utils.timezone.now", return_value=aware), \
             mock.patch("crm.reminders.purge_expired_attachments") as purge:
            send_followup_reminders()
        purge.assert_called_once()

    def test_force_sends_anyway(self):
        """So it can still be fired by hand: manage.py send_reminders --force"""
        from unittest import mock
        from crm.reminders import send_followup_reminders
        from notifications.models import Notification
        Notification.objects.all().delete()
        aware = timezone.make_aware(self.SUNDAY)
        with mock.patch("django.utils.timezone.localtime", return_value=aware), \
             mock.patch("django.utils.timezone.now", return_value=aware):
            send_followup_reminders(force=True)
        self.assertGreater(Notification.objects.count(), 0)
