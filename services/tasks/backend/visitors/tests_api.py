"""The read-only Vehicle API (PLAN.md §22.12): keys, endpoints, limits, company isolation."""
import re
import shutil
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.core.files.base import ContentFile
from django.db import connection
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Department

from . import services, vehicle_api
from .models import GateAction, GateLog, VehicleApiKey, VehicleEntry, Visit, Visitor
from .tests import Base, person, role_with

IST = ZoneInfo("Asia/Kolkata")
ROOT = "/api/visitors/v1"
JPEG = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
BAD = {"error": {"code": "unauthorized", "message": "The API key is missing or not valid."}}


def ist(*args):
    return datetime(*args, tzinfo=IST)


class ApiBase(Base):
    def setUp(self):
        super().setUp()
        self.row, self.key = vehicle_api.make_key("Senior manager", self.admin)

    def call(self, path, key=None, method="get", **extra):
        c = APIClient()
        if key is not False:
            c.credentials(HTTP_AUTHORIZATION=f"Bearer {key or self.key}")
        return getattr(c, method)(f"{ROOT}{path}", **extra)

    def entry(self, number="MH12AB1234", **kw):
        return VehicleEntry.objects.create(number=number, in_by=self.guard, **kw)


class KeyManagementTests(Base):
    def test_full_key_shown_once_only_the_hash_is_kept(self):
        res = self.api(self.admin).post("/api/visitors/api-keys/", {"name": " Senior  manager "}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        key = res.data["key"]
        self.assertRegex(key, r"^kpv_main_[A-Za-z0-9]{40}$")
        self.assertEqual(res["Cache-Control"], "no-store")
        row = VehicleApiKey.objects.get()
        self.assertEqual((row.name, row.scope, row.created_by), ("Senior manager", "vehicles:read", self.admin))
        self.assertEqual(row.key_hash, vehicle_api.hash_key(key))
        self.assertEqual(row.prefix, key.split("_")[-1][:8])
        secret = key.split("_")[-1]
        stored = [str(v) for v in VehicleApiKey.objects.values().get().values()]
        self.assertFalse([v for v in stored if secret in v])
        listed = self.api(self.admin).get("/api/visitors/api-keys/")
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn("key", listed.data[0])
        self.assertNotIn(secret, str(listed.data))
        self.assertEqual(listed.data[0]["state"], "active")
        self.assertTrue(listed.data[0]["hint"].startswith(f"kpv_main_{row.prefix}"))
        self.assertTrue(GateLog.objects.filter(action=GateAction.API_KEY, actor=self.admin, summary__contains="made").exists())
        self.assertFalse(GateLog.objects.filter(summary__contains=secret).exists())

    def test_name_is_required_and_expiry_must_be_in_the_future(self):
        api = self.api(self.admin)
        self.assertIn("name", api.post("/api/visitors/api-keys/", {"name": "  "}, format="json").data)
        self.assertIn("expires_at", api.post("/api/visitors/api-keys/", {"name": "x", "expires_at": "2020-01-01"}, format="json").data)
        self.assertIn("expires_at", api.post("/api/visitors/api-keys/", {"name": "x", "expires_at": "soon"}, format="json").data)
        res = api.post("/api/visitors/api-keys/", {"name": "x", "expires_at": "2099-03-31"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["expires_at"].startswith("2099-03-31T23:59:59+05:30"))

    def test_only_owner_or_admin_manage_keys(self):
        # The visitor settings permission alone (a security head) is not enough: only level 3 roles.
        head = person("head", role_with("security_head", "visitors.settings", "visitors.view_all", "visitors.gate"))
        row, _key = vehicle_api.make_key("x", self.admin)
        for who in (self.guard, self.host, head):
            api = self.api(who)
            self.assertEqual(api.get("/api/visitors/api-keys/").status_code, 403)
            self.assertEqual(api.post("/api/visitors/api-keys/", {"name": "x"}, format="json").status_code, 403)
            self.assertEqual(api.post(f"/api/visitors/api-keys/{row.pk}/revoke/").status_code, 403)
        self.assertEqual(APIClient().get("/api/visitors/api-keys/").status_code, 401)
        self.assertEqual(VehicleApiKey.objects.count(), 1)
        self.assertIs(self.api(head).get("/api/visitors/config/").data["can"]["api_keys"], False)
        self.assertIs(self.api(self.admin).get("/api/visitors/config/").data["can"]["api_keys"], True)

    def test_revoke_is_logged_and_stops_the_key(self):
        row, key = vehicle_api.make_key("x", self.admin)
        res = self.api(self.admin).post(f"/api/visitors/api-keys/{row.pk}/revoke/")
        self.assertEqual((res.status_code, res.data["state"], res.data["revoked_by"]), (200, "revoked", self.admin.get_full_name() or "boss"))
        first = VehicleApiKey.objects.get(pk=row.pk).revoked_at
        self.api(self.admin).post(f"/api/visitors/api-keys/{row.pk}/revoke/")
        self.assertEqual(VehicleApiKey.objects.get(pk=row.pk).revoked_at, first)
        self.assertEqual(GateLog.objects.filter(action=GateAction.API_KEY, summary__contains="revoked").count(), 1)
        c = APIClient()
        c.credentials(HTTP_X_API_KEY=key)
        self.assertEqual(c.get(f"{ROOT}/vehicles/").status_code, 401)
        self.assertEqual(self.api(self.admin).post("/api/visitors/api-keys/99999/revoke/").status_code, 404)


class RecordTests(ApiBase):
    def test_every_field_of_a_movement(self):
        from hr.models import OfficeLocation
        gate = OfficeLocation.objects.create(name="Main gate", latitude=1, longitude=1)
        self.host.department = Department.choices[0][0]
        self.host.save()
        e = self.entry(type="truck", driver_name="Sunil", driver_mobile="9876543210", purpose="Delivery", company="ABC Ltd",
                       items="20 boxes", parking_slot="B4", notes="Blue tarp", location=gate,
                       in_at=ist(2026, 11, 2, 9, 0), out_at=ist(2026, 11, 2, 10, 30), out_by=self.admin)
        visitor = Visitor.objects.create(name="Ravi", mobile="9000000001")
        visit = Visit.objects.create(visitor=visitor, name="Ravi", mobile="9000000001", host=self.host, people=2, vehicle=e, vehicle_no=e.number)
        res = self.call(f"/vehicles/{e.pk}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotIn("Set-Cookie", res.headers)
        d = res.json()
        self.assertEqual(d["id"], e.pk)
        self.assertEqual(d["vehicle_number"], "MH12AB1234")
        self.assertEqual((d["type"], d["type_label"]), ("truck", "Truck"))
        self.assertEqual((d["driver_name"], d["driver_mobile"]), ("Sunil", "9876543210"))
        self.assertEqual((d["company"], d["purpose"], d["items"], d["notes"], d["parking_slot"]), ("ABC Ltd", "Delivery", "20 boxes", "Blue tarp", "B4"))
        self.assertEqual(d["in_time"], "2026-11-02T09:00:00+05:30")
        self.assertEqual(d["out_time"], "2026-11-02T10:30:00+05:30")
        self.assertEqual((d["minutes_inside"], d["status"]), (90, "out"))
        self.assertEqual(d["gate"], {"id": gate.pk, "name": "Main gate"})
        self.assertEqual(d["checked_in_by"], self.guard.get_full_name() or "ramesh")
        self.assertEqual(d["checked_out_by"], self.admin.get_full_name() or "boss")
        self.assertEqual(d["host"], {"name": self.host.get_full_name(), "department": self.host.get_department_display()})
        self.assertEqual(d["visitor_names"], ["Ravi"])
        self.assertEqual(d["visits"], [{"id": visit.pk, "visitor_name": "Ravi", "people": 2, "host": d["host"]}])
        self.assertEqual(d["photos"], {"in": None, "out": None})
        self.assertIs(d["anonymised"], False)
        self.assertIn("+05:30", d["updated_at"])
        # Nothing of the visitor beyond the name: no mobile, no ID, no pass.
        self.assertNotIn("9000000001", res.content.decode())

    def test_retention_shows_the_row_as_stored(self):
        e = self.entry(driver_name="Sunil", driver_mobile="9876543210", in_at=timezone.now() - timedelta(days=2000))
        visitor = Visitor.objects.create(name="Ravi", mobile="9000000001")
        Visit.objects.create(visitor=visitor, name="Ravi", vehicle=e, created_at=timezone.now() - timedelta(days=2000))
        before = VehicleEntry.objects.get(pk=e.pk).updated_at
        services.retention_cleanup()
        d = self.call(f"/vehicles/{e.pk}/").json()
        self.assertIs(d["anonymised"], True)
        self.assertEqual((d["driver_name"], d["driver_mobile"]), ("", ""))
        self.assertEqual(d["visitor_names"], ["Visitor (removed)"])
        self.assertGreater(VehicleEntry.objects.get(pk=e.pk).updated_at, before)

    def test_not_found_is_json(self):
        for path in ("/vehicles/999999/", "/vehicles/abc/", "/nothing/", "/vehicles/999999/photos/in/", "/vehicles/1/photos/side/"):
            res = self.call(path)
            self.assertEqual(res.status_code, 404, path)
            self.assertEqual(res.json()["error"]["code"], "not_found")
        self.assertEqual(self.call("/nothing/", key=False).status_code, 401)

    def test_slash_is_optional(self):
        self.assertEqual(self.call("/vehicles").status_code, 200)
        self.assertEqual(self.call("/vehicles/inside").status_code, 200)


class ListTests(ApiBase):
    def setUp(self):
        super().setUp()
        self.a = self.entry("MH12AB1234", type="car", purpose="Meeting", in_at=ist(2026, 10, 1, 23, 30), out_at=ist(2026, 10, 2, 0, 30))
        self.b = self.entry("KA01CD5678", type="truck", purpose="Delivery", in_at=ist(2026, 10, 2, 0, 30))
        self.c = self.entry("MH14XY0001", type="bike", purpose="Delivery of goods", in_at=ist(2026, 10, 3, 12, 0), out_at=ist(2026, 10, 3, 13, 0))

    def ids(self, query=""):
        res = self.call(f"/vehicles/{query}")
        self.assertEqual(res.status_code, 200, res.content)
        return [r["id"] for r in res.json()["results"]]

    def test_shape_and_newest_first(self):
        d = self.call("/vehicles/").json()
        self.assertEqual(set(d), {"count", "next", "previous", "results"})
        self.assertEqual((d["count"], d["next"], d["previous"]), (3, None, None))
        self.assertEqual([r["id"] for r in d["results"]], [self.c.pk, self.b.pk, self.a.pk])

    def test_same_time_keeps_a_stable_order(self):
        same = self.entry("DL01AA0001", in_at=self.c.in_at)
        self.assertEqual(self.ids(), [same.pk, self.c.pk, self.b.pk, self.a.pk])

    def test_filters(self):
        self.assertEqual(self.ids("?status=inside"), [self.b.pk])
        self.assertEqual(self.ids("?status=out"), [self.c.pk, self.a.pk])
        self.assertEqual(self.ids("?status=all"), [self.c.pk, self.b.pk, self.a.pk])
        self.assertEqual(self.ids("?vehicle_number=mh-12 ab"), [self.a.pk])
        self.assertEqual(self.ids("?vehicle_number=MH"), [self.c.pk, self.a.pk])
        self.assertEqual(self.ids("?type=truck"), [self.b.pk])
        self.assertEqual(self.ids("?purpose=delivery"), [self.c.pk, self.b.pk])

    def test_dates_are_ist_and_the_end_date_takes_the_whole_day(self):
        self.assertEqual(self.ids("?from=2026-10-02&to=2026-10-02"), [self.b.pk])
        self.assertEqual(self.ids("?to=2026-10-01"), [self.a.pk])
        self.assertEqual(self.ids("?from=2026-10-03"), [self.c.pk])
        self.assertEqual(self.ids("?from=2026-10-01T23:30:00%2B05:30&to=2026-10-02T00:00:00"), [self.a.pk])
        # A "+" someone forgot to encode reads as a space.
        self.assertEqual(self.ids("?from=2026-10-03T12:00:00+05:30"), [self.c.pk])
        # Another offset is honoured: 18:00 UTC on 1 Oct is 23:30 IST.
        self.assertEqual(self.ids("?from=2026-10-01T18:00:01Z&to=2026-10-02"), [self.b.pk])

    def test_updated_since_for_incremental_sync(self):
        self.assertEqual(self.ids("?updated_since=2099-01-01"), [])
        mark = timezone.now().isoformat().replace("+00:00", "Z")
        self.assertEqual(self.ids(f"?updated_since={mark}"), [])
        self.b.out_at = timezone.now()
        self.b.save()
        self.assertEqual(self.ids(f"?updated_since={mark}"), [self.b.pk])

    def test_a_visit_change_counts_as_an_update(self):
        visitor = Visitor.objects.create(name="Ravi", mobile="9000000001")
        visit = Visit.objects.create(visitor=visitor, name="Ravi", vehicle=self.a, status="inside")
        mark = timezone.now().isoformat().replace("+00:00", "Z")
        res = self.api(self.admin).patch(f"/api/visitors/visits/{visit.pk}/", {"name": "Ravi Kumar"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(self.ids(f"?updated_since={mark}"), [self.a.pk])

    def test_bad_values_are_refused(self):
        for query in ("?from=yesterday", "?to=2026-13-45", "?updated_since=x", "?status=gone", "?type=plane", "?vehicle_number=---",
                      "?page=0", "?page=x", "?page_size=-1", "?page=99999999"):
            res = self.call(f"/vehicles/{query}")
            self.assertEqual(res.status_code, 400, query)
            self.assertEqual(res.json()["error"]["code"], "bad_request")

    def test_query_text_is_never_sql_and_nul_is_harmless(self):
        self.assertEqual(self.ids("?purpose=x'%20OR%201=1--"), [])
        self.assertEqual(self.ids("?purpose=%00"), [self.c.pk, self.b.pk, self.a.pk])

    def test_pagination(self):
        d = self.call("/vehicles/?page_size=2&type=&status=all&api_key=nope", HTTP_X_FORWARDED_HOST="kaampilot.com").json()
        self.assertEqual((d["count"], len(d["results"]), d["previous"]), (3, 2, None))
        self.assertRegex(d["next"], r"^http://testserver/tasks/api/visitors/v1/vehicles/\?")
        self.assertIn("page=2", d["next"])
        self.assertIn("page_size=2", d["next"])
        self.assertIn("status=all", d["next"])
        self.assertNotIn("api_key", d["next"])
        d2 = self.call("/vehicles/?page_size=2&page=2").json()
        self.assertEqual((d2["next"], [r["id"] for r in d2["results"]]), (None, [self.a.pk]))
        self.assertRegex(d2["previous"], r"^http://testserver/api/visitors/v1/vehicles/\?.*page=1")
        # Past the end: empty, and "previous" goes to a page that has rows.
        d9 = self.call("/vehicles/?page_size=2&page=9").json()
        self.assertEqual((d9["count"], d9["results"], d9["next"]), (3, [], None))
        self.assertIn("page=2", d9["previous"])

    def test_page_size_is_capped(self):
        VehicleEntry.objects.bulk_create([VehicleEntry(number=f"AA{i:04d}") for i in range(205)])
        d = self.call("/vehicles/?page_size=999").json()
        self.assertEqual((d["count"], len(d["results"])), (208, 200))
        self.assertIn("page=2", d["next"])
        self.assertEqual(len(self.call("/vehicles/").json()["results"]), 50)

    def test_inside(self):
        d = self.call("/vehicles/inside/").json()
        self.assertEqual((d["count"], [r["id"] for r in d["results"]]), (1, [self.b.pk]))
        self.assertEqual(d["results"][0]["status"], "inside")
        self.assertGreater(d["results"][0]["minutes_inside"], 0)
        self.assertIsNone(d["results"][0]["out_time"])

    def test_list_does_not_query_per_row(self):
        for e in (self.a, self.b, self.c):
            Visit.objects.create(visitor=Visitor.objects.create(name="V", mobile=""), name="V", vehicle=e, host=self.host)
        with self.assertNumQueries(6):  # key, module switches, last used, count, rows, visits
            self.call("/vehicles/")


class SummaryTests(ApiBase):
    def test_summary(self):
        self.entry("MH12AA0001", type="car", in_at=ist(2026, 10, 1, 23, 30), out_at=ist(2026, 10, 2, 0, 30))   # 60
        self.entry("MH12AA0002", type="car", in_at=ist(2026, 10, 2, 0, 15), out_at=ist(2026, 10, 2, 3, 15))    # 180
        self.entry("MH12AA0003", type="truck", in_at=ist(2026, 10, 3, 9, 0))                                   # inside
        self.entry("MH12AA0004", type="bike", in_at=ist(2026, 10, 9, 9, 0))                                    # out of range
        res = self.call("/vehicles/summary/?from=2026-10-01&to=2026-10-04")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json(), {
            "from": "2026-10-01", "to": "2026-10-04", "entries": 3, "checked_out": 2, "still_inside": 1,
            "average_minutes_inside": 120, "longest_minutes_inside": 180,
            "per_day": [{"date": "2026-10-01", "count": 1}, {"date": "2026-10-02", "count": 1},
                        {"date": "2026-10-03", "count": 1}, {"date": "2026-10-04", "count": 0}],
            "per_type": [{"type": "car", "label": "Car", "count": 2}, {"type": "truck", "label": "Truck", "count": 1}],
        })

    def test_empty_and_defaults_to_30_days(self):
        d = self.call("/vehicles/summary/").json()
        self.assertEqual((d["entries"], d["average_minutes_inside"], d["longest_minutes_inside"]), (0, None, None))
        self.assertEqual(len(d["per_day"]), 30)
        self.assertEqual(d["to"], timezone.localtime(timezone=IST).date().isoformat())

    def test_range_checks(self):
        self.assertEqual(self.call("/vehicles/summary/?from=2026-10-05&to=2026-10-01").status_code, 400)
        res = self.call("/vehicles/summary/?from=2024-01-01&to=2026-10-01")
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (400, "range_too_long"))


class AuthTests(ApiBase):
    def bad_keys(self):
        secret = self.key.split("_")[-1]
        revoked, revoked_key = vehicle_api.make_key("gone", self.admin)
        revoked.revoked_at = timezone.now()
        revoked.save()
        expired, expired_key = vehicle_api.make_key("old", self.admin)
        expired.expires_at = timezone.now() - timedelta(minutes=1)
        expired.save()
        return {
            "malformed": "nonsense", "too long": "kpv_main_" + "a" * 200, "wrong prefix": f"xyz_main_{secret}",
            "wrong secret": "kpv_main_" + "a" * 40, "same prefix, wrong rest": f"kpv_main_{secret[:8]}" + "a" * 32,
            "other company code": f"kpv_other_{secret}", "bad code": f"kpv_../x_{secret}", "revoked": revoked_key,
            "expired": expired_key,
        }

    def test_every_bad_key_gets_the_same_401(self):
        answers = {name: self.call("/vehicles/", key=key) for name, key in self.bad_keys().items()}
        answers["no key"] = self.call("/vehicles/", key=False)
        for name, res in answers.items():
            self.assertEqual((res.status_code, res.json()), (401, BAD), name)
            self.assertEqual(res["WWW-Authenticate"], "Bearer", name)

    def test_both_headers_work(self):
        self.assertEqual(self.call("/vehicles/").status_code, 200)
        c = APIClient()
        c.credentials(HTTP_X_API_KEY=self.key)
        self.assertEqual(c.get(f"{ROOT}/vehicles/").status_code, 200)
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"bearer {self.key}")
        self.assertEqual(c.get(f"{ROOT}/vehicles/").status_code, 200)

    def test_a_key_in_the_url_does_not_count(self):
        for query in (f"?key={self.key}", f"?api_key={self.key}", f"?token={self.key}", f"?authorization=Bearer%20{self.key}"):
            self.assertEqual(self.call(f"/vehicles/{query}", key=False).status_code, 401)

    def test_a_person_s_sign_in_does_not_open_the_api(self):
        res = self.api(self.admin).get(f"{ROOT}/vehicles/")
        self.assertEqual(res.status_code, 401)

    def test_only_get(self):
        e = self.entry()
        for path in ("/vehicles/", f"/vehicles/{e.pk}/", "/vehicles/inside/", "/vehicles/summary/", f"/vehicles/{e.pk}/photos/in/", "/nothing/"):
            for method in ("post", "put", "patch", "delete", "head", "options"):
                res = self.call(path, method=method)
                self.assertEqual(res.status_code, 405, (path, method))
                self.assertEqual(res["Allow"], "GET")
                self.assertEqual(self.call(path, key=False, method=method).status_code, 405)
        self.assertEqual(self.call("/vehicles/", method="post").json()["error"]["code"], "method_not_allowed")
        self.assertEqual(VehicleEntry.objects.count(), 1)

    def test_module_off_403_only_for_a_good_key(self):
        from tenancy import profile
        profile.apply({"version": 1, "name": "Acme", "modules": {"visitors": False}})
        res = self.call("/vehicles/")
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (403, "module_off"))
        self.assertEqual(self.call("/vehicles/", key="kpv_main_" + "a" * 40).status_code, 401)
        profile.apply({"version": 2, "name": "Acme", "modules": {"visitors": True}})
        self.assertEqual(self.call("/vehicles/").status_code, 200)

    def test_last_used_at_most_once_a_minute(self):
        self.assertIsNone(self.row.last_used_at)
        self.call("/vehicles/")
        first = VehicleApiKey.objects.get(pk=self.row.pk).last_used_at
        self.assertIsNotNone(first)
        self.call("/vehicles/")
        self.assertEqual(VehicleApiKey.objects.get(pk=self.row.pk).last_used_at, first)
        VehicleApiKey.objects.filter(pk=self.row.pk).update(last_used_at=timezone.now() - timedelta(seconds=61))
        self.call("/vehicles/")
        self.assertGreater(VehicleApiKey.objects.get(pk=self.row.pk).last_used_at, first)

    @override_settings(VEHICLE_API_RATE="3/min")
    def test_rate_limit_per_key(self):
        with mock.patch("visitors.vehicle_api.time.time", return_value=1_800_000_000):
            for _ in range(3):
                self.assertEqual(self.call("/vehicles/").status_code, 200)
            res = self.call("/vehicles/")
            self.assertEqual((res.status_code, res.json()["error"]["code"]), (429, "rate_limited"))
            self.assertGreater(int(res["Retry-After"]), 0)
            self.assertEqual(self.call("/vehicles/inside/").status_code, 429)
            _other, other_key = vehicle_api.make_key("other", self.admin)
            self.assertEqual(self.call("/vehicles/", key=other_key).status_code, 200)
        with mock.patch("visitors.vehicle_api.time.time", return_value=1_800_000_000 + 61):
            self.assertEqual(self.call("/vehicles/").status_code, 200)

    def test_rate_setting_falls_back_to_the_default(self):
        with override_settings(VEHICLE_API_RATE="nonsense"):
            self.assertEqual(vehicle_api._rate(), (120, 60))
        with override_settings(VEHICLE_API_RATE="30/hour"):
            self.assertEqual(vehicle_api._rate(), (30, 3600))

    def test_access_log_has_prefix_path_status_and_nothing_else(self):
        with mock.patch("visitors.vehicle_api.log_sink.report") as report, self.assertLogs("visitors.vehicle_api", "INFO") as logs:
            self.call("/vehicles/?vehicle_number=SECRETQUERY")
            self.call("/vehicles/", key="kpv_main_" + "z" * 40)
        args, kw = report.call_args_list[0]
        self.assertIn(self.row.prefix, args[2])
        self.assertIn("200", args[2])
        self.assertEqual((kw["path"], kw["status"], kw["method"]), ("/api/visitors/v1/vehicles/", 200, "GET"))
        args2, kw2 = report.call_args_list[1]
        self.assertEqual(kw2["status"], 401)
        everything = repr(report.call_args_list) + " ".join(logs.output)
        self.assertNotIn(self.key, everything)
        self.assertNotIn("z" * 40, everything)
        self.assertNotIn("SECRETQUERY", everything)

    def test_unexpected_failure_is_json_and_says_nothing(self):
        with mock.patch("visitors.vehicle_api._row", side_effect=RuntimeError("secret detail")), self.assertLogs("visitors.vehicle_api", "ERROR"):
            self.entry()
            res = self.call("/vehicles/")
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (500, "server_error"))
        self.assertNotIn("secret detail", res.content.decode())


