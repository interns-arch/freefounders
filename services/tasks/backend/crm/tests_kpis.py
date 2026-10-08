"""Team Performance shows attendance next to the task score (PLAN.md §17.5)."""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role, User
from hr.models import Attendance


class AttendanceKpiTests(TestCase):
    def test_attendance_rate_and_leave_days_over_working_days(self):
        boss = User.objects.create_user("boss", "b@x.com", "pass@12345", role=Role.ADMIN, department="management")
        rahul = User.objects.create_user("rahul", "r@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                                         reporting_manager=boss)
        # Mon 7 - Sun 13 Sep 2026: six working days (Sunday is the week-off).
        for day, status in ((7, "present"), (8, "late"), (9, "half_day"), (10, "leave"), (11, "absent"), (13, "present")):
            Attendance.objects.create(user=rahul, date=date(2026, 9, day), status=status)
        c = APIClient()
        c.force_authenticate(boss)
        res = c.get("/api/tasks/team_report/?range=custom&start=2026-09-07&end=2026-09-13")
        self.assertEqual(res.status_code, 200, res.content)
        row = next(r for r in res.json()["rows"] if r["user"] == rahul.pk)
        self.assertEqual(row["working_days"], 6)
        self.assertEqual(row["attendance_rate"], 50.0)   # 3 of 6 (Sunday does not count)
        self.assertEqual(row["leave_days"], 1)
        all_time = c.get("/api/tasks/team_report/?range=all").json()
        self.assertIsNone(next(r for r in all_time["rows"] if r["user"] == rahul.pk)["attendance_rate"])
