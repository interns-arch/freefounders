"""The People directory from the Platform (PLAN.md section 17.1) reaches Tasks:
departments, department, reports-to and active/inactive."""
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import DepartmentOption, Role, User
from accounts.tests_platform import JWKS, token


@override_settings(PLATFORM_JWKS=JWKS)
class PeopleSyncTests(TestCase):
    def setUp(self):
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.boss_pid, self.mia_pid = uuid.uuid4(), uuid.uuid4()
        self.boss = User.objects.create_user("boss", "b@x.com", "pass@12345", role=Role.SALES_MANAGER, platform_person_id=self.boss_pid)
        self.mia = User.objects.create_user("mia", "m@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, platform_person_id=self.mia_pid)

    def push(self, version=1, people=None, departments=None):
        body = {
            "version": version,
            "departments": departments if departments is not None else [{"code": "field-ops", "name": "Field Ops"}],
            "people": people if people is not None else [
                {"personId": str(self.mia_pid), "status": "active", "departmentCode": "field-ops", "reportsTo": str(self.boss_pid)},
                {"personId": str(self.boss_pid), "status": "active", "departmentCode": "field-ops", "reportsTo": None},
            ],
        }
        return self.api.put("/api/internal/people", body, format="json")

    def test_needs_the_platform(self):
        self.assertEqual(APIClient().put("/api/internal/people", {"version": 1}, format="json").status_code, 401)
        self.assertEqual(APIClient().get("/api/internal/people").status_code, 401)

    def test_departments_managers_and_departments_arrive(self):
        res = self.push()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["applied"])
        self.assertEqual(DepartmentOption.objects.get(code="field-ops").name, "Field Ops")
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.department, "field-ops")
        self.assertEqual(self.mia.reporting_manager, self.boss)
        # The manager sees her as a direct report (team scope).
        self.assertIn(self.mia, self.boss.reports.all())

    def test_deactivation_reaches_tasks(self):
        self.push()
        self.push(version=2, people=[{"personId": str(self.mia_pid), "status": "inactive", "departmentCode": "field-ops", "reportsTo": None}])
        self.mia.refresh_from_db()
        self.assertFalse(self.mia.is_active)
        self.assertIsNone(self.mia.reporting_manager)

    def test_older_push_is_ignored_and_unknown_people_are_reported(self):
        self.push(version=5)
        res = self.push(version=4, people=[]).json()
        self.assertEqual(res, {"version": 5, "applied": False})
        res = self.push(version=6, people=[{"personId": str(uuid.uuid4()), "status": "active"}]).json()
        self.assertEqual(len(res["missingPeople"]), 1)

    def test_export_for_an_existing_company(self):
        self.mia.reporting_manager = self.boss
        self.mia.department = "sales"
        self.mia.save()
        data = self.api.get("/api/internal/people").json()
        mia = next(p for p in data["people"] if p["personId"] == str(self.mia_pid))
        self.assertEqual(mia, {"personId": str(self.mia_pid), "departmentCode": "sales", "reportsTo": str(self.boss_pid)})

    def test_employee_code_and_designation_arrive(self):
        """Shown on the attendance lists and used by the attendance import (PLAN.md §19.15)."""
        self.push(people=[{"personId": str(self.mia_pid), "status": "active", "employeeCode": " CT-007 ", "designation": "Driver"}])
        self.mia.refresh_from_db()
        self.assertEqual((self.mia.employee_code, self.mia.designation), ("CT-007", "Driver"))
        self.push(version=2, people=[{"personId": str(self.mia_pid), "status": "active"}])
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.employee_code, "CT-007", "left alone when the push does not carry it")
        self.push(version=3, people=[{"personId": str(self.mia_pid), "status": "active", "employeeCode": None, "designation": None}])
        self.mia.refresh_from_db()
        self.assertEqual((self.mia.employee_code, self.mia.designation), ("", ""))


