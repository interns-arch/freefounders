"""Multi-company security regressions (docs/security/tasks-api.md): no cross-company reach through files, caches,
tokens or a connection left pointing at the wrong company.

Needs Postgres (schemas); skipped on SQLite. Run:
    DATABASE_URL=postgres://... DB_SSLMODE=disable python manage.py test tenancy
"""
import shutil
import tempfile
import unittest
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import access as access_cache
from accounts.models import AccessGrant, Role, User
from accounts.tests_platform import JWKS
from crm.models import Task

from . import schemas
from .middleware import CompanyMiddleware
from .tests import access, make_user, service

A_ID, B_ID = str(uuid.uuid4()), str(uuid.uuid4())
A, B = "co_sec_a_t", "co_sec_b_t"
STORAGES = {
    "default": {"BACKEND": "tenancy.storage.CompanyFileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@unittest.skipUnless(connection.vendor == "postgresql", "multi-company mode needs Postgres")
@override_settings(TENANCY="schemas", PLATFORM_JWKS=JWKS, STORAGES=STORAGES)
class CrossCompanySecurityTests(SimpleTestCase):
    databases = {"default"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.media_root = tempfile.mkdtemp(prefix="ff-media-")
        cls._media = override_settings(MEDIA_ROOT=cls.media_root)
        cls._media.enable()
        schemas.ensure_registry()
        schemas.create_company(A_ID, A, "Sec A")
        schemas.create_company(B_ID, B, "Sec B")
        with schemas.use(A):
            cls.a_user = make_user("sam")
            cls.a_task = Task.objects.create(title="A payroll plan", assigned_to=cls.a_user, created_by=cls.a_user,
                                             due_at=timezone.now() + timezone.timedelta(days=2))
        with schemas.use(B):
            cls.b_user = make_user("sam")

    @classmethod
    def tearDownClass(cls):
        with connection.cursor() as cur:
            for schema in (A, B):
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            cur.execute(f"DELETE FROM {schemas.REGISTRY} WHERE company_id::text IN (%s, %s)", [A_ID, B_ID])
        schemas._cache.clear()
        cls._media.disable()
        shutil.rmtree(cls.media_root, ignore_errors=True)
        super().tearDownClass()

    def api(self, tok=None):
        client = APIClient()
        if tok:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        return client

    def search_path(self):
        with connection.cursor() as cur:
            cur.execute("SHOW search_path")
            return cur.fetchone()[0].strip('"')

    # --- the connection never stays in a company -----------------------------------------------------------------

    def test_search_path_is_reset_even_when_the_view_crashes(self):
        before = self.search_path()

        def boom(request):
            self.assertEqual(self.search_path(), A)
            raise RuntimeError("view failed")

        request = RequestFactory().get("/api/tasks/", HTTP_AUTHORIZATION=f"Bearer {access(A_ID, self.a_user)}")
        with self.assertRaises(RuntimeError):
            CompanyMiddleware(boom)(request)
        self.assertEqual(self.search_path(), before)
        self.assertIsNone(schemas.current())

    def test_a_request_after_another_companys_request_sees_only_its_own_data(self):
        self.assertEqual(self.api(access(A_ID, self.a_user)).get("/api/tasks/").status_code, 200)
        res = self.api(access(B_ID, self.b_user)).get("/api/tasks/")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("A payroll plan", {t["title"] for t in res.data["results"]})

    # --- files ---------------------------------------------------------------------------------------------------

    def test_uploads_live_under_the_company_and_need_a_signed_link(self):
        res = self.api(access(A_ID, self.a_user)).post(
            f"/api/tasks/{self.a_task.pk}/upload/",
            {"file": SimpleUploadedFile("salaries.pdf", b"%PDF-1.4 A only", content_type="application/pdf")},
            format="multipart")
        self.assertEqual(res.status_code, 201, res.content)
        url = res.data[0]["url"]
        path = url.partition("?")[0]
        self.assertTrue(path.startswith(f"/media/c/{A}/"), url)
        self.assertEqual(self.api().get(path).status_code, 404)  # guessed: nothing, with or without a token
        self.assertEqual(self.api(access(B_ID, self.b_user)).get(path).status_code, 404)
        self.assertEqual(self.api().get(url).status_code, 200)  # the link company A's API handed out
        # Company B cannot even reach A's task to be given a link.
        files = self.api(access(B_ID, self.b_user)).get(f"/api/tasks/{self.a_task.pk}/files/")
        if files.status_code == 200:
            self.assertFalse(any("salaries.pdf" in f["filename"] for f in files.data))

    # --- caches --------------------------------------------------------------------------------------------------

    def test_role_cache_is_per_company(self):
        access_cache.forget()
        with schemas.use(A):
            self.assertIn("users.manage", access_cache.capabilities(self.a_user))
        with schemas.use(B):
            AccessGrant.objects.filter(role__code=Role.ADMIN, permission="users.manage").delete()
            access_cache.forget()
            self.assertNotIn("users.manage", access_cache.capabilities(User.objects.get(pk=self.b_user.pk)))
        with schemas.use(A):  # A's cached table is not B's
            self.assertIn("users.manage", access_cache.capabilities(self.a_user))

    # --- tokens --------------------------------------------------------------------------------------------------

    def test_legacy_app_tokens_never_open_the_api(self):
        with schemas.use(B):
            legacy = str(AccessToken.for_user(User.objects.get(pk=self.b_user.pk)))
        self.assertEqual(self.api(legacy).get("/api/tasks/").status_code, 401)
        # naming a company does not help: only a Platform token picks one
        self.assertEqual(self.api(legacy).get(f"/api/tasks/?company={B_ID}").status_code, 401)

    def test_access_and_service_tokens_are_not_interchangeable(self):
        self.assertEqual(self.api(access(A_ID, self.a_user)).get("/api/internal/roles").status_code, 401)
        self.assertIn(self.api(service(A_ID)).get("/api/tasks/").status_code, (401, 403))
