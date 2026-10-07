"""Bulk accept on "To accept": tick rows or pick a person, accept in one go.
Same outcome as accepting one by one, one summary ping per person."""
from datetime import timedelta
from unittest import mock

from django.utils import timezone

from notifications.models import Notification

from .models import Task, TaskActivity, TaskCompletion, TaskStatus
from .tests_task_engine import Base

INLINE = mock.patch("crm.task_views._in_background", side_effect=lambda fn: fn())


class BulkAcceptTests(Base):
    def setUp(self):
        super().setUp()
        self.reviews = []
        for who, n in ((self.rahul, 3), (self.amit, 2)):
            for i in range(n):
                t = Task.objects.create(title=f"{who.username} job {i}", assigned_to=who,
                                        created_by=self.manager, effort_minutes=30,
                                        status=TaskStatus.DONE, completed_at=timezone.now(),
                                        due_at=timezone.now() + timedelta(days=1))
                self.reviews.append(TaskCompletion.objects.create(
                    task=t, submitted_by=who, approver=self.manager))

    def accept(self, ids, as_user=None, **extra):
        self.as_(as_user or self.manager)
        with INLINE:
            return self.client.post("/api/task-completions/bulk_accept/",
                                    {"ids": ids, **extra}, format="json")

    def ids(self, who=None):
        return [c.id for c in self.reviews if who is None or c.submitted_by == who]

    def test_accept_all_accepts_every_one_and_keeps_tasks_done(self):
        res = self.accept(self.ids())
        self.assertEqual(res.data, {"accepted": 5, "skipped": 0})
        for c in TaskCompletion.objects.all():
            self.assertEqual(c.status, "approved")
            self.assertEqual(c.reviewed_by, self.manager)
            self.assertEqual(c.task.status, TaskStatus.DONE)
        self.assertEqual(TaskActivity.objects.filter(
            text__startswith="Completion accepted by").count(), 5)

    def test_one_person_only(self):
        self.assertEqual(self.accept(self.ids(self.amit)).data["accepted"], 2)
        self.assertEqual(TaskCompletion.objects.filter(
            submitted_by=self.rahul, status="pending").count(), 3)

    def test_one_summary_per_person_not_one_per_task(self):
        self.accept(self.ids())
        rahul = Notification.objects.filter(user=self.rahul, type="task_completion_accepted")
        self.assertEqual(rahul.count(), 1)
        self.assertIn("3 tasks", rahul.get().body)
        self.assertEqual(Notification.objects.filter(
            user=self.amit, type="task_completion_accepted").count(), 1)

    def test_a_single_task_reads_like_the_normal_accept(self):
        self.accept(self.ids(self.rahul)[:1])
        n = Notification.objects.get(user=self.rahul, type="task_completion_accepted")
        self.assertTrue(n.title.startswith("Accepted: T-"))

    def test_already_decided_and_other_peoples_reviews_are_left_alone(self):
        first = self.reviews[0]
        first.status, first.remarks = "rejected", "Attach the invoice copy"
        first.save()
        stranger = TaskCompletion.objects.create(
            task=self.reviews[1].task, submitted_by=self.rahul, approver=self.admin)
        res = self.accept(self.ids() + [stranger.id])
        self.assertEqual(res.data, {"accepted": 4, "skipped": 2})
        first.refresh_from_db(); stranger.refresh_from_db()
        self.assertEqual((first.status, first.remarks), ("rejected", "Attach the invoice copy"))
        self.assertEqual(stranger.status, "pending")

    def test_clicking_twice_is_harmless(self):
        self.accept(self.ids())
        self.assertEqual(self.accept(self.ids()).data, {"accepted": 0, "skipped": 5})
        self.assertEqual(Notification.objects.filter(
            type="task_completion_accepted").count(), 2)

    def test_someone_else_cannot_accept_my_inbox(self):
        self.assertEqual(self.accept(self.ids(), as_user=self.amit).data["accepted"], 0)
        self.assertEqual(TaskCompletion.objects.filter(status="pending").count(), 5)

    def test_bad_input_is_refused(self):
        for body in ([], "all", [True], ["1"]):
            self.assertEqual(self.accept(body).status_code, 400)
