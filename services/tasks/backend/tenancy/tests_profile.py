"""Company profile from the Kaampilot Settings Center (PLAN.md section 16):
module switches are enforced on the server, branding reaches /me and emails,
and an install that never received a profile behaves exactly as before."""
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from accounts.tests_platform import JWKS, token
from tenancy import profile


def service():
    return token("platform", {}, aud="tasks-internal")


@override_settings(PLATFORM_JWKS=JWKS)
class ProfileTests(TestCase):
    def setUp(self):
        profile.forget()
        self.platform = APIClient()
        self.platform.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        self.admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.ADMIN)
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def tearDown(self):
        profile.forget()

    def push(self, version=1, **body):
        data = {"version": version, "name": "Acme Industries", "shortName": "Acme", "colour": "#0f7b5f",
                "logoUrl": "/api/platform/brand/x/logo?v=1", "modules": {}, **body}
        return self.platform.put("/api/internal/company", data, format="json")

    def test_without_a_profile_everything_is_on_and_unbranded(self):
        me = self.api.get("/api/auth/me").json()
        self.assertTrue(all(me["modules"].values()))
        self.assertIsNone(me["brand"])
        self.assertEqual(self.api.get("/api/leads/").status_code, 200)
        self.assertEqual(profile.app_name(), "Automation Task")

    def test_internal_endpoints_need_the_platform(self):
        self.assertEqual(APIClient().get("/api/internal/modules").status_code, 401)
        self.assertEqual(APIClient().put("/api/internal/company", {"version": 1}, format="json").status_code, 401)
        cat = self.platform.get("/api/internal/modules").json()
        self.assertEqual(cat["app"], "tasks")
        keys = {m["key"]: m["default"] for m in cat["modules"]}
        self.assertEqual(keys, {"leads": False, "intake": False, "payroll": False, "mistakes": False,
                                "links": False, "visitors": False})

    def test_switched_off_modules_answer_404_and_leave_me(self):
        self.assertTrue(self.push(modules={"leads": False, "payroll": False, "rockets": False}).json()["applied"])
        for path in ("/api/leads/", "/api/quotations/", "/api/assignment-rules/", "/api/payslips/", "/api/payroll-runs/"):
            with self.subTest(path=path):
                res = self.api.get(path)
                self.assertEqual(res.status_code, 404)
                self.assertEqual(res.json()["detail"], "This module is switched off")
        # Modules still on, and the parts that are always on, keep working.
        for path in ("/api/tasks/", "/api/mistakes/", "/api/notices/", "/api/attendance/today/", "/api/leave-types/"):
            with self.subTest(path=path):
                self.assertEqual(self.api.get(path).status_code, 200)
        me = self.api.get("/api/auth/me").json()
        self.assertFalse(me["modules"]["leads"])
        self.assertTrue(me["modules"]["mistakes"])
        self.assertNotIn("rockets", me["modules"])

    def test_the_team_list_stays_available_without_leads(self):
        # Groups, templates and settings read the team from /api/leads/assignees/.
        self.push(modules={"leads": False})
        self.assertEqual(self.api.get("/api/leads/assignees/").status_code, 200)
        self.assertEqual(self.api.get("/api/leads/1/").status_code, 404)

    def test_switching_back_on_restores_the_module(self):
        self.push(version=1, modules={"leads": False})
        self.assertEqual(self.api.get("/api/leads/").status_code, 404)
        self.push(version=2, modules={"leads": True})
        self.assertEqual(self.api.get("/api/leads/").status_code, 200)

    def test_branding_reaches_me_and_emails(self):
        self.push()
        me = self.api.get("/api/auth/me").json()
        self.assertEqual(me["brand"], {"name": "Acme Industries", "short_name": "Acme", "colour": "#0f7b5f",
                                       "logo_url": "/api/platform/brand/x/logo?v=1"})
        from notifications.service import notify
        with mock.patch("notifications.service.gmail.send_email", return_value={"channel": "email", "status": "sent"}) as send:
            notify(self.admin, "test", "Hello", want_whatsapp=False)
        subject, kwargs = send.call_args.args[1], send.call_args.kwargs
        self.assertEqual(subject, "[Acme] Hello")
        self.assertEqual(kwargs["link_label"], "Open in Acme")

    def test_unsafe_values_are_dropped(self):
        self.push(colour="red; background:url(x)", logoUrl="https://evil.example/logo.png")
        brand = self.api.get("/api/auth/me").json()["brand"]
        self.assertIsNone(brand["colour"])
        self.assertIsNone(brand["logo_url"])

    def test_an_older_profile_arriving_late_is_ignored(self):
        self.push(version=5, name="New Name")
        res = self.push(version=4, name="Old Name").json()
        self.assertEqual(res, {"version": 5, "applied": False})
        self.assertEqual(self.api.get("/api/auth/me").json()["brand"]["name"], "New Name")

    def test_worker_skips_switched_off_modules(self):
        from crm import reminders
        self.push(modules={"mistakes": False, "leads": False})
        with mock.patch("mistakes.sla.escalate_overdue_mistakes") as escalate, \
                mock.patch("crm.reminders.notify_follow_up_due") as follow_up:
            reminders.send_followup_reminders(force=True)
        escalate.assert_not_called()
        follow_up.assert_not_called()
        self.push(version=2, modules={})
        with mock.patch("mistakes.sla.escalate_overdue_mistakes") as escalate:
            reminders.send_followup_reminders(force=True)
        escalate.assert_called_once()


