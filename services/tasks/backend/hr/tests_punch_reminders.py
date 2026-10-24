"""Punch-in reminders from the server (PLAN.md §19.39): reminder 1 at reporting time + 30 min, 2 at + 60, 3 at + 90 to
people who have not punched in; nothing before, no 4th, nothing after a punch-in, on leave / holiday / weekly off, for
inactive people or people whose attendance is not tracked; the company settings; never twice (restarts, re-runs); a
worker that was down catches up with one reminder, not a burst."""
import os
from datetime import date, datetime, timedelta
from unittest import mock

from django.utils import timezone

from crm.models import Holiday
from notifications.models import Notification
from notifications import rules
from tenancy.company_settings import forget

from . import punch_reminders
from .models import Attendance, AttendanceReminderLog, AttendanceStatus, LeaveRequest, LeaveStatus, LeaveType
from .punch_reminders import send_punch_reminders
from .tests import Base


def a_monday():
    """A Monday in next year's March (no holidays in the test database)."""
    d = date(timezone.localdate().year + 1, 3, 1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d


DAY = a_monday()


def at(hh, mm=0, day=DAY):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hh, mm), timezone.get_current_timezone())


ENV = {"HR_WORK_START": "09:30", "HR_WORK_END": "18:30", "HR_WEEK_OFF_DAYS": "6",
       "PUNCH_REMINDERS_ENABLED": "", "PUNCH_REMINDER_COUNT": "", "PUNCH_REMINDER_GAP_MINUTES": "",
       "PUNCH_REMINDER_FIRST_MINUTES": ""}


