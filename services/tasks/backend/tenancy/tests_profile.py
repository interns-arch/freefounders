"""Company profile from the FreeFounders Settings Center (PLAN.md section 16):
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
                                "links": False})

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
