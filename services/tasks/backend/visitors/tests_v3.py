"""Visitors V3 (PLAN.md §22.10): contractor passes, material gate passes (+ the Assets event), patrol, incidents, one
scan for every pass, the ID card reader, reports, badges and the roll call."""
from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification
from tenancy.models import OutboxEvent

from . import conf, services, services_v3
from .models import Checkpoint, ContractorPass, GateAction, GateLog, Incident, MaterialPass, PatrolScan
from .tests import Base, jpeg


def today(d=0):
    return (timezone.localdate() + timedelta(days=d)).isoformat()


class ContractorTests(Base):
    def make(self, user=None, **extra):
        body = {"name": "Suresh Electricals", "mobile": "9811122233", "company": "SE Works", "people": 3,
                "work": "Rewiring the store room", "permit_no": "HW-12", "safety_note": "Helmets, gloves",
                "valid_from": today(), "valid_to": today(4), **extra}
        return self.api(user or self.host).post("/api/visitors/contractors/", body, format="json")

    def test_pass_daily_in_out_and_supervisor_told_once_a_day(self):
        res = self.make()
        self.assertEqual(res.status_code, 201, res.data)
        c = res.data
        self.assertTrue(c["pass_no"].startswith("C"))
        self.assertEqual((c["state"], c["days_left"], c["supervisor"]["id"]), ("valid", 5, self.host.pk))
        g = self.api(self.guard)
        self.assertIn("photo", g.post(f"/api/visitors/contractors/{c['id']}/in/", {}, format="json").data)
        r = g.post(f"/api/visitors/contractors/{c['id']}/in/", {"photo": jpeg()}, format="json")
        self.assertEqual((r.status_code, r.data["inside"]), (200, True), r.data)
        self.assertEqual(g.post(f"/api/visitors/contractors/{c['id']}/in/", {}, format="json").status_code, 400)
        self.assertEqual(g.post(f"/api/visitors/contractors/{c['id']}/out/").data["inside"], False)
        self.assertEqual(g.post(f"/api/visitors/contractors/{c['id']}/in/", {}, format="json").status_code, 200,
                         "the photo stays on the pass")
        self.assertEqual(Notification.objects.filter(user=self.host, type="visitor_contractor").count(), 1)
        self.assertEqual(len(g.get(f"/api/visitors/contractors/{c['id']}/entries/").data), 2)
        inside = g.get("/api/visitors/inside/").data
        self.assertEqual([x["name"] for x in inside["contractors"]], ["Suresh Electricals"])

    def test_dates_revoked_expired_and_who_may_make(self):
        self.assertIn("valid_to", self.make(valid_to=today(-1)).data)
        self.assertIn("valid_from", self.make(valid_from=today(-2), valid_to=today(1)).data)
        self.assertIn("valid_to", self.make(valid_to=today(200)).data)
        self.assertIn("supervisor", self.make(user=self.other, supervisor=self.host.pk).data)
        c = self.make(valid_from=today(2), valid_to=today(3)).data
        res = self.api(self.guard).post(f"/api/visitors/contractors/{c['id']}/in/", {"photo": jpeg()}, format="json")
        self.assertIn("starts on", str(res.data))
        c = self.make().data
        self.assertEqual(self.api(self.other).post(f"/api/visitors/contractors/{c['id']}/revoke/").status_code, 404)
        self.assertEqual(self.api(self.host).post(f"/api/visitors/contractors/{c['id']}/revoke/").data["state"], "revoked")
        self.assertIn("revoked", str(self.api(self.guard).post(f"/api/visitors/contractors/{c['id']}/in/",
                                                               {"photo": jpeg()}, format="json").data))

    def test_public_pass_and_one_scan(self):
        c = ContractorPass.objects.get(pk=self.make().data["id"])
        res = APIClient().get(f"/api/visitors/pass/main/{c.pass_token}/")
        self.assertEqual((res.status_code, res.data["kind"], res.data["qr"]), (200, "contractor", f"KPC:{c.pass_token}"))
        self.assertNotIn("mobile", res.data)
        scan = self.api(self.guard).get(f"/api/visitors/scan/?code=KPC:{c.pass_token}")
        self.assertEqual((scan.data["kind"], scan.data["data"]["id"]), ("contractor", c.pk))
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/scan/?code={c.pass_no}").data["kind"], "contractor")
        self.assertEqual(self.api(self.host).get(f"/api/visitors/scan/?code={c.pass_no}").status_code, 403)

    def test_task_link_only_my_own(self):
        from crm.models import Task
        mine = Task.objects.create(title="Fix wiring", assigned_to=self.host, created_by=self.host)
        theirs = Task.objects.create(title="Other", assigned_to=self.other, created_by=self.other)
        opts = self.api(self.host).get("/api/visitors/task-options/").data
        self.assertEqual([t["id"] for t in opts], [mine.pk])
        self.assertIn("task", self.make(task=theirs.pk).data)
        self.assertEqual(self.make(task=mine.pk).data["task"]["id"], mine.pk)

    def test_watchlisted_number_cannot_get_a_pass(self):
        self.api(self.admin).post("/api/visitors/watchlist/", {"mobile": "9811122233", "reason": "Theft"}, format="json")
        self.assertIn("mobile", self.make().data)


