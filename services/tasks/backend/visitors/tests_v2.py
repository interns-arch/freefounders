"""Visitors V2 (PLAN.md §22.9): pre-invites with a pass link, the visitor's pass page, the watchlist, deliveries."""
from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Notification

from . import conf, services
from .models import Delivery, GateAction, GateLog, Visit, VisitStatus, WatchEntry
from .tests import Base, jpeg


def inline(fn):
    fn()


class InviteBase(Base):
    def invite(self, user=None, **extra):
        body = {"date": timezone.localdate().isoformat(), "time_from": "10:00", "time_to": "12:00", "purpose": "Meeting",
                "visitors": [{"name": "Priya Shah", "mobile": "9123456780", "company": "XYZ"}], **extra}
        return self.api(user or self.host).post("/api/visitors/invites/", body, format="json")


class InviteTests(InviteBase):
    def test_host_invites_gate_scans_and_checks_in(self):
        res = self.invite()
        self.assertEqual(res.status_code, 201, res.data)
        row = res.data[0]
        self.assertEqual((row["status"], row["host"]["id"]), ("expected", self.host.pk))
        self.assertTrue(row["pass_no"].startswith("V"))
        self.assertIn("10:00–12:00", row["window"])
        self.assertTrue(row["pass_path"].startswith("/v/main/p/"))
        # The host sees it under upcoming, the gate under today's expected visitors.
        self.assertEqual(len(self.api(self.host).get("/api/visitors/visits/?scope=upcoming").data["results"]), 1)
        self.assertEqual(self.api(self.guard).get("/api/visitors/visits/?scope=expected").data["count"], 1)
        # The gate scans the pass QR: the expected visit, then checks them in with a photo.
        v = Visit.objects.get()
        found = self.api(self.guard).get(f"/api/visitors/visits/find/?code=KPV:{v.pass_token}")
        self.assertEqual((found.status_code, found.data["status"]), (200, "expected"))
        url = f"https://kaampilot.com/v/main/p/{v.pass_token}"
        self.assertEqual(self.api(self.guard).get(f"/api/visitors/visits/find/?code={url}").data["id"], v.pk)
        ok = self.api(self.guard).post(f"/api/visitors/visits/{v.pk}/accept/", {"photo": jpeg()}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["status"], "inside")
        self.assertTrue(GateLog.objects.filter(action=GateAction.VISIT_IN, visit=v, actor=self.guard).exists())
        self.assertTrue(Notification.objects.filter(user=self.host, type="visitor_arrived").exists())

    def test_group_invite_shares_a_group_and_reports_each_row(self):
        rows = [{"name": "A One", "mobile": "9000000001"}, {"name": "B Two", "email": "b@x.com"},
                {"name": "C Three", "mobile": "9000000003"}]
        res = self.invite(visitors=rows)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len({r["group"] for r in res.data}), 1)
        self.assertTrue(res.data[0]["group"])
        bad = self.invite(visitors=[{"name": "", "mobile": "9000000001"}, {"name": "No contact"}])
        self.assertEqual(bad.status_code, 400)
        self.assertIn("visitors.0.name", bad.data)
        self.assertIn("visitors.1.mobile", bad.data)

    def test_dates_and_who_may_invite_for_whom(self):
        self.assertIn("date", self.invite(date=(timezone.localdate() - timedelta(days=1)).isoformat()).data)
        self.assertIn("time_to", self.invite(time_from="12:00", time_to="11:00").data)
        self.assertIn("host", self.invite(user=self.other, host=self.host.pk).data, "a member invites only for themselves")
        res = self.invite(user=self.guard, host=self.host.pk)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data[0]["host"]["id"], self.host.pk)

    def test_today_scope_skips_future_invites_and_no_shows_close_the_day(self):
        self.invite(date=(timezone.localdate() + timedelta(days=3)).isoformat())
        self.assertEqual(self.api(self.guard).get("/api/visitors/visits/?scope=today").data["count"], 0)
        self.invite()
        Visit.objects.filter(expected_at__date=timezone.localdate()).update(
            expected_at=timezone.now() - timedelta(days=2), expected_until=timezone.now() - timedelta(days=2))
        self.assertEqual(services.mark_no_shows(), 1)
        self.assertEqual(Visit.objects.filter(status=VisitStatus.NO_SHOW).count(), 1)
        self.assertEqual(Visit.objects.filter(status=VisitStatus.EXPECTED).count(), 1, "the future one waits")

    def test_cancel_only_by_the_inviter_and_only_while_expected(self):
        v = self.invite().data[0]
        self.assertEqual(self.api(self.other).post(f"/api/visitors/visits/{v['id']}/cancel/").status_code, 404)
        res = self.api(self.host).post(f"/api/visitors/visits/{v['id']}/cancel/")
        self.assertEqual((res.status_code, res.data["status"]), (200, "cancelled"))
        self.assertEqual(self.api(self.host).post(f"/api/visitors/visits/{v['id']}/cancel/").status_code, 400)
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/visits/{v['id']}/accept/", {"photo": jpeg()},
                                                   format="json").status_code, 400)


