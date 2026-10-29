"""Visitors V4 (PLAN.md §22.11): 4-digit codes, device binding, the check-out QR, whom to meet + where to wait."""
import hashlib
import re
import unittest
import uuid
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.db import connection
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification

from . import conf, services, services_v4
from .models import GateAction, GateLog, Visit, Visitor
from .tests import Base, jpeg, person

CODE = re.compile(r"^\d{4}$")


class V4Base(Base):
    def setUp(self):
        super().setUp()
        self.link = services.the_link()
        self.url = f"/api/visitors/public/main/{self.link.token}/"
        self.out_url = f"/api/visitors/public/main/out/{self.link.checkout_token}/"
        self.body = {"name": "Priya Shah", "mobile": "9123456789", "company": "Acme", "purpose": "Interview",
                     "host": self.host.pk, "consent": True, "photo": jpeg()}

    def sign_in(self, **extra):
        res = APIClient().post(self.url, {**self.body, **extra}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return res

    def phone(self, device):
        c = APIClient()
        c.credentials(HTTP_X_VISITOR_DEVICE=device)
        return c

    def approve(self, code):
        found = self.api(self.guard).get(f"/api/visitors/visits/code/?code={code}")
        self.assertEqual(found.status_code, 200, found.data)
        self.assertEqual(found.data["kind"], "checkin")
        vid = found.data["visit"]["id"]
        res = self.api(self.guard).post(f"/api/visitors/visits/{vid}/accept/", {"via": "code"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        return res.data


class CheckInCodeTests(V4Base):
    def test_sign_in_gives_a_4_digit_code_pending_until_the_guard_approves(self):
        res = self.sign_in()
        self.assertRegex(res.data["code"], CODE)
        v = Visit.objects.get()
        self.assertEqual((v.status, v.short_code, v.host), ("waiting", res.data["code"], self.host))
        self.assertAlmostEqual((v.code_expires_at - timezone.now()).total_seconds() / 60, 120, delta=1)
        # Only a hash of the device secret is kept; the cookie copy is httpOnly and scoped to the visitor API.
        self.assertEqual(v.device_hash, hashlib.sha256(res.data["device"].encode()).hexdigest())
        self.assertNotIn(res.data["device"], str(Visit.objects.values().get()))
        cookie = res.cookies["kpv_main"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], "/tasks/api/visitors/public/")
        # The phone sees its own pending visit; the guard approves it with the code.
        state = self.phone(res.data["device"]).get("/api/visitors/public/main/device/").data
        self.assertEqual((state["state"], state["code"], state["first_name"]), ("pending", res.data["code"], "Priya"))
        row = self.approve(res.data["code"])
        self.assertEqual((row["status"], row["check_in_via"]), ("inside", "code"))
        self.assertTrue(GateLog.objects.filter(action=GateAction.CODE_APPROVE, actor=self.guard).exists())
        self.assertEqual(self.phone(res.data["device"]).get("/api/visitors/public/main/device/").data["state"], "inside")

    def test_code_is_single_use(self):
        code = self.sign_in().data["code"]
        self.approve(code)
        again = self.api(self.guard).get(f"/api/visitors/visits/code/?code={code}")
        self.assertEqual(again.status_code, 400)

    def test_codes_are_unique_among_pending_check_ins_and_check_outs(self):
        taken = self.sign_in().data["code"]
        Visit.objects.create(visitor=Visitor.objects.get(), name="X", status="inside", checkout_code="0042",
                             checkout_requested_at=timezone.now(),
                             checkout_code_expires_at=timezone.now() + timedelta(minutes=30))
        with mock.patch("visitors.services_v4.secrets.randbelow", side_effect=[int(taken), 42, 7]):
            self.assertEqual(services_v4.new_code(), "0007")
        # An expired code is free again.
        Visit.objects.filter(short_code=taken).update(code_expires_at=timezone.now() - timedelta(minutes=1))
        with mock.patch("visitors.services_v4.secrets.randbelow", return_value=int(taken)):
            self.assertEqual(services_v4.new_code(), taken)
        codes = {self.sign_in(mobile=f"90000000{i:02d}").data["code"] for i in range(8)}
        self.assertEqual(len(codes), 8)
        self.assertTrue(all(CODE.match(c) for c in codes))

    def test_expired_code_does_not_work_and_the_worker_closes_the_visit(self):
        code = self.sign_in().data["code"]
        Visit.objects.update(code_expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/visits/code/?code={code}").status_code, 400)
        self.assertEqual(services_v4.expire_codes(), 1)
        self.assertEqual(Visit.objects.get().status, "no_show")

    def test_wrong_codes_are_rate_limited_per_guard_and_say_nothing(self):
        code = self.sign_in().data["code"]
        wrong = "0000" if code != "0000" else "1111"
        answers = [self.api(self.guard).get(f"/api/visitors/visits/code/?code={wrong}") for _ in range(10)]
        self.assertTrue(all(a.status_code == 400 for a in answers))
        self.assertEqual({str(a.data["code"]) for a in answers}, {services_v4.NO_CODE})
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/visits/code/?code={code}").status_code, 429)
        self.assertEqual(GateLog.objects.filter(action=GateAction.CODE_MISS).count(), 10)
        # Another guard is not locked out; nobody without the gate permission can look codes up.
        guard2 = person("suresh", self.guard_role)
        self.assertEqual(self.api(guard2).get(f"/api/visitors/visits/code/?code={code}").status_code, 200)
        self.assertEqual(self.api(self.other).get(f"/api/visitors/visits/code/?code={code}").status_code, 403)

    def test_turn_away_after_code_never_pings_the_host(self):
        self.sign_in()
        v = Visit.objects.get()
        self.assertFalse(Notification.objects.filter(user=self.host).exists(), "not asked at submit")
        self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/reject/", {"reason": "No appointment"}, format="json")
        self.assertFalse(Notification.objects.filter(user=self.host).exists())

    def test_walk_in_needs_no_code(self):
        res = self.check_in()
        self.assertEqual((res.data["status"], res.data["check_in_via"]), ("inside", "gate"))


class HostAnswerTests(V4Base):
    def test_host_is_asked_at_approval_and_the_answer_reaches_the_guard(self):
        signed = self.sign_in().data
        self.approve(signed["code"])
        v = Visit.objects.get()
        n = Notification.objects.get(user=self.host)
        self.assertEqual((n.category, n.link), ("visitors", f"/visitors/answer?visit={v.pk}"))
        self.assertTrue(v.host_notified_at)
        # Only the host answers, with a place from the company's list.
        self.assertEqual(self.api(self.other).post(f"/api/visitors/visits/{v.pk}/answer/", {"answer": "coming"},
                                                   format="json").status_code, 404)
        bad = self.api(self.host).post(f"/api/visitors/visits/{v.pk}/answer/", {"answer": "place", "place": "Roof"},
                                       format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.api(self.host).post(f"/api/visitors/visits/{v.pk}/answer/",
                                      {"answer": "place", "place": "meeting room 1", "note": "5 min"}, format="json")
        self.assertEqual((ok.data["host_answer"], ok.data["host_place"]), ("place", "Meeting room 1"))
        self.assertTrue(Notification.objects.filter(user=self.guard, type="visitor_host_answer").exists())
        gate = self.api(self.guard).get("/api/visitors/visits/?scope=today").data["results"][0]
        self.assertEqual((gate["host_place"], gate["host_note"]), ("Meeting room 1", "5 min"))
        sent = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/sent_to_place/")
        self.assertTrue(sent.data["sent_to_place_at"])
        self.assertTrue(GateLog.objects.filter(action=GateAction.SENT_TO_PLACE).exists())
        # The visitor's phone shows where to wait (the place only, never the host's note).
        state = self.phone(signed["device"]).get("/api/visitors/public/main/device/").data
        self.assertEqual(state["where"], "Please wait at Meeting room 1.")
        self.assertNotIn("5 min", str(state))

    def test_no_answer_shows_call_host_to_the_gate_only(self):
        self.host.whatsapp_phone = "919812345678"
        self.host.save()
        self.approve(self.sign_in().data["code"])
        Visit.objects.update(host_notified_at=timezone.now() - timedelta(minutes=6))
        gate = self.api(self.guard).get("/api/visitors/visits/?scope=today").data["results"][0]
        self.assertEqual((gate["host_no_answer"], gate["host_phone"]), (True, "919812345678"))
        mine = self.api(self.host).get("/api/visitors/visits/?scope=mine").data["results"][0]
        self.assertEqual(mine["host_phone"], "")

    @override_settings(WHATSAPP_HOURS="0-24")
    def test_whatsapp_template_sent_when_configured(self):
        self.host.whatsapp_phone = "919812345678"
        self.host.save()
        # (the visitor's own pass link is another message: off here)
        conf.save({**conf.get(), "host_wa_template": "visitor_waiting", "send_pass": False})
        sent = {"channel": "whatsapp", "status": "sent", "detail": ""}
        with mock.patch("notifications.channels.whatsapp.send_template", return_value=sent) as tpl, \
                mock.patch("notifications.channels.whatsapp.send_text") as txt:
            self.approve(self.sign_in().data["code"])
        v = Visit.objects.get()
        tpl.assert_called_once()
        args, kwargs = tpl.call_args
        self.assertEqual(args[:2], ("919812345678", "visitor_waiting"))
        self.assertEqual(args[2], ["Neha", "Priya Shah", "Acme", "Interview"])
        self.assertEqual(kwargs["url_button"], f"visitors/answer?visit={v.pk}")
        txt.assert_not_called()

    def test_no_template_means_in_app_only(self):
        self.host.whatsapp_phone = "919812345678"
        self.host.save()
        conf.save({**conf.get(), "send_pass": False})
        with mock.patch("notifications.channels.whatsapp.send_template") as tpl, \
                mock.patch("notifications.channels.whatsapp.send_text") as txt:
            self.approve(self.sign_in().data["code"])
        tpl.assert_not_called()
        txt.assert_not_called()
        n = Notification.objects.get(user=self.host)
        self.assertEqual([c["status"] for c in n.channels if c["channel"] == "whatsapp"], ["skipped"])


class CheckoutTests(V4Base):
    def inside(self):
        res = self.sign_in()
        self.approve(res.data["code"])
        return res.data["device"]

    def test_right_device_requests_guard_approves(self):
        device = self.inside()
        page = self.phone(device).get(self.out_url)
        self.assertEqual(page.data["visit"]["state"], "inside")
        res = self.phone(device).post(self.out_url, {"rating": 5, "comment": "Quick and polite"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["state"], "leaving")
        self.assertRegex(res.data["code"], CODE)
        v = Visit.objects.get()
        self.assertEqual((v.status, v.feedback_rating, v.feedback_comment), ("inside", 5, "Quick and polite"))
        self.assertTrue(v.checkout_requested_at)
        # The same request again keeps the same code (no new code for a double tap).
        self.assertEqual(self.phone(device).post(self.out_url, {}, format="json").data["code"], res.data["code"])
        gate = self.api(self.guard).get("/api/visitors/visits/?scope=today").data["results"][0]
        self.assertTrue(gate["checkout_pending"])
        found = self.api(self.guard).get(f"/api/visitors/visits/code/?code={res.data['code']}")
        self.assertEqual(found.data["kind"], "checkout")
        out = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/approve_checkout/")
        self.assertEqual((out.data["status"], out.data["checkout_via"], out.data["check_out_by"]), ("out", "qr", "Ramesh"))
        self.assertTrue(out.data["check_out_at"] and out.data["checkout_requested_at"])
        self.assertEqual(self.phone(device).get(self.out_url).data["visit"]["state"], "out")
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/visits/code/?code={res.data['code']}").status_code, 400)

    def test_cookie_copy_of_the_device_works_too(self):
        self.inside()
        v = Visit.objects.get()
        secret = "s" * 43
        Visit.objects.filter(pk=v.pk).update(device_hash=services_v4.hash_device(secret))
        c = APIClient()
        c.cookies["kpv_main"] = secret
        self.assertEqual(c.post(self.out_url, {}, format="json").data["state"], "leaving")

    def test_other_device_is_refused_and_sees_nothing(self):
        self.inside()
        for c in (APIClient(), self.phone("x" * 43)):
            res = c.post(self.out_url, {"rating": 1}, format="json")
            self.assertEqual(res.status_code, 403)
            self.assertEqual(res.data["code"], "other_device")
            self.assertNotIn("Priya", str(c.get(self.out_url).data))
            self.assertEqual(c.get(self.out_url).data["visit"], {"state": "none"})
        v = Visit.objects.get()
        self.assertEqual((v.status, v.feedback_rating, v.checkout_requested_at), ("inside", None, None))

    def test_hold_keeps_the_visit_inside(self):
        device = self.inside()
        self.phone(device).post(self.out_url, {}, format="json")
        v = Visit.objects.get()
        res = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/hold_checkout/", {"note": "Laptop not on pass"},
                                        format="json")
        self.assertEqual((res.data["status"], res.data["checkout_pending"], res.data["checkout_hold_note"]),
                         ("inside", False, "Laptop not on pass"))
        state = self.phone(device).get("/api/visitors/public/main/device/").data
        self.assertEqual(state["state"], "held")
        self.assertNotIn("Laptop", str(state), "the guard's note stays at the gate")
        self.assertEqual(self.phone(device).post(self.out_url, {}, format="json").data["state"], "leaving")

    def test_checkout_code_expires(self):
        device = self.inside()
        code = self.phone(device).post(self.out_url, {}, format="json").data["code"]
        Visit.objects.update(checkout_code_expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/visits/code/?code={code}").status_code, 400)
        self.assertEqual(self.phone(device).get("/api/visitors/public/main/device/").data["state"], "inside")

    def test_guard_can_still_check_out_directly(self):
        self.inside()
        v = Visit.objects.get()
        out = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/checkout/")
        self.assertEqual((out.data["status"], out.data["checkout_via"]), ("out", "guard"))
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/approve_checkout/").status_code, 400)

    def test_bad_rating_and_checkout_qr_switches(self):
        device = self.inside()
        self.assertEqual(self.phone(device).post(self.out_url, {"rating": 9}, format="json").status_code, 400)
        old = self.out_url
        self.assertEqual(self.api(self.guard).post("/api/visitors/link/", {"regenerate_checkout": True},
                                                   format="json").status_code, 403)
        link = self.api(self.admin).post("/api/visitors/link/", {"regenerate_checkout": True}, format="json").data
        self.assertTrue(link["checkout_path"].endswith("/out"))
        self.assertEqual(self.phone(device).get(old).status_code, 404)
        new = f"/api/visitors/public/main/out/{link['checkout_path'].split('/')[-2]}/"
        self.assertEqual(self.phone(device).get(new).status_code, 200)
        conf.save({**conf.get(), "checkout_qr": False})
        self.assertEqual(self.phone(device).get(new).status_code, 404)
        with mock.patch("tenancy.profile.module_on", return_value=False):
            self.assertEqual(self.phone(device).get("/api/visitors/public/main/device/").status_code, 404)


class PublicLeakTests(V4Base):
    def test_people_list_shows_only_names_and_departments(self):
        self.host.email, self.host.whatsapp_phone = "neha@corp.com", "919800000000"
        self.host.save()
        res = APIClient().get(f"{self.url}hosts/?q=neh")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["mode"], "people")
        self.assertEqual(len(res.data["results"]), 1)
        self.assertEqual(set(res.data["results"][0]), {"id", "name", "department"})
        self.assertNotIn("neha@corp.com", str(res.data))
        self.assertNotIn("9198", str(res.data))
        self.assertEqual(APIClient().get(f"{self.url}hosts/?q=n").data["results"], [], "2 letters at least")
        self.assertEqual(APIClient().get(f"/api/visitors/public/main/{'z' * 22}/hosts/?q=neh").status_code, 404)

    def test_departments_and_off_modes(self):
        conf.save({**conf.get(), "public_host_list": "departments"})
        res = APIClient().get(f"{self.url}hosts/?q=neh").data
        self.assertTrue(res["results"] and all(set(r) == {"department"} for r in res["results"]))
        # A person id sent anyway is ignored: the guard picks the person.
        self.sign_in(host=self.host.pk, host_name="Human Resources")
        self.assertEqual((Visit.objects.get().host, Visit.objects.get().host_label), (None, "Human Resources"))
        conf.save({**conf.get(), "public_host_list": "off"})
        self.assertEqual(APIClient().get(f"{self.url}hosts/?q=neh").data["results"], [])

    def test_device_state_without_or_with_a_wrong_secret_is_empty(self):
        self.sign_in()
        self.assertEqual(APIClient().get("/api/visitors/public/main/device/").data, {"state": "none"})
        self.assertEqual(self.phone("q" * 43).get("/api/visitors/public/main/device/").data, {"state": "none"})

    def test_device_state_carries_nothing_private(self):
        res = self.sign_in()
        state = self.phone(res.data["device"]).get("/api/visitors/public/main/device/").data
        self.assertEqual(set(state), {"state", "first_name", "pass_no", "where", "code", "expires_at"})
        self.assertNotIn("9123456789", str(state))


@unittest.skipUnless(connection.vendor == "postgresql", "multi-company mode needs Postgres")
@override_settings(TENANCY="schemas")
class V4IsolationTests(SimpleTestCase):
    """A company's check-out QR and a visitor's device secret only work with their own company's code."""
    databases = {"default"}
    A, B = "co_vis4_a", "co_vis4_b"

    @classmethod
    def setUpClass(cls):
        from tenancy import schemas
        super().setUpClass()
        schemas.ensure_registry()
        cls.ids = (str(uuid.uuid4()), str(uuid.uuid4()))
        for cid, schema in zip(cls.ids, (cls.A, cls.B)):
            schemas.create_company(cid, schema, schema)
        with schemas.use(cls.A):
            cls.link_a = services.the_link()

    @classmethod
    def tearDownClass(cls):
        from tenancy import schemas
        with connection.cursor() as cur:
            for schema in (cls.A, cls.B):
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            cur.execute(f"DELETE FROM {schemas.REGISTRY} WHERE company_id::text IN (%s, %s)", list(cls.ids))
        schemas._cache.clear()
        super().tearDownClass()

    def test_checkout_qr_and_device_only_in_their_own_company(self):
        from tenancy import schemas
        cache.clear()
        body = {"name": "Pia", "mobile": "9123456789", "host_name": "Someone", "consent": True}
        res = APIClient().post(f"/api/visitors/public/vis4_a/{self.link_a.token}/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        device = res.data["device"]
        try:
            c = APIClient()
            c.credentials(HTTP_X_VISITOR_DEVICE=device)
            self.assertEqual(c.get("/api/visitors/public/vis4_a/device/").data["state"], "pending")
            self.assertEqual(c.get("/api/visitors/public/vis4_b/device/").data, {"state": "none"})
            token = self.link_a.checkout_token
            self.assertEqual(c.get(f"/api/visitors/public/vis4_a/out/{token}/").status_code, 200)
            self.assertEqual(c.get(f"/api/visitors/public/vis4_b/out/{token}/").status_code, 404)
        finally:
            with schemas.use(self.A):
                Visit.objects.all().delete()
                Visitor.objects.all().delete()


class V4SettingsAndReportsTests(V4Base):
    def test_device_secret_in_the_post_body_never_the_url(self):
        device = self.sign_in().data["device"]
        res = APIClient().post("/api/visitors/public/main/device/", {"device": device}, format="json")
        self.assertEqual(res.data["state"], "pending")
        self.assertEqual(res["Cache-Control"], "no-store")

    def test_settings_validate_v4_values(self):
        api = self.api(self.admin)
        bad = api.put("/api/visitors/settings/", {"host_wa_template": "Visitor Waiting!", "code_minutes": 5,
                                                  "waiting_places": [], "public_host_list": "all"}, format="json")
        self.assertEqual(set(bad.data), {"host_wa_template", "code_minutes", "waiting_places", "public_host_list"})
        ok = api.put("/api/visitors/settings/", {"host_wa_template": "visitor_waiting", "code_minutes": 30,
                                                 "waiting_places": ["Lobby", "lobby", "Cafe"]}, format="json")
        self.assertEqual((ok.data["code_minutes"], ok.data["waiting_places"]), (30, ["Lobby", "Cafe"]))
        cfg = self.api(self.host).get("/api/visitors/config/").data
        self.assertEqual(cfg["waiting_places"], ["Lobby", "Cafe"])
        self.assertNotIn("host_wa_template", cfg)

    def test_link_has_both_qrs_and_reports_count_v4(self):
        link = self.api(self.guard).get("/api/visitors/link/").data
        self.assertEqual(link["checkout_path"], f"/v/main/{self.link.checkout_token}/out")
        res = self.sign_in()
        self.approve(res.data["code"])
        self.phone(res.data["device"]).post(self.out_url, {"rating": 4}, format="json")
        v = Visit.objects.get()
        self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/approve_checkout/")
        t = self.api(self.admin).get("/api/visitors/reports/").data["totals"]
        self.assertEqual((t["code_check_ins"], t["qr_check_outs"], t["feedback"], t["avg_rating"]), (1, 1, 1, 4))
        csv = self.api(self.admin).get("/api/visitors/visits/?export=csv")
        self.assertIn(b"Rating", csv.content)
