"""Notices -> WhatsApp: admin previews the audience, then sends."""
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from notifications.models import Notification

from .models import Notice, NoticeStatus

FAKE = {"channel": "whatsapp", "status": "sent", "detail": ""}
INLINE = mock.patch("crm.task_views._in_background", side_effect=lambda fn: fn())


def make(u, role, phone=""):
    return User.objects.create_user(u, f"{u}@x.com", "pass@12345", role=role,
                                    department="sales", whatsapp_phone=phone)


class NoticeWhatsAppTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN, "9800000001")
        self.a = make("a", Role.SALES_EXECUTIVE, "9800000002")
        self.b = make("b", Role.SALES_EXECUTIVE)                     # no number
        self.gone = make("gone", Role.SALES_EXECUTIVE, "9800000003")
        self.gone.is_active = False; self.gone.save()
        self.n = Notice.objects.create(title="Diwali holiday", content="Office shut\n24-26 Oct.",
                                       status=NoticeStatus.PUBLISHED, publish_at=timezone.now())

    def as_(self, u):
        res = self.client.post("/api/auth/login", {"username": u.username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_preview_counts(self):
        self.as_(self.admin)
        d = self.client.get(f"/api/notices/{self.n.id}/send_whatsapp/").data
        self.assertEqual((d["audience"], d["with_whatsapp"]), (3, 2))
        self.assertEqual(d["without_whatsapp"], ["b"])

    def test_send_uses_the_notice_template_and_skips_email(self):
        self.as_(self.admin)
        with INLINE, mock.patch("notifications.channels.whatsapp.send_template",
                                return_value=FAKE) as tpl, \
                mock.patch("notifications.channels.gmail.send_email") as mail:
            res = self.client.post(f"/api/notices/{self.n.id}/send_whatsapp/")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.data["queued"], 2)
        self.assertEqual(tpl.call_count, 2)
        _, name, params = tpl.call_args.args
        self.assertEqual(name, "company_notice")
        self.assertEqual(params[1], "Diwali holiday")
        self.assertNotIn("\n", params[2])
        mail.assert_not_called()
        self.assertEqual(Notification.objects.filter(type="notice").count(), 2)

    def test_draft_cannot_be_sent(self):
        self.n.status = NoticeStatus.DRAFT; self.n.save()
        self.as_(self.admin)
        self.assertEqual(self.client.post(f"/api/notices/{self.n.id}/send_whatsapp/").status_code, 400)

    def test_staff_cannot_send(self):
        self.as_(self.a)
        self.assertEqual(self.client.post(f"/api/notices/{self.n.id}/send_whatsapp/").status_code, 403)

    def test_falls_back_to_plain_send_when_template_is_refused(self):
        self.as_(self.admin)
        refused = {"channel": "whatsapp", "status": "error", "detail": "HTTP 404"}
        with INLINE, mock.patch("notifications.channels.whatsapp.send_template",
                                return_value=refused),                 mock.patch("notifications.channels.whatsapp.send_text",
                           return_value=FAKE) as txt:
            self.client.post(f"/api/notices/{self.n.id}/send_whatsapp/")
        self.assertEqual(txt.call_count, 2)
        n = Notification.objects.filter(type="notice").first()
        self.assertEqual([c["status"] for c in n.channels], ["error", "sent"])


class NoticeManageTests(TestCase):
    """Edit and Delete used to answer "No Notice matches the given query"."""

    def setUp(self):
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN)
        self.staff = make("a", Role.SALES_EXECUTIVE)
        self.n = Notice.objects.create(title="Old", content="x", status=NoticeStatus.PUBLISHED,
                                       publish_at=timezone.now())

    def as_(self, u):
        res = self.client.post("/api/auth/login", {"username": u.username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_admin_edits_a_notice(self):
        self.as_(self.admin)
        res = self.client.patch(f"/api/notices/{self.n.id}/", {"title": "New"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.n.refresh_from_db()
        self.assertEqual(self.n.title, "New")

    def test_admin_deletes_a_published_notice(self):
        self.as_(self.admin)
        self.assertEqual(self.client.delete(f"/api/notices/{self.n.id}/").status_code, 204)
        self.assertFalse(Notice.objects.filter(pk=self.n.pk).exists())

    def test_staff_cannot_delete(self):
        self.as_(self.staff)
        self.assertIn(self.client.delete(f"/api/notices/{self.n.id}/").status_code, (403, 404))
        self.assertTrue(Notice.objects.filter(pk=self.n.pk).exists())

    def test_archive_and_publish_a_missing_notice_is_404(self):
        self.as_(self.admin)
        self.assertEqual(self.client.post("/api/notices/99999/archive/").status_code, 404)
