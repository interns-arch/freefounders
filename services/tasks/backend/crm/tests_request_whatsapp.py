"""WhatsApp reminders when a request lands on someone: a time/change request
and a "task done, accept it" review. Non-admin receivers get the WhatsApp;
admins keep in-app + email only."""
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from accounts.models import Role
from notifications.models import Notification

from .models import Task
from .tests_task_engine import Base, make

FAKE = {"channel": "whatsapp", "status": "sent", "detail": ""}


class RequestWhatsAppTests(Base):
    def setUp(self):
        super().setUp()
        for u in (self.admin, self.manager, self.rahul):
            u.whatsapp_phone = "9876543210"
            u.save()

    def task(self, giver, assignee):
        return Task.objects.create(title="Fix gate", assigned_to=assignee, created_by=giver,
                                   effort_minutes=30, due_at=timezone.now() + timedelta(days=1))

    def ask_more_time(self, task, as_user):
        self.as_(as_user)
        new_due = (timezone.now() + timedelta(days=3)).isoformat()
        with mock.patch("notifications.channels.whatsapp.send_template",
                        return_value=FAKE) as tpl, \
                mock.patch("notifications.channels.whatsapp.send_text",
                           return_value=FAKE) as txt:
            res = self.client.post(f"/api/tasks/{task.id}/request_change/",
                                   {"changes": {"due_at": new_due}, "reason": "Parts late"},
                                   format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return tpl, txt

    def finish(self, task, as_user):
        self.as_(as_user)
        with mock.patch("notifications.channels.whatsapp.send_template",
                        return_value=FAKE) as tpl, \
                mock.patch("notifications.channels.whatsapp.send_text",
                           return_value=FAKE) as txt:
            res = self.client.post(f"/api/tasks/{task.id}/complete/",
                                   {"remarks": "done", "actual_minutes": 20})
        self.assertEqual(res.status_code, 200, res.data)
        return tpl, txt

    @staticmethod
    def templates(tpl):
        # the separate "task completed" FYI still goes to everyone involved
        return [c.args[1] for c in tpl.call_args_list]

    def test_time_request_whatsapps_a_non_admin_giver(self):
        tpl, txt = self.ask_more_time(self.task(self.manager, self.rahul), self.rahul)
        tpl.assert_called_once()
        phone, name, params = tpl.call_args.args
        self.assertEqual(name, "task_change_request")
        self.assertEqual(params[0], "meera")            # the approver
        self.assertEqual(params[1], "rahul")            # who asked
        self.assertIn("Due date", params[3])
        self.assertEqual(params[4], "Parts late")
        txt.assert_not_called()

    def test_time_request_to_an_admin_is_in_app_and_email_only(self):
        tpl, txt = self.ask_more_time(self.task(self.admin, self.rahul), self.rahul)
        tpl.assert_not_called()
        txt.assert_not_called()
        n = Notification.objects.get(user=self.admin, type="task_change_request")
        self.assertIn({"channel": "whatsapp", "status": "skipped",
                       "detail": "not sent to this user"}, n.channels)

    def test_completion_review_whatsapps_a_non_admin_giver(self):
        tpl, _ = self.finish(self.task(self.manager, self.rahul), self.rahul)
        self.assertIn("task_completion_review", self.templates(tpl))
        self.assertTrue(Notification.objects.filter(
            user=self.manager, type="task_completion_review").exists())

    def test_completion_review_to_an_admin_skips_whatsapp(self):
        tpl, _ = self.finish(self.task(self.admin, self.rahul), self.rahul)
        self.assertNotIn("task_completion_review", self.templates(tpl))
        self.assertTrue(Notification.objects.filter(
            user=self.admin, type="task_completion_review").exists())

    def test_super_admin_counts_as_admin(self):
        sup = make("sup", Role.SUPER_ADMIN, "management")
        tpl, _ = self.finish(self.task(sup, self.rahul), self.rahul)
        self.assertNotIn("task_completion_review", self.templates(tpl))


class CompletionProofFilesTests(Base):
    """The giver sees the photos/files sent with the work in To accept."""

    def test_proof_files_show_in_to_accept(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        t = Task.objects.create(title="Fix signage", assigned_to=self.rahul, created_by=self.manager,
                                effort_minutes=30, due_at=timezone.now() + timedelta(days=1))
        # a file someone else put on the task is not the submitter's proof
        from .models import TaskAttachment
        TaskAttachment.objects.create(task=t, filename="brief.pdf", uploaded_by=self.manager,
                                      file=SimpleUploadedFile("brief.pdf", b"x"))
        self.as_(self.rahul)
        with mock.patch("notifications.channels.whatsapp.send_template", return_value=FAKE):
            res = self.client.post(f"/api/tasks/{t.id}/complete/", {
                "remarks": "done", "actual_minutes": 20,
                "file": [SimpleUploadedFile("after.jpg", b"img", content_type="image/jpeg"),
                         SimpleUploadedFile("bill.pdf", b"pdf", content_type="application/pdf")]})
        self.assertEqual(res.status_code, 200, res.data)
        self.as_(self.manager)
        rows = self.client.get("/api/task-completions/?scope=inbox").data
        rows = rows.get("results", rows)
        names = sorted(f["filename"] for f in rows[0]["files"])
        self.assertEqual(names, ["after.jpg", "bill.pdf"])
        self.assertTrue(all(f["url"] for f in rows[0]["files"]))