class PassTests(InviteBase):
    def test_pass_goes_by_whatsapp_and_email_when_set_up(self):
        sent = {"status": "sent", "detail": ""}
        with mock.patch("notifications.channels.whatsapp.is_configured", return_value=True), \
                mock.patch("visitors.services.in_background", side_effect=inline), \
                mock.patch("notifications.channels.whatsapp.send_text", return_value=sent) as wa, \
                mock.patch("notifications.channels.gmail.send_email", return_value=sent) as mail:
            res = self.invite(visitors=[{"name": "Priya Shah", "mobile": "9123456780", "email": "priya@x.com"}])
        self.assertEqual(res.status_code, 201, res.data)
        v = Visit.objects.get()
        self.assertEqual(wa.call_args.args[0], "9123456780")
        self.assertIn(f"/v/main/p/{v.pass_token}", wa.call_args.args[1])
        self.assertEqual(mail.call_args.args[0], "priya@x.com")
        self.assertEqual([c["channel"] for c in v.pass_channels], ["whatsapp", "email"])
        self.assertIsNotNone(v.pass_sent_at)

    def test_nothing_set_up_is_recorded_as_skipped_and_walk_ins_get_a_pass_too(self):
        res = self.check_in()
        v = Visit.objects.get(pk=res.data["id"])
        self.assertEqual(v.pass_channels[0]["status"], "skipped")
        conf.save({**conf.get(), "send_pass": False})
        res = self.check_in(mobile="9888877777", name="Other")
        self.assertIsNone(Visit.objects.get(pk=res.data["id"]).pass_sent_at)

    def test_resend_is_logged(self):
        v = self.invite().data[0]
        res = self.api(self.host).post(f"/api/visitors/visits/{v['id']}/send_pass/")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(GateLog.objects.filter(action=GateAction.PASS_SENT, actor=self.host).exists())

    def test_public_pass_page_shows_only_this_visit(self):
        v = Visit.objects.get(pk=self.invite().data[0]["id"])
        url = f"/api/visitors/pass/main/{v.pass_token}/"
        res = APIClient().get(url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["name"], res.data["pass_no"], res.data["status"]), ("Priya Shah", v.pass_no, "expected"))
        self.assertEqual(res.data["qr"], f"KPV:{v.pass_token}")
        self.assertEqual(res.data["host"], "Neha", "first name (+ last initial) only")
        for leak in ("mobile", "email", "id_last4", "notes", "id"):
            self.assertNotIn(leak, res.data)
        self.assertEqual(APIClient().get("/api/visitors/pass/main/not-a-real-token-123/").status_code, 404)
        with mock.patch("tenancy.profile.module_on", return_value=False):
            self.assertEqual(APIClient().get(url).status_code, 404)

    def test_open_link_sign_in_has_no_pass_page_until_checked_in(self):
        link = services.the_link()
        APIClient().post(f"/api/visitors/public/main/{link.token}/",
                         {"name": "Q", "mobile": "9111111111", "host_name": "x", "consent": True}, format="json")
        v = Visit.objects.get()
        self.assertEqual(APIClient().get(f"/api/visitors/pass/main/{v.pass_token}/").status_code, 404)


