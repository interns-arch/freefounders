"""Files stay on a task (also after it is done) and travel to the next copy
of a recurring task; comments are kept whole."""
import shutil
import tempfile
from datetime import timedelta
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from .models import Task, TaskActivity, TaskAttachment, TaskStatus
from .tests_task_engine import Base

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class FilesAndCommentsTests(Base):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def task(self, **kw):
        return Task.objects.create(title="Daily stock sheet", assigned_to=self.rahul,
                                   created_by=self.manager, effort_minutes=30,
                                   due_at=timezone.now() + timedelta(hours=3), **kw)

    def upload(self, who, task, name="sheet.pdf", body=b"%PDF sheet"):
        self.as_(who)
        return self.client.post(f"/api/tasks/{task.id}/upload/",
                                {"file": SimpleUploadedFile(name, body)}, format="multipart")

    def complete(self, task, proof=None):
        self.as_(self.rahul)
        data = {"remarks": "done", "actual_minutes": 20}
        if proof:
            data["file"] = SimpleUploadedFile(proof, b"photo")
        return self.client.post(f"/api/tasks/{task.id}/complete/", data, format="multipart")

    # ---- comments ---------------------------------------------------------
    def test_a_long_comment_is_kept_whole_with_its_line_breaks(self):
        t = self.task()
        text = ("Line one of a long update.\n" + "x" * 1200 + "\nLast line.")
        self.as_(self.manager)
        with mock.patch("crm.task_views.notify") as note:
            res = self.client.post(f"/api/tasks/{t.id}/comment/", {"text": text}, format="json")
        self.assertEqual(res.status_code, 201)
        saved = TaskActivity.objects.get(task=t, kind="comment")
        self.assertEqual(saved.text, text)
        self.assertEqual(res.data[0]["text"], text)
        body = note.call_args.args[3]
        self.assertIn("Last line.", body)                    # the email has all of it
        wa = note.call_args.kwargs["wa_template"][1][3]
        self.assertNotIn("\n", wa)                           # WhatsApp: one line
        self.assertLessEqual(len(wa), 730)

    def test_a_comment_over_the_limit_is_refused_not_cut(self):
        t = self.task()
        self.as_(self.manager)
        res = self.client.post(f"/api/tasks/{t.id}/comment/", {"text": "y" * 5001}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(TaskActivity.objects.filter(task=t, kind="comment").exists())

    # ---- files --------------------------------------------------------------
    def test_files_can_be_added_after_the_task_is_done_and_stay(self):
        t = self.task()
        self.assertEqual(self.complete(t).status_code, 200)
        for who in (self.rahul, self.manager, self.admin):
            res = self.upload(who, t, name=f"{who.username}.pdf")
            self.assertEqual(res.status_code, 201, who.username)
        self.assertEqual(Task.objects.get(pk=t.pk).status, TaskStatus.DONE)
        self.assertEqual(TaskAttachment.objects.filter(task=t).count(), 3)

    def test_completion_proof_is_flagged(self):
        t = self.task()
        self.complete(t, proof="done.jpg")
        a = TaskAttachment.objects.get(task=t)
        self.assertTrue(a.is_proof)
        self.as_(self.rahul)
        self.assertTrue(self.client.get(f"/api/tasks/{t.id}/files/").data[0]["is_proof"])

    def test_next_recurring_copy_keeps_reference_files_not_proof(self):
        t = self.task(frequency="daily")
        self.upload(self.manager, t, name="price-list.pdf", body=b"%PDF prices")
        self.complete(t, proof="today-done.jpg")
        nxt = Task.objects.exclude(pk=t.pk).get(title="Daily stock sheet")
        files = list(nxt.attachments.all())
        self.assertEqual([f.filename for f in files], ["price-list.pdf"])
        self.assertFalse(files[0].is_proof)
        with files[0].file.open("rb") as fh:
            self.assertEqual(fh.read(), b"%PDF prices")
        # its own copy: removing it from the new task leaves the old one intact
        original = t.attachments.get(filename="price-list.pdf")
        self.assertNotEqual(files[0].file.name, original.file.name)
        self.as_(self.manager)
        self.client.post(f"/api/tasks/{nxt.id}/remove_file/", {"id": files[0].id}, format="json")
        with original.file.open("rb") as fh:
            self.assertEqual(fh.read(), b"%PDF prices")
        self.assertTrue(nxt.activities.filter(text__startswith="File carried over").exists())
