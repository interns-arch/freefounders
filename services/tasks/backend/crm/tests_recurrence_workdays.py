"""Recurring tasks never fall due on the weekly off day (Sunday by default,
HR_WEEK_OFF_DAYS) or a calendar holiday: the next occurrence moves to the
next working day, same time."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from .models import Holiday, Task
from .task_views import _advance_due
from .tests_task_engine import Base

IST = ZoneInfo("Asia/Kolkata")


def at(y, m, d, h=18, mi=30):
    return datetime(y, m, d, h, mi, tzinfo=IST)


class NextWorkingDayTests(Base):
    def test_daily_after_saturday_is_monday_same_time(self):
        nxt = _advance_due(at(2026, 10, 24), "daily")           # Sat -> (Sun) -> Mon
        self.assertEqual(timezone.localtime(nxt).strftime("%a %d %b %H:%M"), "Mon 26 Oct 18:30")

    def test_daily_on_weekdays_and_saturday_unchanged(self):
        self.assertEqual(_advance_due(at(2026, 10, 22), "daily"), at(2026, 10, 23))  # Thu -> Fri
        self.assertEqual(_advance_due(at(2026, 10, 23), "daily"), at(2026, 10, 24))  # Fri -> Sat

    def test_holiday_is_skipped_too(self):
        Holiday.objects.create(name="Diwali", date="2026-11-09")              # a Monday
        nxt = _advance_due(at(2026, 11, 7), "daily")                          # Sat
        self.assertEqual(timezone.localtime(nxt).date().isoformat(), "2026-11-10")   # Tue

    def test_weekly_landing_on_a_holiday_moves_a_day(self):
        Holiday.objects.create(name="X", date="2026-11-04")                   # Wed
        self.assertEqual(_advance_due(at(2026, 10, 28), "weekly"), at(2026, 11, 5))   # Wed hol -> Thu

    def test_monthly_landing_on_sunday_moves_to_monday(self):
        nxt = _advance_due(at(2026, 10, 15), "monthly")                       # 15 Nov is a Sunday
        self.assertEqual(timezone.localtime(nxt).date().isoformat(), "2026-11-16")

    def test_completing_on_saturday_creates_monday_task(self):
        due = at(2026, 10, 31, 17, 0)                                         # a Saturday
        t = Task.objects.create(title="Daily stock check", assigned_to=self.rahul,
                                created_by=self.manager, frequency="daily",
                                due_at=due, effort_minutes=20)
        self.as_(self.rahul)
        self.client.post(f"/api/tasks/{t.id}/complete/",
                         {"remarks": "checked", "actual_minutes": 20}, format="json")
        nxt = Task.objects.exclude(pk=t.pk).get(title="Daily stock check")
        self.assertEqual(timezone.localtime(nxt.due_at).strftime("%a %d %b %H:%M"), "Mon 02 Nov 17:00")