class PhotoTests(ApiBase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.e = self.entry()
        self.e.photo_in.save("x.jpg", ContentFile(JPEG), save=True)

    def test_key_gets_the_bytes(self):
        res = self.call(f"/vehicles/{self.e.pk}/photos/in/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/jpeg")
        self.assertEqual(res["X-Content-Type-Options"], "nosniff")
        self.assertIn("no-store", res["Cache-Control"])
        self.assertEqual(b"".join(res.streaming_content), JPEG)

    def test_row_links_to_the_key_protected_address_only(self):
        d = self.call(f"/vehicles/{self.e.pk}/", HTTP_X_FORWARDED_HOST="kaampilot.com").json()
        self.assertEqual(d["photos"], {"in": f"http://testserver/tasks/api/visitors/v1/vehicles/{self.e.pk}/photos/in/", "out": None})
        self.assertNotIn("/media/", str(d))

    def test_no_key_no_photo(self):
        res = self.call(f"/vehicles/{self.e.pk}/photos/in/", key=False)
        self.assertEqual((res.status_code, res.json()), (401, BAD))
        self.assertEqual(self.call(f"/vehicles/{self.e.pk}/photos/in/", key="kpv_main_" + "a" * 40).status_code, 401)

    def test_missing_photo_404(self):
        res = self.call(f"/vehicles/{self.e.pk}/photos/out/")
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (404, "not_found"))


