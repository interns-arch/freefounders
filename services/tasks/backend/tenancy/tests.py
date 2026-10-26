"""Multi-company mode: one schema per company, nothing visible across.

Needs Postgres (schemas); skipped on the default SQLite test database. Run:
    npm run test:tenancy        (repo root; starts a local Postgres)
or  DATABASE_URL=postgres://... DB_SSLMODE=disable python manage.py test tenancy
"""
import json
import time
import unittest
import uuid
from unittest import mock

import jwt
from django.db import ProgrammingError, connection
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from accounts.tests_platform import JWKS, KEY
from crm.models import Task

from . import schemas
from .company_settings import company_env, forget, set_value
from .management.commands.run_worker import run_pass
from .models import CompanySetting
from .storage import CompanyFileSystemStorage

ISS, AUD = "kaampilot-platform", "kaampilot"
ACME_ID, BETA_ID = str(uuid.uuid4()), str(uuid.uuid4())
ACME, BETA = "co_acme_t", "co_beta_t"


def sign(claims, aud=AUD, ttl=900):
    now = int(time.time())
    return jwt.encode({"iss": ISS, "aud": aud, "iat": now, "exp": now + ttl, **claims}, KEY,
                      algorithm="EdDSA", headers={"kid": "k1"})


def access(company_id, user):
    return sign({"sub": str(user.platform_person_id), "cid": company_id, "apps": {"tasks": str(user.pk)}, "role": "member"})


def service(company_id=None):
    claims = {"sub": "platform"}
    if company_id:
        claims["cid"] = company_id
    return sign(claims, aud="tasks-internal", ttl=60)


def make_user(username, **extra):
    return User.objects.create_user(username, f"{username}@x.com", "pass@12345", role=Role.ADMIN,
                                    department="management", platform_person_id=uuid.uuid4(), **extra)