class MaterialTests(Base):
    def setUp(self):
        super().setUp()
        self.host.reporting_manager = self.other
        self.host.save()

    def ask(self, user=None, **extra):
        body = {"direction": "out", "purpose": "Laptop repair at vendor", "returnable": True, "expected_return": today(3),
                "carrier_name": "Ravi (vendor)", "items": [
                    {"description": "Dell laptop", "quantity": 1, "asset_id": "11111111-2222-3333-4444-555555555555",
                     "asset_tag": "LT-0042"},
                    {"description": "Charger", "quantity": 2, "unit": "nos"}], **extra}
        return self.api(user or self.host).post("/api/visitors/material/", body, format="json")

    def test_ask_manager_approves_gate_passes_assets_told_and_return(self):
        res = self.ask()
        self.assertEqual(res.status_code, 201, res.data)
        m = res.data
        self.assertEqual((m["status"], m["pass_no"][:1]), ("pending", "M"))
        n = Notification.objects.get(user=self.other, type="visitor_material_approval")
        self.assertEqual(n.category, "approvals")
        self.assertEqual(self.api(self.other).get("/api/badges/").data["visitors"]["material"], 1)
        # The guard cannot let it through before the yes; the requester cannot approve their own.
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/material/{m['id']}/gate/").status_code, 400)
        self.assertEqual(self.api(self.host).post(f"/api/visitors/material/{m['id']}/decide/", {"decision": "approve"},
                                                  format="json").status_code, 403)
        ok = self.api(self.other).post(f"/api/visitors/material/{m['id']}/decide/", {"decision": "approve"}, format="json")
        self.assertEqual(ok.data["status"], "approved")
        with mock.patch("tenancy.outbox.emit") as emit:
            g = self.api(self.guard).post(f"/api/visitors/material/{m['id']}/gate/", {"note": "Checked"}, format="json")
        self.assertEqual(g.data["status"], "passed")
        kind, payload = emit.call_args.args
        self.assertEqual(kind, "material.moved")
        self.assertEqual((payload["kind"], payload["assets"][0]["tag"]), ("passed", "LT-0042"))
        items = {i["description"]: i["id"] for i in g.data["items"]}
        part = self.api(self.guard).post(f"/api/visitors/material/{m['id']}/return/",
                                         {"items": {str(items["Charger"]): 2}}, format="json")
        self.assertEqual(part.data["status"], "passed", "the laptop is still out")
        with mock.patch("tenancy.outbox.emit") as emit:
            done = self.api(self.guard).post(f"/api/visitors/material/{m['id']}/return/", {}, format="json")
        self.assertEqual(done.data["status"], "returned")
        self.assertEqual(emit.call_args.args[1]["kind"], "returned")

    def test_rules_and_overdue(self):
        self.assertIn("items", self.ask(items=[]).data)
        self.assertIn("expected_return", self.ask(expected_return=today(-1)).data)
        self.assertIn("items.0.quantity", self.ask(items=[{"description": "x", "quantity": 0}]).data)
        head = self.ask(user=self.admin).data
        self.assertEqual(head["status"], "approved", "the security head needs nobody's yes")
        m = MaterialPass.objects.get(pk=self.ask().data["id"])
        self.api(self.admin).post(f"/api/visitors/material/{m.pk}/decide/", {"decision": "approve"}, format="json")
        self.api(self.guard).post(f"/api/visitors/material/{m.pk}/gate/")
        MaterialPass.objects.filter(pk=m.pk).update(expected_return=timezone.localdate() - timedelta(days=1))
        self.assertEqual(services_v3.material_overdue(), 1)
        self.assertEqual(services_v3.material_overdue(), 0)
        self.assertTrue(Notification.objects.filter(user=self.host, title__contains="not back").exists())
        res = self.api(self.guard).get(f"/api/visitors/scan/?code=KPM:{m.pass_token}")
        self.assertEqual(res.data["kind"], "material")

    def test_no_manager_goes_to_the_head_and_cancel(self):
        self.host.reporting_manager = None
        self.host.save()
        m = self.ask().data
        self.assertTrue(Notification.objects.filter(user=self.admin, type="visitor_material_approval").exists())
        self.assertEqual(self.api(self.host).post(f"/api/visitors/material/{m['id']}/cancel/").data["status"], "cancelled")


