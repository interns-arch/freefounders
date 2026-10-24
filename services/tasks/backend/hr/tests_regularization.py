"""Attendance regularization (PLAN.md §19.38): the policy (on/off, reasons, monthly limit, how far back, no future
days), approval rewriting the day with the HR rules and keeping the from -> to, rejection, the own-records rule, the
approver's scope (the reporting manager first; no auto-approve), payroll reading the corrected day, and who may open an attachment."""
import io
from datetime import datetime, time, timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from notifications.models import Notification
from tenancy.company_settings import forget, set_value

from . import services
from .models import Attendance, AttendanceCorrection


def _png() -> bytes:
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 10, 10)).save(out, "PNG")
    return out.getvalue()


class _Base(TestCase):
    def setUp(self):
        forget()
        set_value("HR_WEEK_OFF_DAYS", "none")      # every day is a working day: ranges are predictable
        mk = User.objects.create_user
        self.hr = mk("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr")
        self.sales_mgr = mk("sm", "sm@x.com", "pass@12345", role=Role.SALES_MANAGER, department="sales")
        self.rahul = mk("rahul", "rahul@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                        reporting_manager=self.sales_mgr)
        self.priya = mk("priya", "priya@x.com", "pass@12345", role=Role.PURCHASE, department="purchase")
        self.owner = mk("own", "own@x.com", "pass@12345", role=Role.SUPER_ADMIN, department="management")
        self.patches = [mock.patch("notifications.service.gmail.send_email", return_value={"channel": "email", "status": "skipped"}),
                        mock.patch("notifications.service.whatsapp.send_text", return_value={"channel": "whatsapp", "status": "skipped"})]
        for p in self.patches:
            p.start()
        self.today = timezone.localdate()
        self.yesterday = self.today - timedelta(days=1)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        forget()

    def setting(self, name, value):
        set_value(name, value)
        forget()

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def ask(self, user=None, day=None, **body):
        body = {"date": (day or self.yesterday).isoformat(), "reason_type": "forgot_out",
                "check_in_time": "09:30", "check_out_time": "18:30", **body}
        return self.as_(user or self.rahul).post("/api/attendance-corrections/", body, format="json")

    def review(self, user, cid, decision="approved", remarks=""):
        return self.as_(user).post(f"/api/attendance-corrections/{cid}/review/",
                                   {"decision": decision, "remarks": remarks}, format="json")

    def at(self, day, hh, mm=0):
        return timezone.make_aware(datetime.combine(day, time(hh, mm)), timezone.get_current_timezone())


class PolicyTests(_Base):
    def test_create_within_policy_tells_the_approver(self):
        res = self.ask(reason="Left in a hurry")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["status"], res.data["reason_type"], res.data["reason_label"]),
                         ("pending", "forgot_out", "Forgot to punch out"))
        self.assertEqual(Notification.objects.filter(user=self.sales_mgr, type="correction_request").count(), 1)
        note = Notification.objects.get(user=self.sales_mgr, type="correction_request")
        self.assertIn("Forgot to punch out", note.body)
        self.assertEqual(note.link, f"/hr?tab=approvals&correction={res.data['id']}")
        self.assertEqual(note.category, "approvals")
        # the form's policy: 1 of 3 used this month (when yesterday is in this month)
        policy = self.as_(self.rahul).get("/api/attendance-corrections/policy/").data
        self.assertEqual((policy["monthly_limit"], policy["days_back"], policy["enabled"]), (3, 7, True))
        self.assertEqual(len(policy["reasons"]), 7)

    def test_over_the_monthly_limit(self):
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "1")
        cid = self.ask().data["id"]
        self.assertEqual(self.review(self.sales_mgr, cid).status_code, 200)
        res = self.ask(reason_type="forgot_in", check_out_time="")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "monthly_limit")
        self.assertIn("you can raise 1 regularization request(s) a month and have used 1", res.data["detail"])
        self.assertIn("(0 left)", res.data["detail"])
        # 0 = unlimited
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "0")
        self.assertEqual(self.ask(reason_type="forgot_in", check_out_time="").status_code, 201)

    def test_rejected_requests_do_not_count(self):
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "1")
        cid = self.ask().data["id"]
        self.assertEqual(self.review(self.sales_mgr, cid, "rejected").status_code, 200)
        self.assertEqual(self.ask().status_code, 201)

    def test_too_far_back_and_future_refused(self):
        self.setting("REGULARIZATION_DAYS_BACK", "2")
        res = self.ask(day=self.today - timedelta(days=5))
        self.assertEqual((res.status_code, res.data["code"]), (400, "too_far_back"))
        self.assertEqual(self.ask(day=self.today - timedelta(days=2)).status_code, 201)
        res = self.ask(day=self.today + timedelta(days=1))
        self.assertEqual(res.status_code, 400)
        self.assertIn("future", str(res.data))

    def test_today_only_after_the_shift(self):
        self.setting("HR_WORK_END", "23:59")
        res = self.ask(day=self.today, check_in_time="00:01", check_out_time="")
        self.assertEqual((res.status_code, res.data["code"]), (400, "shift_not_over"))

    def test_switched_off_and_reasons_allowed(self):
        self.setting("REGULARIZATION_REASONS", "forgot_out")
        res = self.ask(reason_type="wfh")
        self.assertEqual(res.status_code, 400)
        self.assertIn("reason_type", res.data)
        self.assertEqual(self.ask().status_code, 201)
        self.setting("REGULARIZATION_ENABLED", "false")
        res = self.ask(day=self.today - timedelta(days=2))
        self.assertEqual((res.status_code, res.data["code"]), (400, "disabled"))

    def test_needs_a_time_and_a_note_for_other(self):
        self.assertEqual(self.ask(check_in_time="", check_out_time="").status_code, 400)
        res = self.ask(reason_type="other")
        self.assertEqual(res.status_code, 400)
        self.assertIn("reason", res.data)
        self.assertEqual(self.ask(check_in_time="19:00", check_out_time="09:00").status_code, 400)

    def test_one_pending_request_per_day(self):
        self.assertEqual(self.ask().status_code, 201)
        res = self.ask()
        self.assertEqual((res.status_code, res.data["code"]), (400, "duplicate"))

    def test_date_range_on_duty(self):
        start = self.today - timedelta(days=3)
        res = self.ask(day=start, end_date=(start + timedelta(days=1)).isoformat(), reason_type="on_duty",
                       check_in_time="", check_out_time="")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["count"], 2)
        reqs = list(AttendanceCorrection.objects.filter(user=self.rahul).order_by("date"))
        self.assertEqual(len({r.batch for r in reqs}), 1)
        self.assertTrue(reqs[0].batch)
        # on duty without times: the shift's hours
        self.assertEqual(timezone.localtime(reqs[0].requested_check_in).strftime("%H:%M"), "09:30")
        self.assertEqual(timezone.localtime(reqs[0].requested_check_out).strftime("%H:%M"), "18:30")
        # one message to the approver for the range
        self.assertEqual(Notification.objects.filter(user=self.sales_mgr, type="correction_request").count(), 1)

    def test_settings_screen_saves_the_policy(self):
        res = self.as_(self.hr).put("/api/hr/settings/", {"reg_reasons": ["forgot_in", "wfh"], "reg_monthly_limit": 10,
                                                          "reg_mark": "present"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["reg_reasons"]["value"], ["forgot_in", "wfh"])
        self.assertEqual(res.data["reg_monthly_limit"]["value"], 10)
        self.assertNotIn("reg_auto_approve", res.data)   # every request needs approval (founder, 2026-10-24)
        bad = self.as_(self.hr).put("/api/hr/settings/", {"reg_reasons": ["nap"]}, format="json")
        self.assertEqual(bad.status_code, 400)


class ApprovalTests(_Base):
    def test_approve_rewrites_the_day_with_the_rules_and_keeps_the_change(self):
        Attendance.objects.create(user=self.rahul, date=self.yesterday, check_in=self.at(self.yesterday, 9, 0),
                                  status="present")
        cid = self.ask(check_in_time="10:30", check_out_time="19:00").data["id"]
        res = self.review(self.sales_mgr, cid, remarks="ok")
        self.assertEqual(res.status_code, 200, res.content)
        rec = Attendance.objects.get(user=self.rahul, date=self.yesterday)
        self.assertEqual((rec.status, rec.is_late, rec.working_minutes), ("late", True, 510))
        self.assertEqual(rec.regularization_id, cid)
        c = AttendanceCorrection.objects.get(pk=cid)
        self.assertEqual((c.original_status, c.applied_status, c.reviewed_by), ("present", "late", self.sales_mgr))
        self.assertEqual(c.original_check_in, self.at(self.yesterday, 9, 0))
        self.assertIsNone(c.original_check_out)
        self.assertIsNotNone(c.reviewed_at)
        # the person is told, with a link to the day
        note = Notification.objects.get(user=self.rahul, type="correction_reviewed")
        self.assertEqual(note.link, f"/hr?tab=history&date={self.yesterday.isoformat()}&regularization={cid}")
        self.assertEqual(note.category, "attendance")
        # the month shows the tag
        month = self.as_(self.rahul).get("/api/attendance/monthly/", {"year": self.yesterday.year,
                                                                      "month": self.yesterday.month}).data
        day = next(d for d in month["days"] if d["date"] == self.yesterday.isoformat())
        self.assertEqual((day["regularized"], day["regularization_reason"]), (True, "Forgot to punch out"))
        # Daily attendance shows it too
        team = self.as_(self.hr).get("/api/attendance/team_day/", {"date": self.yesterday.isoformat()}).data
        row = next(r for r in team["rows"] if r["user_id"] == self.rahul.id)
        self.assertTrue(row["regularized"])

    def test_short_day_becomes_half_day(self):
        Attendance.objects.create(user=self.rahul, date=self.yesterday, check_in=self.at(self.yesterday, 9, 0),
                                  status="present")
        cid = self.ask(check_in_time="", check_out_time="12:00").data["id"]
        self.assertEqual(self.review(self.sales_mgr, cid).status_code, 200)
        rec = Attendance.objects.get(user=self.rahul, date=self.yesterday)
        self.assertEqual((rec.status, rec.working_minutes), ("half_day", 180))

    def test_mark_present_policy(self):
        self.setting("REGULARIZATION_MARK", "present")
        cid = self.ask(check_in_time="11:00", check_out_time="13:00").data["id"]
        self.review(self.sales_mgr, cid)
        rec = Attendance.objects.get(user=self.rahul, date=self.yesterday)
        self.assertEqual((rec.status, rec.is_late), ("present", False))

    def test_reject_leaves_the_day(self):
        cid = self.ask().data["id"]
        res = self.review(self.sales_mgr, cid, "rejected", "No proof")
        self.assertEqual((res.status_code, res.data["status"]), (200, "rejected"))
        self.assertFalse(Attendance.objects.filter(user=self.rahul, date=self.yesterday).exists())
        self.assertEqual(Notification.objects.filter(user=self.rahul, type="correction_reviewed").count(), 1)
        self.assertEqual(self.review(self.sales_mgr, cid).status_code, 400)

    def test_nobody_approves_their_own_except_the_owner(self):
        cid = self.ask(user=self.hr).data["id"]
        res = self.review(self.hr, cid)
        self.assertEqual(res.status_code, 403)
        self.assertIn("own request", str(res.data))
        cid = self.ask(user=self.owner).data["id"]
        self.assertEqual(self.review(self.owner, cid).status_code, 200)
        self.assertEqual(Attendance.objects.get(user=self.owner, date=self.yesterday).regularization_id, cid)

    def test_approver_outside_their_scope_is_refused(self):
        cid = self.ask(user=self.priya).data["id"]
        self.assertEqual(self.review(self.sales_mgr, cid).status_code, 403)
        self.assertEqual(self.review(self.rahul, cid).status_code, 403)
        self.assertEqual(self.review(self.hr, cid).status_code, 200)
        # and they do not see it in their list
        ids = [r["id"] for r in self.as_(self.sales_mgr).get("/api/attendance-corrections/", {"scope": "team"}).json()["results"]]
        self.assertNotIn(cid, ids)

    def test_bulk_approve(self):
        a = self.ask().data["id"]
        b = self.ask(day=self.today - timedelta(days=2)).data["id"]
        c = self.ask(user=self.priya).data["id"]
        res = self.as_(self.sales_mgr).post("/api/attendance-corrections/bulk_review/",
                                            {"ids": [a, b, c], "decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(sorted(res.data["done"]), sorted([a, b]))
        self.assertEqual([f["id"] for f in res.data["failed"]], [c])
        self.assertEqual(Attendance.objects.filter(user=self.rahul, regularization__isnull=False).count(), 2)

    def test_every_request_waits_for_approval(self):
        res = self.ask(reason_type="wfh", check_in_time="", check_out_time="")
        self.assertEqual((res.status_code, res.data["status"]), (201, "pending"))
        self.assertFalse(Attendance.objects.filter(user=self.rahul, date=self.yesterday).exists())
        cid = res.data["id"]
        self.review(self.sales_mgr, cid)
        rec = Attendance.objects.get(user=self.rahul, date=self.yesterday)
        self.assertEqual((rec.status, rec.working_minutes), ("present", 540))
        month = self.as_(self.rahul).get("/api/attendance/monthly/", {"year": self.yesterday.year,
                                                                      "month": self.yesterday.month}).data
        day = next(d for d in month["days"] if d["date"] == self.yesterday.isoformat())
        self.assertEqual(day["work_mode"], "WFH")

    def test_reporting_manager_without_the_permission_approves(self):
        lead = User.objects.create_user("lead", "lead@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales")
        asha = User.objects.create_user("asha", "asha@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                                        reporting_manager=lead)
        cid = self.ask(user=asha).data["id"]
        # the manager is told, sees it in Approvals and in hr/config
        self.assertEqual(Notification.objects.filter(user=lead, type="correction_request").count(), 1)
        self.assertTrue(self.as_(lead).get("/api/hr/config/").data["can_approve_regularization"])
        ids = [r["id"] for r in self.as_(lead).get("/api/attendance-corrections/", {"scope": "team"}).json()["results"]]
        self.assertEqual(ids, [cid])
        # a colleague without the permission cannot
        self.assertEqual(self.review(self.rahul, cid).status_code, 403)
        self.assertEqual(self.review(lead, cid).status_code, 200)
        self.assertEqual(Attendance.objects.get(user=asha, date=self.yesterday).regularization_id, cid)

    def test_no_manager_goes_to_the_approvers(self):
        cid = self.ask(user=self.priya).data["id"]
        told = set(Notification.objects.filter(type="correction_request").values_list("user__username", flat=True))
        self.assertIn("hr", told)
        self.assertNotIn("sm", told)
        self.assertEqual(self.review(self.hr, cid).status_code, 200)

    def test_payroll_reads_the_corrected_day(self):
        from payroll.services import count_days
        before = count_days(self.rahul, self.yesterday.year, self.yesterday.month, Decimal(30))
        cid = self.ask().data["id"]
        self.review(self.sales_mgr, cid)
        after = count_days(self.rahul, self.yesterday.year, self.yesterday.month, Decimal(30))
        self.assertEqual(after["present"], before["present"] + 1)

    def test_import_and_manual_mark_clear_the_tag(self):
        cid = self.ask().data["id"]
        self.review(self.sales_mgr, cid)
        res = self.as_(self.hr).post("/api/attendance/manual_mark/", {"user": self.rahul.id, "status": "absent",
                                                                      "date": self.yesterday.isoformat()}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(Attendance.objects.get(user=self.rahul, date=self.yesterday).regularization_id)

    def test_report_and_download(self):
        cid = self.ask().data["id"]
        self.review(self.sales_mgr, cid)
        res = self.as_(self.hr).get("/api/attendance/report/", {"type": "regularization", "format": "csv",
                                                                "from": (self.today - timedelta(days=7)).isoformat(),
                                                                "to": self.today.isoformat()})
        self.assertEqual(res.status_code, 200)
        text = res.content.decode("utf-8-sig")
        self.assertIn("Forgot to punch out", text)
        self.assertIn("Was status", text.splitlines()[0])
        # My attendance download has the Regularized column
        res = self.as_(self.rahul).get("/api/attendance/monthly/", {"year": self.yesterday.year,
                                                                    "month": self.yesterday.month, "export": "csv"})
        self.assertIn("Regularized", res.content.decode("utf-8-sig").splitlines()[0])
        # the list download has the from -> to
        res = self.as_(self.sales_mgr).get("/api/attendance-corrections/", {"scope": "team", "export": "csv"})
        self.assertIn("New status", res.content.decode("utf-8-sig").splitlines()[0])


class AttachmentTests(_Base):
    def test_attachment_is_private_to_the_person_and_their_approvers(self):
        upload = SimpleUploadedFile("proof.png", _png(), content_type="image/png")
        res = self.as_(self.rahul).post("/api/attendance-corrections/", {
            "date": self.yesterday.isoformat(), "reason_type": "technical", "check_in_time": "09:30",
            "check_out_time": "18:30", "attachment": upload}, format="multipart")
        self.assertEqual(res.status_code, 201, res.content)
        cid = res.data["id"]
        self.assertIn("?s=", res.data["attachment_url"])        # a signed, expiring link
        self.assertNotIn("attachment", res.data)              # the stored path itself is never sent
        self.assertEqual(self.as_(self.rahul).get(f"/api/attendance-corrections/{cid}/attachment/").status_code, 200)
        self.assertEqual(self.as_(self.sales_mgr).get(f"/api/attendance-corrections/{cid}/attachment/").status_code, 200)
        self.assertEqual(self.as_(self.priya).get(f"/api/attendance-corrections/{cid}/attachment/").status_code, 403)
        # someone else cannot read the request itself
        self.assertEqual(self.as_(self.priya).get(f"/api/attendance-corrections/{cid}/").status_code, 404)
        # the stored file has no public URL without the signature
        c = AttendanceCorrection.objects.get(pk=cid)
        self.assertEqual(self.client.get(c.attachment.url).status_code, 404)

    def test_too_big_attachment_refused(self):
        upload = SimpleUploadedFile("big.pdf", b"%PDF-" + b"0" * (11 * 1024 * 1024), content_type="application/pdf")
        res = self.as_(self.rahul).post("/api/attendance-corrections/", {
            "date": self.yesterday.isoformat(), "reason_type": "technical", "check_in_time": "09:30",
            "attachment": upload}, format="multipart")
        self.assertEqual(res.status_code, 400)


class SettingsCleanTests(TestCase):
    def test_codes_kind(self):
        self.assertEqual(services.clean_setting("reg_reasons", ["wfh", "forgot_in"]), "forgot_in,wfh")
        self.assertEqual(services.clean_setting("reg_reasons", []), "none")
        with self.assertRaises(ValueError):
            services.clean_setting("reg_reasons", "sleep")
