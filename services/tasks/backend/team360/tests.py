"""Team 360 (PLAN.md §25): who sees whom, the tiles' numbers, one person's view, plan areas."""
import json
import uuid
from datetime import date, datetime, time, timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from accounts.tests_platform import JWKS, token
from crm.models import Task, TaskChangeRequest, TaskStatus
from hr.models import Attendance, AttendanceCorrection
from tenancy import profile
from tenancy.company_settings import forget
from tenancy.models import CompanySetting


def at(day, hh, mm=0):
    return timezone.make_aware(datetime.combine(day, time(hh, mm)))


class _Base(TestCase):
    def setUp(self):
        forget()
        profile.forget()
        mk = User.objects.create_user
        self.owner = mk("owner", "o@x.com", "pass@12345", role=Role.SUPER_ADMIN, department="management", first_name="Olga")
        self.hr = mk("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr", first_name="Hema")
        # A member-level role who has people reporting to them: the "manager" of the founder's rule.
        self.lead = mk("lead", "l@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales", first_name="Lata",
                       designation="Team lead")
        self.rahul = mk("rahul", "r@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                        first_name="Rahul", employee_code="CT-001", reporting_manager=self.lead)
        self.priya = mk("priya", "p@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="purchase",
                        first_name="Priya")
        self.gone = mk("gone", "g@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                       first_name="Gone", reporting_manager=self.lead, is_active=False)

    def tearDown(self):
        forget()
        profile.forget()

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def ids(self, res):
        self.assertEqual(res.status_code, 200, res.content)
        return {r["id"] for r in res.json()["rows"]}

    def plan(self, **modules):
        CompanySetting.objects.update_or_create(key=profile.PROFILE_KEY, defaults={"value": json.dumps({"modules": modules})})
        profile.forget()


class ScopeTests(_Base):
    def test_owner_sees_everyone_active(self):
        ids = self.ids(self.as_(self.owner).get("/api/team360/"))
        self.assertEqual(ids, {self.owner.id, self.hr.id, self.lead.id, self.rahul.id, self.priya.id})

    def test_hr_with_company_attendance_scope_sees_everyone(self):
        ids = self.ids(self.as_(self.hr).get("/api/team360/"))
        self.assertTrue({self.rahul.id, self.priya.id, self.owner.id} <= ids)

    def test_manager_sees_only_self_and_team(self):
        c = self.as_(self.lead)
        self.assertEqual(self.ids(c.get("/api/team360/")), {self.lead.id, self.rahul.id})
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/").status_code, 200)
        for pk in (self.priya.id, self.owner.id, self.gone.id):
            for suffix in ("", "attendance/", "tasks/"):
                self.assertEqual(c.get(f"/api/team360/{pk}/{suffix}").status_code, 403, (pk, suffix))

    def test_member_gets_403_everywhere(self):
        c = self.as_(self.priya)
        self.assertEqual(c.get("/api/team360/").status_code, 403)
        self.assertEqual(c.get(f"/api/team360/{self.priya.id}/").status_code, 403)
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/attendance/").status_code, 403)
        self.assertEqual(APIClient().get("/api/team360/").status_code, 401)

    def test_me_carries_the_menu_flag(self):
        self.assertTrue(self.as_(self.owner).get("/api/auth/me").json()["team360"])
        self.assertTrue(self.as_(self.lead).get("/api/auth/me").json()["team360"])
        self.assertFalse(self.as_(self.priya).get("/api/auth/me").json()["team360"])

    def test_unknown_person_is_refused(self):
        self.assertEqual(self.as_(self.owner).get("/api/team360/999999/").status_code, 403)


class NumbersTests(_Base):
    def test_tiles_today_month_and_tasks(self):
        today = timezone.localdate()
        Attendance.objects.create(user=self.rahul, date=today, status="late", check_in=at(today, 10, 15), is_late=True)
        now = timezone.now()
        Task.objects.create(title="Late one", assigned_to=self.rahul, created_by=self.lead, due_at=now - timedelta(days=1))
        Task.objects.create(title="Open one", assigned_to=self.rahul, created_by=self.lead, due_at=now + timedelta(days=3))
        Task.objects.create(title="Done", assigned_to=self.rahul, created_by=self.lead, status=TaskStatus.DONE,
                            completed_at=now, due_at=now + timedelta(days=1))
        Task.objects.create(title="Deleted", assigned_to=self.rahul, created_by=self.lead, deleted_at=now)
        data = self.as_(self.owner).get("/api/team360/").json()
        self.assertEqual(data["scope"], "company")
        self.assertEqual(data["areas"]["tasks"], True)
        row = next(r for r in data["rows"] if r["id"] == self.rahul.id)
        self.assertEqual(row["today"]["status"], "late")
        self.assertTrue(row["today"]["is_late"])
        self.assertEqual(row["tasks"], {"open": 2, "overdue": 1, "done_this_month": 1})
        self.assertEqual(row["employee_code"], "CT-001")
        self.assertEqual(row["manager"]["id"], self.lead.id)
        self.assertGreaterEqual(row["month"]["late_days"], 1)
        # Today counts once they punched in: worked >= 1, so the rate is a number.
        self.assertIsNotNone(row["month"]["attendance_rate"])
        other = next(r for r in data["rows"] if r["id"] == self.priya.id)
        self.assertIn(other["today"]["status"], ("not_checked_in", "week_off", "holiday"))

    def test_person_summary_periods_and_rank(self):
        now = timezone.now()
        t = Task.objects.create(title="Move me", assigned_to=self.rahul, created_by=self.lead, due_at=now)
        for _ in range(2):
            TaskChangeRequest.objects.create(task=t, requested_by=self.rahul, changes={"due_at": now.isoformat()}, reason="x")
        TaskChangeRequest.objects.create(task=t, requested_by=self.priya, changes={"due_at": now.isoformat()}, reason="y")
        c = self.as_(self.owner)
        for rng in ("this_week", "this_month", "last_month", "this_quarter"):
            res = c.get(f"/api/team360/{self.rahul.id}/", {"range": rng})
            self.assertEqual(res.status_code, 200, (rng, res.content))
        data = c.get(f"/api/team360/{self.rahul.id}/").json()
        self.assertEqual(data["person"]["manager"]["name"], "Lata")
        self.assertEqual(data["tasks"]["change_requests"], {"requests": 2, "rank": 1, "of": 2})
        self.assertTrue(data["attendance"]["trend"])
        self.assertTrue(data["tasks"]["trend"])
        self.assertIn("leave_balances", data["attendance"])
        res = c.get(f"/api/team360/{self.rahul.id}/", {"range": "custom", "start": "2026-09-01", "end": "2026-09-30"})
        self.assertEqual(res.json()["period"], {"range": "custom", "start": "2026-09-01", "end": "2026-09-30"})
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/", {"range": "nope"}).status_code, 400)
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/", {"range": "custom", "start": "2026-09-30",
                                                                    "end": "2026-09-01"}).status_code, 400)

    def test_attendance_month_regularizations_and_photo_rule(self):
        day = date(2026, 9, 14)
        Attendance.objects.create(user=self.rahul, date=day, status="present", check_in=at(day, 9), check_in_lat=12.9,
                                  check_in_lng=77.6)
        AttendanceCorrection.objects.create(user=self.rahul, date=day, reason_type="forgot_out", status="approved",
                                            reviewed_by=self.lead)
        data = self.as_(self.owner).get(f"/api/team360/{self.rahul.id}/attendance/", {"year": 2026, "month": 9}).json()
        self.assertEqual(len(data["days"]), 30)
        self.assertEqual(data["regularizations"][0]["status"], "approved")
        self.assertEqual(data["regularizations"][0]["reviewed_by"], "Lata")
        self.assertTrue(data["can_see_photos"])
        mon = next(d for d in data["days"] if d["date"] == "2026-09-14")
        self.assertEqual(mon["place"]["lat"], 12.9)

    def test_task_lists(self):
        now = timezone.now()
        main = Task.objects.create(title="Main", assigned_to=self.rahul, created_by=self.lead, due_at=now + timedelta(days=5))
        Task.objects.create(title="Part", assigned_to=self.priya, created_by=self.rahul, parent=main,
                            due_at=now + timedelta(days=4))
        Task.objects.create(title="Late", assigned_to=self.rahul, created_by=self.lead, due_at=now - timedelta(days=2))
        Task.objects.create(title="Done late", assigned_to=self.rahul, created_by=self.lead, status=TaskStatus.DONE,
                            due_at=now - timedelta(days=1), completed_at=now)
        data = self.as_(self.owner).get(f"/api/team360/{self.rahul.id}/tasks/").json()
        self.assertEqual([r["title"] for r in data["open"]], ["Late", "Main"])   # overdue first
        self.assertTrue(data["open"][0]["overdue"])
        self.assertEqual(data["completed"][0]["on_time"], False)
        self.assertEqual(data["on_time_rate"], 0.0)
        self.assertEqual([(c["title"], c["parts"], c["level"]) for c in data["chains"]], [("Main", 1, 0)])


