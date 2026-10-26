"""Visitors (PLAN.md §22): permissions, the gate, vehicles, the open QR sign-in, guard activity, jobs."""
import base64
import io
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import access
from accounts.models import AccessGrant, AccessRole, Role, User, UserAccessRole
from notifications.models import Notification

from . import conf, services
from .models import GateAction, GateLink, GateLog, VehicleEntry, Visit, Visitor


def jpeg() -> str:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (120, 80, 40)).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def role_with(code, *perms, level=1):
    r = AccessRole.objects.create(code=code, name=code.title(), level=level)
    for p in perms:
        AccessGrant.objects.create(role=r, permission=p, scope="")
    access.forget()
    return r


def person(username, role=None, legacy=Role.SALES_EXECUTIVE, first=""):
    u = User.objects.create_user(username, f"{username}@x.com", "pass@12345", role=legacy, first_name=first or username.title())
    if role:
        UserAccessRole.objects.create(user=u, role=role)
    return u


class Base(TestCase):
    def setUp(self):
        from tenancy import company_settings, profile
        cache.clear()
        access.forget()
        company_settings.forget()   # settings saved by another test are rolled back, not their cache
        profile.forget()
        self.guard_role = role_with("guard", "attendance.punch", "attendance.self", "notifications.view", "visitors.gate")
        self.member_role = role_with("member_x", "tasks.view_own", "visitors.invite")
        self.admin = person("boss", legacy=Role.ADMIN)
        self.guard = person("ramesh", self.guard_role)
        self.host = person("neha", self.member_role, first="Neha")
        self.other = person("amit", self.member_role)

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def check_in(self, **extra):
        body = {"mobile": "98765 43210", "name": "Ravi Kumar", "company": "ABC Ltd", "purpose": "Meeting",
                "host": self.host.pk, "photo": jpeg(), **extra}
        return self.api(self.guard).post("/api/visitors/visits/", body, format="json")