class PatrolTests(Base):
    def test_checkpoints_scan_and_missed_alert(self):
        self.assertEqual(self.api(self.guard).post("/api/visitors/checkpoints/", {"name": "Back gate"},
                                                   format="json").status_code, 403)
        cp = self.api(self.admin).post("/api/visitors/checkpoints/", {"name": "Back gate"}, format="json").data
        self.assertTrue(cp["code"].startswith("KPP:"))
        self.assertTrue(cp["overdue"])
        self.assertNotIn("code", self.api(self.guard).get("/api/visitors/checkpoints/").data["checkpoints"][0])
        res = self.api(self.guard).post("/api/visitors/checkpoints/scan/", {"code": cp["code"], "note": ""}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertFalse(self.api(self.guard).get("/api/visitors/checkpoints/").data["checkpoints"][0]["overdue"])
        self.assertIn("code", self.api(self.guard).post("/api/visitors/checkpoints/scan/", {"code": "KPP:nope"},
                                                        format="json").data)
        Checkpoint.objects.update(last_scan_at=timezone.now() - timedelta(hours=3))
        self.assertEqual(services_v3.patrol_alerts(), 1)
        self.assertEqual(services_v3.patrol_alerts(), 0, "once per gap")
        self.assertTrue(Notification.objects.filter(user=self.admin, type="visitor_patrol").exists())

    def test_problem_alerts_and_patrol_hours(self):
        cp = Checkpoint.objects.create(name="Store")
        self.api(self.guard).post("/api/visitors/checkpoints/scan/", {"code": f"KPP:{cp.token}", "all_ok": False,
                                                                     "note": "Lock broken"}, format="json")
        self.assertTrue(Notification.objects.filter(user=self.admin, title__contains="problem at Store").exists())
        hour = timezone.localtime().hour
        conf.save({**conf.get(), "patrol_from": (hour + 1) % 24, "patrol_to": (hour + 2) % 24})
        Checkpoint.objects.update(last_scan_at=timezone.now() - timedelta(hours=5), missed_alerted_at=None)
        self.assertEqual(services_v3.patrol_alerts(), 0, "outside patrol hours")
        self.assertEqual(PatrolScan.objects.count(), 1)


class IncidentTests(Base):
    def test_report_alert_close(self):
        body = {"kind": "theft", "severity": "high", "title": "Copper cable missing", "place": "Yard",
                "description": "Found cut at 02:10", "photos": [jpeg(), jpeg()]}
        res = self.api(self.guard).post("/api/visitors/incidents/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data["photos"]), 2)
        n = Notification.objects.get(user=self.admin, type="visitor_incident")
        self.assertTrue(n.title.startswith("URGENT"))
        self.assertEqual(self.api(self.admin).get("/api/badges/").data["visitors"]["incidents"], 1)
        i = res.data["id"]
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/incidents/{i}/photo/{res.data['photos'][0]}/").status_code, 200)
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/incidents/{i}/close/", {"action_taken": "x"},
                                                   format="json").status_code, 403)
        self.assertIn("action_taken", self.api(self.admin).post(f"/api/visitors/incidents/{i}/close/", {}, format="json").data)
        done = self.api(self.admin).post(f"/api/visitors/incidents/{i}/close/", {"action_taken": "Police complaint filed"},
                                         format="json")
        self.assertEqual(done.data["status"], "closed")
        self.assertTrue(Notification.objects.filter(user=self.guard, title__contains="Incident closed").exists())
        self.assertEqual(self.api(self.other).get("/api/visitors/incidents/").status_code, 403)

    def test_low_is_quiet_and_rules(self):
        self.api(self.guard).post("/api/visitors/incidents/", {"title": "Light flickering", "severity": "low"}, format="json")
        self.assertFalse(Notification.objects.filter(type="visitor_incident").exists())
        self.assertIn("title", self.api(self.guard).post("/api/visitors/incidents/", {}, format="json").data)
        future = (timezone.now() + timedelta(hours=2)).isoformat()
        self.assertIn("occurred_at", self.api(self.guard).post("/api/visitors/incidents/", {"title": "x", "occurred_at": future},
                                                              format="json").data)
        self.assertIn("photos", self.api(self.guard).post("/api/visitors/incidents/", {"title": "x", "photos": [jpeg()] * 5},
                                                         format="json").data)

    def test_retention_keeps_the_record_drops_photos(self):
        self.api(self.guard).post("/api/visitors/incidents/", {"title": "Old", "photos": [jpeg()]}, format="json")
        Incident.objects.update(occurred_at=timezone.now() - timedelta(days=400))
        services.retention_cleanup()
        self.assertEqual(Incident.objects.count(), 1)
        self.assertEqual(Incident.objects.get().photos.count(), 0)