@unittest.skipUnless(connection.vendor == "postgresql", "multi-company mode needs Postgres")
@override_settings(TENANCY="schemas", PLATFORM_JWKS=JWKS)
class MultiCompanyTests(SimpleTestCase):
    databases = {"default"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        schemas.ensure_registry()
        # One company through the Platform's internal endpoint, one directly.
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        res = client.post("/api/internal/companies", {"companyId": ACME_ID, "code": "acme_t", "name": "Acme"}, format="json")
        assert res.status_code == 201, res.content
        schemas.create_company(BETA_ID, BETA, "Beta")

        # The same username in both companies is fine: they are different people.
        with schemas.use(ACME):
            cls.acme_user = make_user("asha")
            cls.acme_task = Task.objects.create(title="Acme secret plan", assigned_to=cls.acme_user, created_by=cls.acme_user)
        with schemas.use(BETA):
            cls.beta_user = make_user("asha")
            Task.objects.create(title="Beta roadmap", assigned_to=cls.beta_user, created_by=cls.beta_user)

    @classmethod
    def tearDownClass(cls):
        with connection.cursor() as cur:
            for schema in (ACME, BETA):
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            cur.execute(f"DELETE FROM {schemas.REGISTRY} WHERE company_id::text IN (%s, %s)", [ACME_ID, BETA_ID])
        schemas._cache.clear()
        super().tearDownClass()

    def api(self, tok=None):
        client = APIClient()
        if tok:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        return client

    def titles(self, res):
        rows = res.data["results"] if isinstance(res.data, dict) and "results" in res.data else res.data
        return {row["title"] for row in rows}

    # --- isolation ---------------------------------------------------------

    def test_each_company_sees_only_its_own_tasks(self):
        res = self.api(access(ACME_ID, self.acme_user)).get("/api/tasks/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.titles(res), {"Acme secret plan"})
        res = self.api(access(BETA_ID, self.beta_user)).get("/api/tasks/")
        self.assertEqual(self.titles(res), {"Beta roadmap"})

    def test_another_company_cannot_open_a_task_by_id(self):
        res = self.api(access(BETA_ID, self.beta_user)).get(f"/api/tasks/{self.acme_task.pk}/")
        if res.status_code == 200:  # same id can exist in Beta; it must be Beta's own task
            self.assertNotEqual(res.data["title"], "Acme secret plan")
        else:
            self.assertEqual(res.status_code, 404)

    def test_token_for_one_company_cannot_borrow_another_companys_user(self):
        # cid says Beta, but the user/person pair is Acme's: Beta's user with that id is someone else.
        tok = sign({"sub": str(self.acme_user.platform_person_id), "cid": BETA_ID,
                    "apps": {"tasks": str(self.acme_user.pk)}, "role": "member"})
        self.assertEqual(self.api(tok).get("/api/auth/me").status_code, 401)

    def test_unknown_company_and_no_company_are_refused(self):
        res = self.api(access(str(uuid.uuid4()), self.acme_user)).get("/api/tasks/")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["code"], "no_company")
        self.assertEqual(self.api().get("/api/tasks/").status_code, 401)
        # A company id in the address names nothing: only a token picks the company.
        self.assertEqual(self.api().get(f"/api/tasks/?company={ACME_ID}").status_code, 401)
        # The app's own username/password login has no company to sign in to.
        res = self.api().post("/api/auth/login", {"username": "asha", "password": "pass@12345"}, format="json")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(self.api().get("/health").status_code, 200)

    def test_fails_closed_without_a_company(self):
        with schemas.use(schemas.NO_COMPANY):
            with self.assertRaises(ProgrammingError):
                with connection.cursor() as cur:
                    cur.execute("SELECT count(*) FROM crm_task")
        connection.close()  # the failed statement aborted nothing else, but start clean

    def test_company_schema_cannot_see_public_tables(self):
        with schemas.use(ACME):
            with connection.cursor() as cur:
                cur.execute("SHOW search_path")
                self.assertEqual(cur.fetchone()[0].strip('"'), ACME)

    # --- Platform internal API ---------------------------------------------

    def test_provision_lands_in_the_tokens_company(self):
        client = self.api(service(BETA_ID))
        person = str(uuid.uuid4())
        res = client.post("/api/internal/provision", {"personId": person, "fullName": "Ravi Kumar", "email": "ravi@beta.in"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        with schemas.use(BETA):
            self.assertTrue(User.objects.filter(platform_person_id=person).exists())
        with schemas.use(ACME):
            self.assertFalse(User.objects.filter(platform_person_id=person).exists())

    def test_internal_calls_without_a_company_are_refused(self):
        res = self.api(service()).post("/api/internal/provision", {"personId": str(uuid.uuid4()), "fullName": "X"}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_delete_person_stays_in_the_tokens_company(self):
        person = uuid.uuid4()
        with schemas.use(ACME):
            gone = User.objects.create_user("del_me", "d@x.com", "pass@12345", role=Role.ADMIN, platform_person_id=person)
            Task.objects.create(title="Acme leaver task", assigned_to=gone, created_by=gone)
        with schemas.use(BETA):
            kept = User.objects.create_user("del_me", "d@x.com", "pass@12345", role=Role.ADMIN, platform_person_id=person)
            Task.objects.create(title="Beta same-person task", assigned_to=kept, created_by=kept)
        try:
            self.assertEqual(self.api(service()).delete(f"/api/internal/people/{person}").status_code, 401)
            res = self.api(service(ACME_ID)).delete(f"/api/internal/people/{person}")
            self.assertEqual(res.status_code, 200, res.content)
            self.assertTrue(res.json()["deleted"])
            with schemas.use(ACME):
                self.assertFalse(User.objects.filter(platform_person_id=person).exists())
                self.assertFalse(Task.objects.filter(title="Acme leaver task").exists())
            with schemas.use(BETA):
                self.assertTrue(User.objects.filter(platform_person_id=person).exists())
                self.assertTrue(Task.objects.filter(title="Beta same-person task").exists())
            self.assertEqual(self.api(service(ACME_ID)).delete(f"/api/internal/people/{person}").json(), {"deleted": False})
        finally:
            with schemas.use(BETA):
                User.objects.filter(platform_person_id=person).delete()

    def test_create_company_is_idempotent_and_checks_codes(self):
        client = self.api(service())
        res = client.post("/api/internal/companies", {"companyId": ACME_ID, "code": "acme_t", "name": "Acme Ltd"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = client.post("/api/internal/companies", {"companyId": str(uuid.uuid4()), "code": "acme_t", "name": "Copycat"}, format="json")
        self.assertEqual(res.status_code, 409)
        res = client.post("/api/internal/companies", {"companyId": "not-a-uuid", "code": "x", "name": "X"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = client.post("/api/internal/companies", {"companyId": str(uuid.uuid4()), "code": "", "name": "X"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = APIClient().post("/api/internal/companies", {"companyId": str(uuid.uuid4()), "code": "x", "name": "X"}, format="json")
        self.assertEqual(res.status_code, 401)

    # --- worker, settings, files -------------------------------------------

    def test_worker_runs_once_per_company(self):
        seen = []

        def fake_jobs():
            with connection.cursor() as cur:
                cur.execute("SHOW search_path")
                seen.append(cur.fetchone()[0].strip('"'))

        with mock.patch("tenancy.management.commands.run_worker.run_jobs", fake_jobs):
            results = run_pass()
        self.assertEqual(results.get(ACME), "ok")
        self.assertEqual(results.get(BETA), "ok")
        self.assertIn(ACME, seen)
        self.assertIn(BETA, seen)

    def test_worker_keeps_going_when_one_company_fails(self):
        def flaky():
            if schemas.current() == ACME:
                raise RuntimeError("boom")

        with mock.patch("tenancy.management.commands.run_worker.run_jobs", flaky):
            results = run_pass()
        self.assertEqual(results[ACME], "failed")
        self.assertEqual(results[BETA], "ok")

    def test_settings_are_per_company_with_env_fallback(self):
        with mock.patch.dict("os.environ", {"HR_WORK_START": "09:30", "WHATSAPP_ACCESS_TOKEN": "env-token"}):
            with schemas.use(ACME):
                set_value("HR_WORK_START", "08:00")
                set_value("WHATSAPP_ACCESS_TOKEN", "acme-secret")
                self.assertEqual(company_env("HR_WORK_START", "x"), "08:00")
                self.assertEqual(company_env("WHATSAPP_ACCESS_TOKEN"), "acme-secret")
                stored = CompanySetting.objects.get(key="WHATSAPP_ACCESS_TOKEN")
                self.assertTrue(stored.secret)
                self.assertNotIn("acme-secret", stored.value)  # encrypted at rest
            with schemas.use(BETA):
                forget()
                self.assertEqual(company_env("HR_WORK_START", "x"), "09:30")
                self.assertEqual(company_env("WHATSAPP_ACCESS_TOKEN"), "env-token")

    def test_punch_reminders_per_company(self):
        """PLAN.md §19.39: each company's own rule, its own people, its own log (never across schemas)."""
        from datetime import date, datetime, timedelta

        from django.utils import timezone

        from hr.models import AttendanceReminderLog
        from hr.punch_reminders import send_punch_reminders
        from notifications.models import Notification

        day = date(timezone.localdate().year + 1, 3, 1)
        while day.weekday() != 0:
            day += timedelta(days=1)
        now = timezone.make_aware(datetime(day.year, day.month, day.day, 10, 5), timezone.get_current_timezone())
        env = {"HR_WORK_START": "09:30", "HR_WORK_END": "18:30", "HR_WEEK_OFF_DAYS": "6"}
        try:
            with mock.patch.dict("os.environ", env):
                with schemas.use(ACME):
                    set_value("PUNCH_REMINDERS_ENABLED", "false")
                    forget()
                    self.assertEqual(send_punch_reminders(now=now), 0)
                with schemas.use(BETA):
                    forget()
                    self.assertGreaterEqual(send_punch_reminders(now=now), 1)
                    self.assertEqual(send_punch_reminders(now=now), 0, "idempotent")
                    self.assertTrue(AttendanceReminderLog.objects.filter(user=self.beta_user, date=day, n=1).exists())
                with schemas.use(ACME):
                    self.assertFalse(AttendanceReminderLog.objects.filter(date=day).exists())
                    self.assertFalse(Notification.objects.filter(type="punch_reminder").exists())
        finally:
            with schemas.use(ACME):
                CompanySetting.objects.filter(key="PUNCH_REMINDERS_ENABLED").delete()
            with schemas.use(BETA):
                AttendanceReminderLog.objects.filter(date=day).delete()
                Notification.objects.filter(type="punch_reminder").delete()
            forget()

    def test_uploads_are_stored_under_the_company(self):
        storage = CompanyFileSystemStorage()
        with schemas.use(ACME):
            self.assertTrue(storage.generate_filename("task_files/a.pdf").startswith(f"c/{ACME}/"))
        self.assertEqual(storage.generate_filename("task_files/a.pdf").replace("\\", "/"), "task_files/a.pdf")

    def test_module_switches_and_brand_are_per_company(self):
        from . import profile
        platform = self.api(service(ACME_ID))
        res = platform.put("/api/internal/company", {"version": 1, "name": "Acme", "shortName": "Acme",
                                                     "modules": {"leads": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        try:
            self.assertEqual(self.api(access(ACME_ID, self.acme_user)).get("/api/leads/").status_code, 404)
            self.assertEqual(self.api(access(BETA_ID, self.beta_user)).get("/api/leads/").status_code, 200)
            self.assertEqual(self.api(access(ACME_ID, self.acme_user)).get("/api/auth/me").json()["brand"]["short_name"], "Acme")
            self.assertIsNone(self.api(access(BETA_ID, self.beta_user)).get("/api/auth/me").json()["brand"])
        finally:
            with schemas.use(ACME):
                CompanySetting.objects.filter(key__in=[profile.PROFILE_KEY, profile.VERSION_KEY]).delete()
            profile.forget()


class TenancyOffTests(SimpleTestCase):
    """With TENANCY unset nothing changes: no company, plain env lookups."""

    def test_off_by_default(self):
        self.assertFalse(schemas.enabled())
        self.assertIsNone(schemas.current())
        with mock.patch.dict("os.environ", {"HR_WORK_START": ""}):
            self.assertEqual(company_env("HR_WORK_START", "09:30"), "")  # exactly os.environ.get
        self.assertEqual(CompanyFileSystemStorage().generate_filename("a/b.txt").replace("\\", "/"), "a/b.txt")

    def test_schema_names_are_strict(self):
        self.assertEqual(schemas.schema_for_code("CarTrends"), "co_cartrends")
        self.assertEqual(schemas.schema_for_code("acme-india"), "co_acme_india")
        self.assertFalse(schemas.valid('co_x"; drop'))
        self.assertTrue(schemas.valid("co_ok_1"))
