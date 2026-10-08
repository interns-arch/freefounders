"""Settings Center, Tasks side (PLAN.md §16): HR rules edited on screen, the
punch-in photo and its retention, and notification rules."""
import base64
import shutil
import tempfile
from datetime import timedelta
from unittest import mock

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from hr import services
from hr.models import Attendance
from tenancy.company_settings import forget

# A 1x1 JPEG.
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
    "wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==")
PHOTO = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()


class _Base(TestCase):
    def setUp(self):
        forget()
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.hr = User.objects.create_user("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr")
        self.admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.ADMIN, department="management")
        self.member = User.objects.create_user("mem", "mem@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales")
        self.other = User.objects.create_user("oth", "oth@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="purchase")

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)
        forget()

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c


class HRSettingsTests(_Base):
    def test_only_hr_administrators(self):
        self.assertEqual(self.as_(self.member).get("/api/hr/settings/").status_code, 403)
        self.assertEqual(self.as_(self.member).put("/api/hr/settings/", {"work_start": "08:00"}, format="json").status_code, 403)
        res = self.as_(self.hr).get("/api/hr/settings/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["work_start"]["value"], "09:30")
        self.assertFalse(res.json()["work_start"]["custom"])
        self.assertEqual(res.json()["photo"]["value"], "off", "a standalone install keeps photos off")

    def test_saved_values_drive_attendance_rules(self):
        res = self.as_(self.hr).put("/api/hr/settings/", {
            "work_start": "8:5", "grace_minutes": 5, "week_offs": [6, 5], "geofence_enabled": True, "photo": "optional",
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        conf = services.cfg()
        self.assertEqual(conf["work_start"], "08:05")
        self.assertEqual(conf["grace_minutes"], 5)
        self.assertEqual(conf["week_offs"], [5, 6])
        self.assertTrue(conf["geofence_enabled"])
        self.assertEqual(conf["photo"], "optional")
        self.assertTrue(res.json()["work_start"]["custom"])
        # Blank goes back to the server default.
        self.as_(self.hr).put("/api/hr/settings/", {"work_start": ""}, format="json")
        self.assertEqual(services.cfg()["work_start"], "09:30")

    def test_bad_values_are_explained_and_nothing_is_saved(self):
        res = self.as_(self.hr).put("/api/hr/settings/", {
            "work_start": "25:00", "grace_minutes": -1, "week_offs": [9], "photo": "sometimes", "rockets": 1, "work_end": "17:00",
        }, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.json()), {"work_start", "grace_minutes", "week_offs", "photo", "rockets"})
        self.assertEqual(services.cfg()["work_end"], "18:30", "valid values in a rejected request are not saved either")

    def test_no_week_off_at_all(self):
        self.as_(self.hr).put("/api/hr/settings/", {"week_offs": []}, format="json")
        self.assertEqual(services.cfg()["week_offs"], [])


class PunchPhotoTests(_Base):
    def set_photo(self, mode):
        self.as_(self.hr).put("/api/hr/settings/", {"photo": mode}, format="json")

    def test_off_ignores_any_photo(self):
        res = self.as_(self.member).post("/api/attendance/check_in/", {"photo": PHOTO}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertFalse(res.json()["has_check_in_photo"])

    def test_required_refuses_a_punch_without_a_photo(self):
        self.set_photo("required")
        res = self.as_(self.member).post("/api/attendance/check_in/", {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("photo", res.json()["detail"])
        self.assertFalse(Attendance.objects.filter(user=self.member).exists())
        self.assertEqual(self.as_(self.member).get("/api/attendance/today/").json()["photo"], "required")

    def test_photo_is_stored_and_shown_only_to_people_who_may_see_the_record(self):
        self.set_photo("required")
        res = self.as_(self.member).post("/api/attendance/check_in/", {"photo": PHOTO}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()["has_check_in_photo"])
        rec = Attendance.objects.get(user=self.member)
        self.assertTrue(rec.check_in_photo.name.startswith("private/attendance/"))
        url = f"/api/attendance/{rec.pk}/photo/in/"
        for who in (self.member, self.hr):
            got = self.as_(who).get(url)
            self.assertEqual(got.status_code, 200, who.username)
            self.assertEqual(b"".join(got.streaming_content), JPEG)
        self.assertEqual(self.as_(self.other).get(url).status_code, 404)
        self.assertEqual(APIClient().get(url).status_code, 401)
        self.assertEqual(self.as_(self.member).get(f"/api/attendance/{rec.pk}/photo/out/").status_code, 404)
        # Never through the public media route.
        self.assertEqual(APIClient().get("/media/" + rec.check_in_photo.name).status_code, 404)

    def test_check_out_photo(self):
        self.set_photo("optional")
        self.as_(self.member).post("/api/attendance/check_in/", {}, format="json")
        res = self.as_(self.member).post("/api/attendance/check_out/", {"photo": PHOTO}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertFalse(res.json()["has_check_in_photo"])
        self.assertTrue(res.json()["has_check_out_photo"])

    def test_only_real_images_are_accepted(self):
        self.set_photo("optional")
        for bad in ("data:image/jpeg;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+", "not base64 at all!",
                    "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"0" * 500_000).decode()):
            with self.subTest(bad=bad[:30]):
                res = self.as_(self.member).post("/api/attendance/check_in/", {"photo": bad}, format="json")
                self.assertEqual(res.status_code, 400)

    def test_old_photos_are_deleted_after_the_retention_period(self):
        self.as_(self.hr).put("/api/hr/settings/", {"photo_retention_days": 30}, format="json")
        old = Attendance.objects.create(user=self.member, date=timezone.localdate() - timedelta(days=31))
        new = Attendance.objects.create(user=self.other, date=timezone.localdate() - timedelta(days=29))
        for rec in (old, new):
            rec.check_in_photo.save("p.jpg", ContentFile(JPEG))
        path = old.check_in_photo.path
        self.assertEqual(services.purge_attendance_photos(), 1)
        old.refresh_from_db()
        new.refresh_from_db()
        self.assertFalse(old.check_in_photo)
        self.assertTrue(new.check_in_photo)
        import os
        self.assertFalse(os.path.exists(path))


class NotificationRuleTests(_Base):
    def test_only_admins_change_rules(self):
        self.assertEqual(self.as_(self.member).get("/api/notification-rules/").status_code, 403)
        rows = self.as_(self.admin).get("/api/notification-rules/").json()
        self.assertTrue(all(r["email"] and r["whatsapp"] for r in rows), "nothing saved = everything on")
        self.assertEqual(self.as_(self.admin).put("/api/notification-rules/", {"rockets": {"email": False}}, format="json").status_code, 400)
        self.assertEqual(self.as_(self.admin).put("/api/notification-rules/", {"task_given": {"sms": False}}, format="json").status_code, 400)

    def test_a_switched_off_channel_is_skipped_and_in_app_still_happens(self):
        from notifications.models import Notification
        from notifications.service import notify

        res = self.as_(self.admin).put("/api/notification-rules/", {"task_given": {"email": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        row = next(r for r in res.json() if r["key"] == "task_given")
        self.assertEqual((row["email"], row["whatsapp"]), (False, True))
        sent = {"channel": "email", "status": "sent"}
        with mock.patch("notifications.service.gmail.send_email", return_value=sent) as send, \
                mock.patch("notifications.service.whatsapp.send_text", return_value={"channel": "whatsapp", "status": "skipped"}) as wa:
            notify(self.member, "task_assigned", "New task")
            send.assert_not_called()
            wa.assert_called_once()
            notify(self.member, "task_comment", "A comment")      # another group: unchanged
            send.assert_called_once()
        self.assertEqual(Notification.objects.filter(user=self.member).count(), 2)