class PermissionTests(Base):
    def test_guard_can_gate_member_cannot(self):
        self.assertEqual(self.check_in().status_code, 201)
        res = self.api(self.other).post("/api/visitors/visits/", {"mobile": "9876543210", "name": "X"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.api(self.other).get("/api/visitors/vehicles/").status_code, 403)

    def test_view_all_sees_register_and_activity_guard_does_not(self):
        self.check_in()
        self.assertEqual(self.api(self.admin).get("/api/visitors/activity/").status_code, 200)
        self.assertEqual(self.api(self.guard).get("/api/visitors/activity/").status_code, 403)
        self.assertEqual(self.api(self.guard).get("/api/visitors/settings/").status_code, 403)
        self.assertEqual(self.api(self.admin).get("/api/visitors/settings/").status_code, 200)

    def test_host_sees_only_own_visitors(self):
        self.check_in()
        self.assertEqual(self.api(self.host).get("/api/visitors/visits/?scope=mine").data["count"], 1)
        self.assertEqual(self.api(self.other).get("/api/visitors/visits/").data["count"], 0)

    def test_admin_and_member_roles_get_visitors_from_the_catalogue(self):
        caps = set(self.api(self.admin).get("/api/auth/me").data["capabilities"])
        self.assertTrue({"visitors.gate", "visitors.view_all", "visitors.settings", "visitors.invite"} <= caps)
        self.assertEqual(access.upgrade_grants({"tasks.view": "own"}, 1, from_version=2),
                         {"tasks.view": "own", "visitors.invite": ""}, "version 3 adds only its own rules")


class GateTests(Base):
    def test_check_in_out_and_time_inside(self):
        res = self.check_in()
        self.assertEqual(res.data["status"], "inside")
        self.assertTrue(res.data["pass_no"].startswith("V"))
        v = Visit.objects.get()
        self.assertTrue(v.photo.name.startswith("private/") or "/private/" in v.photo.name)
        self.assertTrue(Notification.objects.filter(user=self.host, type="visitor_arrived").exists())
        Visit.objects.filter(pk=v.pk).update(check_in_at=timezone.now() - timedelta(minutes=95))
        out = self.api(self.guard).post("/api/visitors/visits/checkout_pass/", {"code": f"KPV:{v.pass_token}"}, format="json")
        self.assertEqual(out.status_code, 200, out.data)
        self.assertEqual(out.data["status"], "out")
        self.assertEqual(out.data["minutes_inside"], 95)

    def test_photo_required_and_full_id_refused(self):
        self.assertIn("photo", self.check_in(photo="").data)
        res = self.check_in(id_type="Aadhaar", id_last4="123456789012")
        self.assertEqual(res.status_code, 400)
        self.assertIn("id_last4", res.data)
        self.assertEqual(self.check_in(id_type="Aadhaar", id_last4="9012").data["id_last4"], "9012")

    def test_returning_visitor_is_found_by_mobile(self):
        self.check_in()
        res = self.api(self.guard).get("/api/visitors/lookup/?mobile=9876543210")
        self.assertTrue(res.data["found"])
        self.assertEqual(res.data["name"], "Ravi Kumar")
        self.assertTrue(res.data["has_photo"])

    def test_host_approval_on_host_allows(self):
        conf.save({**conf.get(), "host_approval": True})
        v = self.check_in().data
        self.assertEqual(v["status"], "waiting_host")
        self.assertEqual(self.api(self.guard).get("/api/badges/").data["visitors"]["approvals"], 0)
        self.assertEqual(self.api(self.host).get("/api/badges/").data["visitors"]["approvals"], 1)
        self.assertEqual(self.api(self.other).post(f"/api/visitors/visits/{v['id']}/decide/", {"decision": "allow"}, format="json").status_code, 404)
        res = self.api(self.host).post(f"/api/visitors/visits/{v['id']}/decide/", {"decision": "allow"}, format="json")
        self.assertEqual(res.data["status"], "inside")

    def test_edit_is_audited_with_before_and_after(self):
        v = self.check_in().data
        self.api(self.guard).patch(f"/api/visitors/visits/{v['id']}/", {"company": "XYZ Pvt"}, format="json")
        log = GateLog.objects.filter(action=GateAction.VISIT_EDIT).get()
        self.assertEqual(log.changes["company"], ["ABC Ltd", "XYZ Pvt"])
        self.assertEqual(log.actor, self.guard)


class VehicleTests(Base):
    def test_vehicle_in_out_duration_and_photo_required(self):
        api = self.api(self.guard)
        res = api.post("/api/visitors/vehicles/", {"number": "MH 12 AB 1234", "type": "car"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("photo", res.data)
        res = api.post("/api/visitors/vehicles/", {"number": "MH 12 AB 1234", "type": "truck", "driver_name": "Sunil",
                                                    "photo": jpeg()}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["number"], "MH12AB1234")
        dup = api.post("/api/visitors/vehicles/", {"number": "MH12AB1234", "photo": jpeg()}, format="json")
        self.assertEqual(dup.status_code, 400)
        VehicleEntry.objects.update(in_at=timezone.now() - timedelta(minutes=42))
        out = api.post(f"/api/visitors/vehicles/{res.data['id']}/checkout/", {}, format="json")
        self.assertEqual(out.data["minutes_inside"], 42)
        self.assertFalse(out.data["inside"])
        self.assertEqual(api.get(f"/api/visitors/vehicles/{res.data['id']}/photo/in/").status_code, 200)
        self.assertEqual(GateLog.objects.filter(action__in=["vehicle_in", "vehicle_out"], actor=self.guard).count(), 2)


class OpenLinkTests(Base):
    def setUp(self):
        super().setUp()
        self.link = services.the_link()
        self.url = f"/api/visitors/public/main/{self.link.token}/"
        self.body = {"name": "Priya", "mobile": "9123456789", "company": "Acme", "purpose": "Interview",
                     "host_name": "Neha", "people": 2, "consent": True}

    def test_valid_token_creates_waiting_visit_and_leaks_nothing(self):
        form = APIClient().get(self.url)
        self.assertEqual(form.status_code, 200)
        self.assertNotIn("hosts", form.data)
        res = APIClient().post(self.url, self.body, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(set(res.data), {"code"})
        v = Visit.objects.get()
        self.assertEqual((v.status, v.short_code, v.host), ("waiting", res.data["code"], self.host))
        self.assertEqual(self.api(self.guard).get("/api/badges/").data["visitors"]["waiting"], 1)
        # The guard checks them in.
        acc = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/accept/", {"photo": jpeg()}, format="json")
        self.assertEqual(acc.data["status"], "inside")
        self.assertTrue(GateLog.objects.filter(action=GateAction.OPEN_ACCEPT, actor=self.guard).exists())

    def test_wrong_or_regenerated_token_is_404(self):
        self.assertEqual(APIClient().get("/api/visitors/public/main/not-a-real-token-xyz/").status_code, 404)
        self.api(self.admin).post("/api/visitors/link/", {"regenerate": True}, format="json")
        self.assertEqual(APIClient().post(self.url, self.body, format="json").status_code, 404)
        self.assertEqual(self.api(self.guard).post("/api/visitors/link/", {"regenerate": True}, format="json").status_code, 403)

    def test_module_off_is_404(self):
        with mock.patch("tenancy.profile.module_on", return_value=False):
            self.assertEqual(APIClient().get(self.url).status_code, 404)

    def test_open_link_switched_off_is_404(self):
        conf.save({**conf.get(), "open_link": False})
        self.assertEqual(APIClient().post(self.url, self.body, format="json").status_code, 404)

    def test_rate_limit_per_address(self):
        codes = [APIClient().post(self.url, {**self.body, "mobile": f"91234567{i:02d}"}, format="json").status_code
                 for i in range(services_limit() + 1)]
        self.assertEqual(codes[-1], 429)
        self.assertEqual(Visit.objects.count(), services_limit())

    def test_honeypot_saves_nothing(self):
        res = APIClient().post(self.url, {**self.body, "website": "http://spam"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Visit.objects.count(), 0)

    def test_consent_and_photo_size(self):
        self.assertIn("consent", APIClient().post(self.url, {**self.body, "consent": False}, format="json").data)
        big = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"0" * 700_000).decode()
        self.assertIn("photo", APIClient().post(self.url, {**self.body, "photo": big}, format="json").data)


def services_limit():
    from . import views
    return views.PER_IP_HOUR


class JobTests(Base):
    def test_overstay_alert_once_to_guard_and_host(self):
        v = self.check_in().data
        Visit.objects.filter(pk=v["id"]).update(check_in_at=timezone.now() - timedelta(hours=5))
        self.assertEqual(services.overstay_alerts(), 1)
        self.assertEqual(services.overstay_alerts(), 0)
        self.assertTrue(Notification.objects.filter(user=self.guard, type="visitor_overstay").exists())
        self.assertTrue(Notification.objects.filter(user=self.host, type="visitor_overstay").exists())
        self.assertEqual(Notification.objects.get(user=self.guard, type="visitor_overstay").category, "visitors")

    def test_retention_deletes_photos_and_anonymises(self):
        self.check_in(id_type="PAN", id_last4="123F")
        old = timezone.now() - timedelta(days=200)
        Visit.objects.update(created_at=old)
        Visitor.objects.update(last_visit_at=old)
        GateLog.objects.update(at=old)
        services.retention_cleanup()
        v, p = Visit.objects.get(), Visitor.objects.get()
        self.assertTrue(v.anonymised and p.anonymised)
        self.assertEqual((v.mobile, v.id_last4, bool(v.photo), bool(p.photo)), ("", "", False, False))
        self.assertFalse(GateLog.objects.exclude(summary="").exists())


class InsideNowTests(Base):
    def test_roll_call_has_visitors_vehicles_and_employees(self):
        from hr.models import Attendance
        self.check_in()
        Attendance.objects.create(user=self.other, date=timezone.localdate(), check_in=timezone.now())
        data = self.api(self.guard).get("/api/visitors/inside/").data
        self.assertEqual((len(data["visitors"]), len(data["employees"])), (1, 1))
        res = self.api(self.admin).get("/api/visitors/inside/?export=csv")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Ravi Kumar", res.content)


import unittest  # noqa: E402
import uuid  # noqa: E402

from django.db import connection  # noqa: E402
from django.test import SimpleTestCase  # noqa: E402


@unittest.skipUnless(connection.vendor == "postgresql", "multi-company mode needs Postgres")
@override_settings(TENANCY="schemas")
class CompanyIsolationTests(SimpleTestCase):
    """The open QR link: one company's token never works with another company's code (each checked in its own schema)."""
    databases = {"default"}
    A, B = "co_vis_a_t", "co_vis_b_t"

    @classmethod
    def setUpClass(cls):
        from tenancy import schemas
        super().setUpClass()
        schemas.ensure_registry()
        cls.ids = (str(uuid.uuid4()), str(uuid.uuid4()))
        for cid, schema in zip(cls.ids, (cls.A, cls.B)):
            schemas.create_company(cid, schema, schema)
        with schemas.use(cls.A):
            cls.token_a = services.the_link().token
        with schemas.use(cls.B):
            cls.token_b = services.the_link().token

    @classmethod
    def tearDownClass(cls):
        from tenancy import schemas
        with connection.cursor() as cur:
            for schema in (cls.A, cls.B):
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            cur.execute(f"DELETE FROM {schemas.REGISTRY} WHERE company_id::text IN (%s, %s)", list(cls.ids))
        schemas._cache.clear()
        super().tearDownClass()

    def test_token_only_works_with_its_own_company(self):
        from tenancy import schemas
        cache.clear()
        body = {"name": "Priya", "mobile": "9123456789", "host_name": "Someone", "consent": True}
        self.assertEqual(APIClient().get(f"/api/visitors/public/vis_a_t/{self.token_a}/").status_code, 200)
        self.assertEqual(APIClient().get(f"/api/visitors/public/vis_b_t/{self.token_a}/").status_code, 404)
        self.assertEqual(APIClient().get(f"/api/visitors/public/nobody_t/{self.token_a}/").status_code, 404)
        self.assertEqual(APIClient().post(f"/api/visitors/public/vis_b_t/{self.token_b}/", body, format="json").status_code, 201)
        with schemas.use(self.A):
            self.assertEqual(Visit.objects.count(), 0)
        with schemas.use(self.B):
            self.assertEqual(Visit.objects.count(), 1)
            Visit.objects.all().delete()
            Visitor.objects.all().delete()
