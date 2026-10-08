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