class PunchReminderTests(Base):
    def setUp(self):
        super().setUp()
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        forget()
        # Only Rahul and Amit are active employees here (fewer rows to read in the assertions).
        from accounts.models import User
        User.objects.exclude(pk__in=[self.rahul.pk, self.amit.pk]).update(is_active=False)

    def tearDown(self):
        self.env.stop()
        forget()
        super().tearDown()

    def run_at(self, hh, mm=0, day=DAY):
        return send_punch_reminders(now=at(hh, mm, day))

    def numbers(self, user):
        return list(AttendanceReminderLog.objects.filter(user=user, date=DAY).order_by("n").values_list("n", flat=True))

    def test_due_times_three_reminders_then_none(self):
        self.assertEqual(self.run_at(9, 0), 0, "before the reporting time")
        self.assertEqual(self.run_at(9, 45), 0, "after the reporting time but before + 30 min")
        self.assertEqual(self.run_at(10, 0), 2, "+30: reminder 1 to Rahul and Amit")
        self.assertEqual(self.run_at(10, 5), 0, "the next pass sends nothing new")
        self.assertEqual(self.run_at(10, 29), 0)
        self.assertEqual(self.run_at(10, 30), 2, "+60: reminder 2")
        self.assertEqual(self.run_at(11, 0), 2, "+90: reminder 3")
        self.assertEqual(self.run_at(11, 30), 0, "no 4th")
        self.assertEqual(self.run_at(14, 0), 0)
        self.assertEqual(self.numbers(self.rahul), [1, 2, 3])
        notes = list(Notification.objects.filter(user=self.rahul, type="punch_reminder").order_by("created_at"))
        self.assertEqual(len(notes), 3)
        self.assertEqual(notes[0].title, "Reminder 1 of 3: you have not punched in yet today (reporting time 09:30). "
                                         "Open Automation Task to punch in.")
        self.assertEqual(notes[2].title[:16], "Reminder 3 of 3:")
        self.assertEqual((notes[0].category, notes[0].link), ("attendance", "/hr?tab=today"))
        self.assertNotIn("email", [c.get("channel") for c in notes[0].channels], "no email unless the rule says so")
        log = AttendanceReminderLog.objects.get(user=self.rahul, date=DAY, n=1)
        self.assertEqual(log.channels[0], {"channel": "in_app", "status": "sent", "id": notes[0].id})

    def test_punching_in_stops_the_reminders(self):
        self.run_at(10, 0)
        Attendance.objects.create(user=self.rahul, date=DAY, check_in=at(10, 10), status=AttendanceStatus.LATE)
        self.run_at(10, 30)
        self.run_at(11, 0)
        self.assertEqual(self.numbers(self.rahul), [1])
        self.assertEqual(self.numbers(self.amit), [1, 2, 3])

    def test_leave_holiday_week_off_inactive_and_not_tracked_are_skipped(self):
        lt = LeaveType.objects.create(name="Casual", annual_quota=12)
        LeaveRequest.objects.create(user=self.rahul, leave_type=lt, start_date=DAY, end_date=DAY,
                                    reason="x", status=LeaveStatus.APPROVED)
        self.run_at(10, 0)
        self.assertEqual((self.numbers(self.rahul), self.numbers(self.amit)), ([], [1]), "approved leave")
        # A LEAVE day row (approved leave written to attendance) or a day HR marked absent: skipped too.
        Attendance.objects.create(user=self.amit, date=DAY, status=AttendanceStatus.ABSENT)
        self.run_at(10, 30)
        self.assertEqual(self.numbers(self.amit), [1])

        tue = DAY + timedelta(days=1)
        Holiday.objects.create(name="Festival", date=tue)
        self.assertEqual(self.run_at(10, 0, tue), 0, "holiday")
        sun = DAY + timedelta(days=6)
        self.assertEqual(self.run_at(10, 0, sun), 0, "weekly off (Sunday = 6)")

        wed = DAY + timedelta(days=2)
        self.amit.is_active = False
        self.amit.save(update_fields=["is_active"])
        with mock.patch("accounts.permissions.has_capability", lambda u, cap: False):
            self.assertEqual(self.run_at(10, 0, wed), 0, "Amit inactive, Rahul not tracked (no attendance.punch)")
        self.assertEqual(self.run_at(10, 0, wed), 1, "Rahul again once tracked")

    def test_after_work_end_nothing(self):
        self.assertEqual(self.run_at(18, 45), 0)

    def test_settings_count_gap_first_and_off(self):
        os.environ.update({"PUNCH_REMINDER_COUNT": "2", "PUNCH_REMINDER_GAP_MINUTES": "15",
                           "PUNCH_REMINDER_FIRST_MINUTES": "0"})
        self.assertEqual(self.run_at(9, 29), 0)
        self.assertEqual(self.run_at(9, 30), 2, "first right at the reporting time")
        self.assertEqual(self.run_at(9, 44), 0)
        self.assertEqual(self.run_at(9, 45), 2)
        self.assertEqual(self.run_at(10, 0), 0, "count 2")
        self.assertEqual(Notification.objects.filter(user=self.rahul).first().title[:16], "Reminder 2 of 2:")
        os.environ["PUNCH_REMINDERS_ENABLED"] = "false"
        self.assertEqual(self.run_at(10, 0, DAY + timedelta(days=1)), 0, "switched off")
        # Out-of-range values are clamped (the settings screen refuses them anyway).
        os.environ.update({"PUNCH_REMINDERS_ENABLED": "true", "PUNCH_REMINDER_COUNT": "50", "PUNCH_REMINDER_GAP_MINUTES": "1"})
        r = punch_reminders.rule()
        self.assertEqual((r["count"], r["gap_minutes"]), (10, 5))

    def test_idempotent_across_runs_and_restarts(self):
        self.run_at(10, 0)
        self.run_at(10, 0)
        # A second worker that already decided to send reminder 1 finds the row and skips it.
        self.assertEqual(AttendanceReminderLog.objects.filter(date=DAY).count(), 2)
        self.assertEqual(Notification.objects.filter(type="punch_reminder").count(), 2)
        with mock.patch.object(punch_reminders, "due_number", lambda *a: 1):
            self.assertEqual(self.run_at(10, 30), 0, "the unique row stops a duplicate of reminder 1")
        self.assertEqual(Notification.objects.filter(type="punch_reminder").count(), 2)

    def test_worker_down_catches_up_with_one_not_a_burst(self):
        self.assertEqual(self.run_at(11, 40), 2, "all three windows missed: one reminder each")
        self.assertEqual(self.numbers(self.rahul), [1])
        self.assertEqual(self.run_at(11, 45), 0, "not a burst")
        self.assertEqual(self.run_at(12, 10), 2, "the next one a gap later")
        self.assertEqual(self.run_at(12, 40), 2)
        self.assertEqual(self.run_at(13, 10), 0)
        self.assertEqual(self.numbers(self.rahul), [1, 2, 3])

    def test_due_number_rule(self):
        slots = [at(10), at(10, 30), at(11)]
        self.assertEqual(punch_reminders.due_number(at(9, 59), 0, None, slots, 30), 0)
        self.assertEqual(punch_reminders.due_number(at(10), 0, None, slots, 30), 1)
        self.assertEqual(punch_reminders.due_number(at(10, 30), 1, at(10), slots, 30), 2)
        self.assertEqual(punch_reminders.due_number(at(10, 30), 1, at(10, 10), slots, 30), 0, "gap after the last one")
        self.assertEqual(punch_reminders.due_number(at(15), 3, at(11), slots, 30), 0, "no 4th")

    def test_whatsapp_and_email_follow_the_rule(self):
        self.assertFalse(rules.allows("punch_reminder", "email"))
        self.assertTrue(rules.allows("punch_reminder", "whatsapp"))
        row = {r["key"]: r for r in rules.table()}["punch_reminders"]
        self.assertEqual((row["email"], row["whatsapp"]), (False, True))
        rules.update({"punch_reminders": {"email": True, "whatsapp": False}})
        forget()
        self.assertTrue(rules.allows("punch_reminder", "email"))
        self.assertFalse(rules.allows("punch_reminder", "whatsapp"))

    def test_ticker_runs_the_job(self):
        with mock.patch("hr.punch_reminders.send_punch_reminders", return_value=0) as job:
            from crm.reminders import send_followup_reminders
            send_followup_reminders(force=True)
        job.assert_called_once()