class WatchlistTests(InviteBase):
    def setUp(self):
        super().setUp()
        res = self.api(self.admin).post("/api/visitors/watchlist/", {"mobile": "98765 43210", "reason": "Theft in May"},
                                        format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.entry = res.data

    def test_only_admins_edit_and_the_guard_sees_it_on_lookup(self):
        self.assertEqual(self.api(self.guard).post("/api/visitors/watchlist/", {"mobile": "9111111111", "reason": "x"},
                                                   format="json").status_code, 403)
        self.assertEqual(self.api(self.guard).get("/api/visitors/watchlist/").status_code, 403)
        look = self.api(self.guard).get("/api/visitors/lookup/?mobile=9876543210").data
        self.assertEqual(look["watch"], {"reason": "Theft in May", "stop": True})
        self.assertIn("mobile", self.api(self.admin).post("/api/visitors/watchlist/",
                                                          {"mobile": "9876543210", "reason": "again"}, format="json").data)

    def test_stop_refuses_the_guard_admin_may_override(self):
        res = self.check_in()
        self.assertEqual(res.status_code, 400)
        self.assertIn("watchlist", res.data)
        self.assertEqual(Visit.objects.count(), 0)
        body = {"mobile": "9876543210", "name": "Ravi Kumar", "host": self.host.pk, "photo": jpeg()}
        self.assertIn("watchlist_warn", self.api(self.admin).post("/api/visitors/visits/", body, format="json").data)
        ok = self.api(self.admin).post("/api/visitors/visits/", {**body, "watch_ok": True}, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertIn("Theft", ok.data["watch_note"])
        self.assertTrue(GateLog.objects.filter(action=GateAction.WATCH_ALERT).exists())

    def test_warn_mode_lets_the_guard_confirm(self):
        conf.save({**conf.get(), "watch_action": "warn"})
        self.assertIn("watchlist_warn", self.check_in().data)
        self.assertEqual(self.check_in(watch_ok=True).status_code, 201)

    def test_name_only_entries_warn_invites_refused_qr_flagged_removal_clears(self):
        self.api(self.admin).post("/api/visitors/watchlist/", {"name": "Bad Actor", "reason": "Fake vendor"}, format="json")
        self.assertIn("watchlist_warn", self.check_in(mobile="9000011111", name="bad actor").data)
        bad = self.invite(visitors=[{"name": "R", "mobile": "9876543210"}])
        self.assertIn("visitors.0.mobile", bad.data)
        self.assertNotIn("Theft", str(bad.data), "the employee is not told the reason")
        link = services.the_link()
        APIClient().post(f"/api/visitors/public/main/{link.token}/",
                         {"name": "Ravi", "mobile": "9876543210", "host_name": "x", "consent": True}, format="json")
        self.assertIn("Theft", Visit.objects.get(source="open_link").watch_note)
        self.assertEqual(self.api(self.admin).delete(f"/api/visitors/watchlist/{self.entry['id']}/").status_code, 200)
        self.assertFalse(WatchEntry.objects.get(pk=self.entry["id"]).active)
        self.assertEqual(self.check_in(mobile="9876543210", name="Ravi Kumar").status_code, 201)
        self.assertTrue(GateLog.objects.filter(action=GateAction.WATCH_REMOVE, actor=self.admin).exists())


class DeliveryTests(InviteBase):
    def receive(self, **extra):
        body = {"courier": "BlueDart", "tracking_no": "BD123", "recipient": self.host.pk, "parcels": 2, **extra}
        return self.api(self.guard).post("/api/visitors/deliveries/", body, format="json")

    def test_receive_notify_collect(self):
        res = self.receive(photo=jpeg())
        self.assertEqual(res.status_code, 201, res.data)
        n = Notification.objects.get(user=self.host, type="visitor_parcel")
        self.assertEqual(n.category, "visitors")
        self.assertIn(f"delivery={res.data['id']}", n.link)
        self.assertEqual(self.api(self.host).get("/api/visitors/deliveries/?scope=mine").data["count"], 1)
        self.assertEqual(self.api(self.other).get("/api/visitors/deliveries/").data["count"], 0)
        self.assertEqual(self.api(self.host).get("/api/badges/").data["visitors"]["parcels"], 1)
        self.assertEqual(self.api(self.host).post(f"/api/visitors/deliveries/{res.data['id']}/collect/").status_code, 403)
        out = self.api(self.guard).post(f"/api/visitors/deliveries/{res.data['id']}/collect/",
                                        {"collected_by_name": "Rahul (team)"}, format="json")
        self.assertEqual((out.status_code, out.data["status"]), (200, "collected"))
        self.assertTrue(Notification.objects.filter(user=self.host, type="visitor_parcel_collected").exists())
        self.assertEqual(self.api(self.host).get("/api/badges/").data["visitors"]["parcels"], 0)
        self.assertTrue(GateLog.objects.filter(action=GateAction.DELIVERY_OUT, delivery_id=res.data["id"]).exists())

    def test_rules(self):
        self.assertIn("recipient", self.receive(recipient=None).data)
        self.assertEqual(self.receive(recipient=None, recipient_label="Accounts").status_code, 201)
        self.assertEqual(self.api(self.host).post("/api/visitors/deliveries/", {"recipient_label": "x"},
                                                  format="json").status_code, 403)
        d = self.receive().data
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/deliveries/{d['id']}/return/").data["status"], "returned")
        self.assertEqual(self.api(self.guard).post(f"/api/visitors/deliveries/{d['id']}/collect/").status_code, 400)

    def test_reminder_once_and_retention(self):
        self.receive()
        Delivery.objects.update(received_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(services.delivery_reminders(), 1)
        self.assertEqual(services.delivery_reminders(), 0)
        self.assertEqual(Notification.objects.filter(user=self.host, type="visitor_parcel").count(), 2)
        d = Delivery.objects.get()
        self.api(self.guard).post(f"/api/visitors/deliveries/{d.pk}/collect/", {"collected_by_name": "Neha"}, format="json")
        Delivery.objects.update(received_at=timezone.now() - timedelta(days=200))
        services.retention_cleanup()
        d.refresh_from_db()
        self.assertTrue(d.anonymised)
        self.assertEqual(d.collected_by_name, "")