@override_settings(PLATFORM_JWKS=JWKS)
class PlanAreaTests(TestCase):
    """PLAN.md §24.1: a plan of picked modules with Tasks but not Attendance (or the reverse) refuses the other area's
    API with 403; the shared parts stay open; without the plan switches (standalone, Complete) everything is open."""

    TASKS = ("/api/tasks/", "/api/task-categories/", "/api/task-change-requests/", "/api/task-templates/",
             "/api/leads/", "/api/mistakes/", "/api/links/")
    ATTENDANCE = ("/api/attendance/today/", "/api/attendance-corrections/", "/api/leaves/", "/api/leave-types/",
                  "/api/holidays/", "/api/hr/config/", "/api/office-locations/", "/api/payslips/")
    SHARED = ("/api/auth/me", "/api/notifications/", "/api/badges/", "/api/users/", "/api/notices/", "/api/groups/",
              "/api/leads/assignees/")

    def setUp(self):
        profile.forget()
        self.platform = APIClient()
        self.platform.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        self.admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.ADMIN)
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def tearDown(self):
        profile.forget()

    def push(self, modules, version=1):
        return self.platform.put("/api/internal/company", {"version": version, "name": "Acme", "modules": modules},
                                 format="json")

    def assertOpen(self, paths):
        for path in paths:
            with self.subTest(path=path):
                self.assertNotIn(self.api.get(path).status_code, (403, 404))

    def assertBlocked(self, paths, name):
        for path in paths:
            with self.subTest(path=path):
                res = self.api.get(path)
                self.assertEqual(res.status_code, 403)
                self.assertEqual(res.json()["detail"], f"{name} is not in your plan. An owner can add it in Billing.")

    def test_without_plan_switches_everything_is_open(self):
        self.assertOpen(self.TASKS + self.ATTENDANCE + self.SHARED)
        self.push({"leads": True, "mistakes": True, "links": True, "payroll": True})  # Complete: both areas on
        self.assertOpen(self.TASKS + self.ATTENDANCE + self.SHARED)
        self.push({"tasks": True, "attendance": True, "leads": True, "mistakes": True, "links": True, "payroll": True},
                  version=2)
        self.assertOpen(self.TASKS + self.ATTENDANCE + self.SHARED)

    def test_tasks_only_plan_blocks_attendance(self):
        self.push({"tasks": True, "attendance": False, "leads": True, "mistakes": True, "links": True, "payroll": True})
        self.assertBlocked(self.ATTENDANCE, "Attendance")
        self.assertBlocked(("/api/attendance/check-in/",), "Attendance")
        self.assertEqual(self.api.post("/api/attendance/check-in/", {}, format="json").status_code, 403)
        self.assertOpen(self.TASKS + self.SHARED)
        me = self.api.get("/api/auth/me").json()
        self.assertFalse(me["modules"]["attendance"])
        self.assertTrue(me["modules"]["tasks"])
        self.assertFalse(me["modules"]["payroll"])  # payroll comes with Attendance

    def test_attendance_only_plan_blocks_tasks(self):
        self.push({"tasks": False, "attendance": True, "leads": True, "mistakes": True})
        self.assertBlocked(self.TASKS, "Tasks")
        self.assertOpen(("/api/attendance/today/", "/api/leaves/", "/api/leave-types/", "/api/holidays/") + self.SHARED)
        self.assertFalse(self.api.get("/api/auth/me").json()["modules"]["leads"])

    def test_buying_the_area_opens_it_again(self):
        self.push({"tasks": True, "attendance": False})
        self.assertBlocked(("/api/leaves/",), "Attendance")
        self.push({"tasks": True, "attendance": True}, version=2)
        self.assertOpen(("/api/leaves/",))

    def test_bell_and_badges_leave_out_the_blocked_area(self):
        from notifications.models import Notification
        Notification.objects.create(user=self.admin, type="leave_reviewed", title="Leave approved")
        Notification.objects.create(user=self.admin, type="task_assigned", title="New task")
        self.push({"tasks": True, "attendance": False})
        listed = self.api.get("/api/notifications/").json()
        rows = listed["results"] if isinstance(listed, dict) else listed
        self.assertEqual([n["title"] for n in rows], ["New task"])
        counts = self.api.get("/api/notifications/unread_count/").json()
        self.assertEqual(counts["by_category"]["attendance"], 0)
        self.assertEqual(counts["by_category"]["tasks"], 1)
        self.assertEqual(self.api.get("/api/badges/").json()["hr"]["approvals"], 0)

    def test_worker_skips_the_area_not_in_the_plan(self):
        from crm import reminders
        self.push({"tasks": True, "attendance": False})
        with mock.patch("hr.punch_reminders.send_punch_reminders") as punch, \
                mock.patch("hr.approvals.remind_and_escalate", return_value=0) as hr_remind, \
                mock.patch("crm.reminders.send_task_reminders", return_value=0) as task_remind:
            reminders.send_followup_reminders(force=True)
        punch.assert_not_called()
        hr_remind.assert_not_called()
        task_remind.assert_called_once()
        self.push({"tasks": False, "attendance": True}, version=2)
        with mock.patch("hr.punch_reminders.send_punch_reminders") as punch, \
                mock.patch("hr.approvals.remind_and_escalate", return_value=0), \
                mock.patch("crm.reminders.send_task_reminders", return_value=0) as task_remind, \
                mock.patch("crm.duties.create_duty_tasks") as duties:
            reminders.send_followup_reminders(force=True)
        punch.assert_called_once()
        task_remind.assert_not_called()
        duties.assert_not_called()