class PunchReminderApiTests(Base):
    def setUp(self):
        super().setUp()
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        forget()

    def tearDown(self):
        self.env.stop()
        forget()
        super().tearDown()

    def test_today_config_and_team_day_show_the_rule_and_count(self):
        today = timezone.localdate()
        AttendanceReminderLog.objects.create(user=self.rahul, date=today, n=1)
        AttendanceReminderLog.objects.create(user=self.rahul, date=today, n=2)
        self.as_(self.rahul)
        res = self.client.get("/api/attendance/today/").data
        self.assertEqual(res["punch_reminders"], {"enabled": True, "count": 3, "gap_minutes": 30,
                                                  "first_after_minutes": 30, "reporting_time": "09:30"})
        self.assertEqual(res["reminders_sent"], 2)
        self.assertIn(res["day_off"], (None, "holiday", "week_off"))
        self.assertEqual(self.client.get("/api/hr/config/").data["punch_reminders"]["count"], 3)
        self.as_(self.admin)
        rows = self.client.get(f"/api/attendance/team_day/?date={today.isoformat()}").data["rows"]
        mine = {r["user_id"]: r["reminders_sent"] for r in rows}
        self.assertEqual((mine[self.rahul.id], mine[self.amit.id]), (2, 0))

    def test_day_off_on_leave(self):
        lt = LeaveType.objects.create(name="Casual", annual_quota=12)
        today = timezone.localdate()
        LeaveRequest.objects.create(user=self.rahul, leave_type=lt, start_date=today, end_date=today,
                                    reason="x", status=LeaveStatus.APPROVED)
        self.as_(self.rahul)
        self.assertIn(self.client.get("/api/attendance/today/").data["day_off"], ("leave", "holiday", "week_off"))

    def test_settings_saved_and_validated(self):
        self.as_(self.admin)
        bad = self.client.put("/api/hr/settings/", {"punch_reminder_count": 11, "punch_reminder_gap": 4}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(set(bad.data), {"punch_reminder_count", "punch_reminder_gap"})
        ok = self.client.put("/api/hr/settings/", {"punch_reminders": False, "punch_reminder_count": 5,
                                                   "punch_reminder_gap": 20, "punch_reminder_first": 0}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["punch_reminders"]["value"], False)
        self.assertEqual((ok.data["punch_reminder_count"]["value"], ok.data["punch_reminder_gap"]["value"],
                          ok.data["punch_reminder_first"]["value"]), (5, 20, 0))
        self.assertEqual(ok.data["punch_reminder_count"]["range"], [1, 10])
        forget()
        self.assertFalse(punch_reminders.rule()["enabled"])