class IdScanTests(Base):
    def test_off_by_default_then_only_name_type_and_last4(self):
        self.assertIn("switched off", str(self.api(self.guard).post("/api/visitors/id-scan/", {"photo": jpeg()},
                                                                    format="json").data))
        conf.save({**conf.get(), "id_scan": True})
        with mock.patch("config.llm.enabled", return_value=False):
            self.assertIn("not set up", str(self.api(self.guard).post("/api/visitors/id-scan/", {"photo": jpeg()},
                                                                      format="json").data))
        answer = {"name": "Ravi Kumar", "id_type": "Aadhaar", "last4": "1234 5678 9012", "address": "Pune"}
        with mock.patch("config.llm.enabled", return_value=True), \
                mock.patch("config.llm.read_image_json", return_value=answer):
            res = self.api(self.guard).post("/api/visitors/id-scan/", {"photo": jpeg()}, format="json")
        self.assertEqual(res.data, {"name": "Ravi Kumar", "id_type": "Aadhaar", "id_last4": "9012", "found": True})
        self.assertTrue(GateLog.objects.filter(action=GateAction.ID_SCAN).exists())
        self.assertNotIn("9012", GateLog.objects.get(action=GateAction.ID_SCAN).summary)
        self.assertEqual(self.api(self.host).post("/api/visitors/id-scan/", {"photo": jpeg()}, format="json").status_code, 403)


class ReportTests(Base):
    def test_numbers_and_download(self):
        self.check_in()
        self.check_in(mobile="9000000002", name="Second", purpose="Interview")
        res = self.api(self.admin).get("/api/visitors/reports/")
        self.assertEqual(res.status_code, 200)
        t = res.data["totals"]
        self.assertEqual((t["visits"], t["unique_visitors"]), (2, 2))
        self.assertEqual(sum(d["visits"] for d in res.data["per_day"]), 2)
        self.assertEqual(len(res.data["per_day"]), 30)
        self.assertEqual(sum(h["visits"] for h in res.data["per_hour"]), 2)
        self.assertEqual({p["name"] for p in res.data["purposes"]}, {"Meeting", "Interview"})
        self.assertEqual(self.api(self.guard).get("/api/visitors/reports/").status_code, 403)
        csv = self.api(self.admin).get("/api/visitors/reports/?export=csv")
        self.assertEqual(csv.status_code, 200)
        self.assertIn(b"Meeting", csv.content)
        self.assertIn("date_from", self.api(self.admin).get(f"/api/visitors/reports/?date_from={today(-500)}").data)


class OutboxTests(Base):
    """With Platform sign-in on, the material event lands in the outbox for the Platform to pick up."""
    def test_event_written_only_for_assets(self):
        with mock.patch("accounts.platform_auth.enabled", return_value=True):
            m = MaterialPass.objects.create(purpose="x", status="approved", requested_by=self.host, pass_no="M1")
            m.items.create(description="Laptop", asset_id="11111111-2222-3333-4444-555555555555", asset_tag="LT-1")
            services_v3.gate_material(self.guard, m)
            plain = MaterialPass.objects.create(purpose="y", status="approved", requested_by=self.host, pass_no="M2")
            plain.items.create(description="Old chairs")
            services_v3.gate_material(self.guard, plain)
        ev = OutboxEvent.objects.get(type="material.moved")
        self.assertEqual((ev.payload["passNo"], ev.payload["assets"][0]["tag"]), ("M1", "LT-1"))