@override_settings(PLATFORM_JWKS=JWKS)
class OnePlaceForPeopleTests(TestCase):
    """PLAN.md §26: People is the one place a person is added, edited, switched off or deleted; the push carries who
    they are and Tasks refuses its own people changes while Platform sign-in is on."""

    def setUp(self):
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.pid = uuid.uuid4()
        self.mia = User.objects.create_user("mia", "m@x.com", "pass@12345", first_name="Mia", last_name="Old",
                                            whatsapp_phone="919876543210", role=Role.SALES_EXECUTIVE, platform_person_id=self.pid)
        self.admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.SUPER_ADMIN)
        self.web = APIClient()
        self.web.force_authenticate(self.admin)

    def push(self, version, **person):
        return self.api.put("/api/internal/people", {"version": version, "departments": [], "people": [
            {"personId": str(self.pid), "status": "active", **person}]}, format="json")

    def test_name_email_and_mobile_follow_people(self):
        self.assertEqual(self.push(1, fullName="Mia Anne New", email="Mia.New@X.com", mobile="98765 43210").status_code, 200)
        self.mia.refresh_from_db()
        self.assertEqual((self.mia.first_name, self.mia.last_name, self.mia.email), ("Mia", "Anne New", "mia.new@x.com"))
        self.assertEqual(self.mia.whatsapp_phone, "919876543210", "the same number written another way is left as it is")
        self.push(2, mobile="+91 99999 00000")
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.whatsapp_phone, "+919999900000")
        # An empty value in People never wipes what Tasks has (mails and WhatsApp alerts keep working).
        self.push(3, fullName="", email="", mobile=None)
        self.mia.refresh_from_db()
        self.assertEqual((self.mia.first_name, self.mia.email, self.mia.whatsapp_phone), ("Mia", "mia.new@x.com", "+919999900000"))

    def test_people_changes_in_tasks_are_refused(self):
        msg = "People are managed in Admin → People"
        cases = [
            ("post", "/api/users/", {"username": "new1", "password": "Strong@12345", "role": Role.SALES_EXECUTIVE}),
            ("patch", f"/api/users/{self.mia.pk}/", {"first_name": "X"}),
            ("put", f"/api/users/{self.mia.pk}/", {"username": "mia", "role": Role.SALES_EXECUTIVE}),
            ("post", f"/api/users/{self.mia.pk}/deactivate/", {}),
            ("post", f"/api/users/{self.mia.pk}/activate/", {}),
            ("post", f"/api/users/{self.mia.pk}/purge/", {"confirm": "mia"}),
        ]
        for method, url, body in cases:
            res = getattr(self.web, method)(url, body, format="json")
            self.assertEqual(res.status_code, 403, f"{method} {url}: {res.content}")
            self.assertEqual(res.json()["detail"], msg)
        self.assertFalse(User.objects.filter(username="new1").exists())
        self.mia.refresh_from_db()
        self.assertTrue(self.mia.is_active)
        # Reading stays: the list (with the People person id for "Manage in People") and the delete preview.
        listed = self.web.get("/api/users/").json()
        rows = listed["results"] if isinstance(listed, dict) else listed
        self.assertEqual(next(u for u in rows if u["id"] == self.mia.pk)["platform_person_id"], str(self.pid))
        self.assertEqual(self.web.get(f"/api/users/{self.mia.pk}/purge/").status_code, 200)


class StandaloneTasksStillManagesPeopleTests(TestCase):
    """Platform sign-in off (a standalone Tasks install): adding and switching off people works as before."""

    def test_add_and_deactivate(self):
        admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.SUPER_ADMIN)
        web = APIClient()
        web.force_authenticate(admin)
        res = web.post("/api/users/", {"username": "new1", "password": "Strong@12345!", "email": "n@x.com", "first_name": "New",
                                        "last_name": "One", "whatsapp_phone": "9876543210", "role": Role.SALES_EXECUTIVE,
                                        "department": "sales", "reporting_manager": admin.pk}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        new = User.objects.get(username="new1")
        self.assertEqual(web.post(f"/api/users/{new.pk}/deactivate/").status_code, 200)