class PlanAreaTests(_Base):
    def test_attendance_not_in_plan(self):
        self.plan(tasks=True, attendance=False)
        c = self.as_(self.owner)
        data = c.get("/api/team360/").json()
        self.assertFalse(data["areas"]["attendance"])
        row = data["rows"][0]
        self.assertIsNone(row["today"])
        self.assertIsNone(row["month"])
        self.assertIsNotNone(row["tasks"])
        self.assertIsNone(c.get(f"/api/team360/{self.rahul.id}/").json()["attendance"])
        res = c.get(f"/api/team360/{self.rahul.id}/attendance/")
        self.assertEqual(res.status_code, 403)
        self.assertIn("not in your plan", res.json()["detail"])

    def test_tasks_not_in_plan(self):
        self.plan(tasks=False, attendance=True)
        c = self.as_(self.owner)
        self.assertIsNone(c.get("/api/team360/").json()["rows"][0]["tasks"])
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/tasks/").status_code, 403)

    def test_visitors_tab_follows_the_module(self):
        c = self.as_(self.owner)
        self.plan(tasks=True, attendance=True, visitors=False)   # the company switched Visitors off
        self.assertEqual(c.get(f"/api/team360/{self.rahul.id}/visitors/").status_code, 403)
        self.assertFalse(c.get("/api/team360/").json()["areas"]["visitors"])
        self.plan(tasks=True, attendance=True, visitors=True)
        res = c.get(f"/api/team360/{self.rahul.id}/visitors/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["rows"], [])


@override_settings(PLATFORM_JWKS=JWKS)
class JoinDateTests(TestCase):
    def test_join_date_arrives_with_the_people_push(self):
        pid = uuid.uuid4()
        u = User.objects.create_user("mia", "m@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, platform_person_id=pid)
        api = APIClient()
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        body = {"version": 1, "departments": [], "people": [{"personId": str(pid), "status": "active", "joinDate": "2024-04-01"}]}
        self.assertEqual(api.put("/api/internal/people", body, format="json").status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.join_date, date(2024, 4, 1))
        body["version"] = 2
        body["people"][0]["joinDate"] = None
        api.put("/api/internal/people", body, format="json")
        u.refresh_from_db()
        self.assertIsNone(u.join_date)