@unittest.skipUnless(connection.vendor == "postgresql", "multi-company mode needs Postgres")
@override_settings(TENANCY="schemas")
class CompanyIsolationTests(SimpleTestCase):
    """A key only ever reads its own company's schema; another company's code or a forged mix gets the same 401."""
    databases = {"default"}
    A, B = "co_vapi_a", "co_vapi_b"
    PLATE_A, PLATE_B = "MH12AA1111", "KA01BB2222"

    @classmethod
    def setUpClass(cls):
        from tenancy import schemas
        super().setUpClass()
        schemas.ensure_registry()
        cls.ids = (str(uuid.uuid4()), str(uuid.uuid4()))
        for cid, schema in zip(cls.ids, (cls.A, cls.B)):
            schemas.create_company(cid, schema, schema)
        with schemas.use(cls.A):
            cls.row_a, cls.key_a = vehicle_api.make_key("A", None)
            cls.entry_a = VehicleEntry.objects.create(number=cls.PLATE_A)
        with schemas.use(cls.B):
            cls.row_b, cls.key_b = vehicle_api.make_key("B", None)
            cls.entry_b = VehicleEntry.objects.create(number=cls.PLATE_B)

    @classmethod
    def tearDownClass(cls):
        from tenancy import schemas
        with connection.cursor() as cur:
            for schema in (cls.A, cls.B):
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            cur.execute(f"DELETE FROM {schemas.REGISTRY} WHERE company_id::text IN (%s, %s)", list(cls.ids))
        schemas._cache.clear()
        super().tearDownClass()

    def get(self, path, key):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
        return c.get(f"{ROOT}{path}")

    def test_key_format_names_the_company(self):
        self.assertTrue(re.fullmatch(r"kpv_vapi_a_[A-Za-z0-9]{40}", self.key_a))

    def test_each_key_reads_only_its_own_company(self):
        d = self.get("/vehicles/", self.key_a).json()
        self.assertEqual([r["vehicle_number"] for r in d["results"]], [self.PLATE_A])
        d = self.get("/vehicles/", self.key_b).json()
        self.assertEqual([r["vehicle_number"] for r in d["results"]], [self.PLATE_B])

    def test_same_ids_in_the_two_companies_stay_apart(self):
        self.assertEqual(self.entry_a.pk, self.entry_b.pk)
        self.assertEqual(self.get(f"/vehicles/{self.entry_a.pk}/", self.key_a).json()["vehicle_number"], self.PLATE_A)
        self.assertEqual(self.get(f"/vehicles/{self.entry_a.pk}/", self.key_b).json()["vehicle_number"], self.PLATE_B)

    def test_forged_company_in_a_key_is_the_same_401(self):
        secret_a = self.key_a.split("_")[-1]
        for forged in (f"kpv_vapi_b_{secret_a}", f"kpv_nobody_t_{secret_a}", f"kpv_public_{secret_a}", f"kpv_none_{secret_a}"):
            res = self.get("/vehicles/", forged)
            self.assertEqual((res.status_code, res.json()), (401, BAD), forged)

    def test_the_connection_goes_back_to_no_company(self):
        from tenancy import schemas
        self.get("/vehicles/", self.key_a)
        self.assertIsNone(schemas.current())

    def test_module_off_in_one_company_only(self):
        from tenancy import profile, schemas
        with schemas.use(self.A):
            profile.apply({"version": 1, "name": "A", "modules": {"visitors": False}})
        with schemas.use(self.B):
            profile.apply({"version": 1, "name": "B", "modules": {"visitors": True}})
        try:
            self.assertEqual(self.get("/vehicles/", self.key_a).status_code, 403)
            self.assertEqual(self.get("/vehicles/", self.key_b).status_code, 200)
        finally:
            with schemas.use(self.A):
                profile.apply({"version": 2, "name": "A", "modules": {"visitors": True}})
