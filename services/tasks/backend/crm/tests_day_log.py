"""Daily progress log: one entry per (task, day), written by the assignee and
read by everyone who can see the task, rendered as a day-by-day timeline
between the task's start and its due date. Informational only -- it never
blocks completion.
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone

from .models import Task, TaskActivity, TaskDayLog, TaskStatus
from .tests_task_engine import Base


class DayLogTests(Base):
    def setUp(self):
        super().setUp()
        self.task = Task.objects.create(
            title="Two day job", assigned_to=self.rahul, created_by=self.manager,
            effort_minutes=120, due_at=timezone.now() + timedelta(days=2))

    def url(self, task=None):
        return f"/api/tasks/{(task or self.task).id}/day_log/"

    def post(self, body, task=None):
        return self.client.post(self.url(task), body, format="json")

    # ---- writing ---------------------------------------------------------
    def test_assignee_adds_todays_entry(self):
        self.as_(self.rahul)
        res = self.post({"did": "Pulled the vendor list and called four of them",
                         "plan_tomorrow": "Finish the remaining calls",
                         "percent_done": 40, "minutes_spent": 90})
        self.assertEqual(res.status_code, 201)
        log = TaskDayLog.objects.get(task=self.task)
        self.assertEqual(log.date, timezone.localdate())
        self.assertEqual(log.author, self.rahul)
        self.assertEqual(log.plan_tomorrow, "Finish the remaining calls")
        self.assertEqual(log.minutes_spent, 90)
        today = [d for d in res.data["days"] if d["is_today"]][0]
        self.assertEqual(today["entry"]["percent_done"], 40)
        self.assertEqual(today["entry"]["author_name"], self.rahul.username)

    def test_second_post_same_day_edits_not_duplicates(self):
        self.as_(self.rahul)
        self.post({"did": "First version of the day's note"})
        res = self.post({"did": "Corrected version of the day's note"})
        self.assertEqual(res.status_code, 200)          # updated, not created
        self.assertEqual(TaskDayLog.objects.filter(task=self.task).count(), 1)
        self.assertEqual(TaskDayLog.objects.get(task=self.task).did,
                         "Corrected version of the day's note")

    def test_percent_mirrors_into_task_but_minutes_do_not(self):
        """actual_minutes is the running total set by status updates and
        completion -- a day's minutes must never be folded into it."""
        self.as_(self.rahul)
        self.post({"did": "Half the work is done", "percent_done": 40,
                   "minutes_spent": 90})
        self.task.refresh_from_db()
        self.assertEqual(self.task.progress_percent, 40)
        self.assertIsNone(self.task.actual_minutes)
        # a separate status update still owns the total, untouched by the log
        self.client.post(f"/api/tasks/{self.task.id}/progress/",
                         {"spent_minutes": 45}, format="json")
        self.task.refresh_from_db()
        self.assertEqual(self.task.actual_minutes, 45)
        self.assertEqual(TaskDayLog.objects.get(task=self.task).minutes_spent, 90)

    def test_editing_an_older_day_does_not_pull_percent_back(self):
        self.as_(self.rahul)
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.post({"did": "Started on the vendor list", "date": yesterday,
                   "percent_done": 30})
        self.post({"did": "Closed out the calls", "percent_done": 80})
        self.post({"did": "Corrected yesterday, it was barely started",
                   "date": yesterday, "percent_done": 10})
        self.task.refresh_from_db()
        self.assertEqual(self.task.progress_percent, 80)

    def test_open_task_moves_to_in_progress_and_is_logged(self):
        self.as_(self.rahul)
        self.post({"did": "Opened the file and read the brief"})
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, TaskStatus.IN_PROGRESS)
        log = TaskActivity.objects.filter(task=self.task,
                                          text__startswith="Day log").first()
        self.assertIsNotNone(log)
        self.assertIn("Opened the file", log.text)

    # ---- who may write ---------------------------------------------------
    def test_only_assignee_can_write(self):
        self.as_(self.manager)          # the creator: sees the task, cannot write
        self.assertEqual(self.post({"did": "Rahul told me he made a start"})
                         .status_code, 403)
        self.as_(self.amit)             # cannot even see it
        self.assertEqual(self.post({"did": "Not my task at all"}).status_code, 404)

    def test_manager_can_read_the_timeline(self):
        self.as_(self.rahul)
        self.post({"did": "Called the first four vendors"})
        self.as_(self.manager)
        res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["can_write"])
        self.assertEqual(res.data["logged_days"], 1)
        detail = self.client.get(f"/api/tasks/{self.task.id}/")
        self.assertIn("day_log", detail.data)
        self.assertFalse(detail.data["day_log"]["can_write"])

    # ---- validation ------------------------------------------------------
    def test_did_is_required(self):
        self.as_(self.rahul)
        for body in ({}, {"did": "ok"}, {"did": "   "}):
            res = self.post(body)
            self.assertEqual(res.status_code, 400)
            self.assertIn("did", res.data)

    def test_future_date_rejected(self):
        self.as_(self.rahul)
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        res = self.post({"did": "What I will do tomorrow", "date": tomorrow})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Plan for tomorrow", str(res.data["date"]))

    def test_backfill_is_limited_to_the_last_three_days(self):
        self.as_(self.rahul)
        # the task has to have existed on the day being reported
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=10))
        old = (timezone.localdate() - timedelta(days=5)).isoformat()
        self.assertEqual(self.post({"did": "Work from last week", "date": old})
                         .status_code, 400)
        recent = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.assertEqual(self.post({"did": "Yesterday's work, written up late",
                                    "date": recent}).status_code, 201)

    def test_day_before_the_task_started_rejected(self):
        self.as_(self.rahul)
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        res = self.post({"did": "Work from before this existed", "date": yesterday})
        self.assertEqual(res.status_code, 400)
        self.assertIn("no", str(res.data["date"]))

    def test_percent_and_minutes_bounds(self):
        self.as_(self.rahul)
        res = self.post({"did": "A perfectly fine note", "percent_done": 150})
        self.assertEqual(res.status_code, 400)
        self.assertIn("percent_done", res.data)
        res = self.post({"did": "A perfectly fine note", "minutes_spent": 60 * 25})
        self.assertEqual(res.status_code, 400)
        self.assertIn("minutes_spent", res.data)

    # ---- the timeline window --------------------------------------------
    def test_timeline_covers_start_to_due_and_marks_blank_days(self):
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=3),
            due_at=timezone.now() + timedelta(days=1))
        self.as_(self.rahul)
        self.post({"did": "The one day anybody wrote anything"})
        res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
        days = res.data["days"]
        self.assertEqual(len(days), 5)                       # -3 .. +1 inclusive
        self.assertEqual(sum(1 for d in days if d["entry"]), 1)
        self.assertEqual(res.data["missed_days"],
                         sum(1 for d in days if not d["entry"]
                             and not d["is_future"] and not d["is_weekend"]))
        self.assertTrue(any(d["is_today"] for d in days))

    def test_overdue_task_window_stretches_to_today(self):
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=5),
            due_at=timezone.now() - timedelta(days=3))
        self.as_(self.rahul)
        res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
        self.assertEqual(res.data["days"][-1]["date"], timezone.localdate().isoformat())
        self.assertTrue(res.data["can_write"])

    def test_task_without_due_date_still_renders(self):
        Task.objects.filter(pk=self.task.pk).update(due_at=None)
        self.as_(self.rahul)
        res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["days"][-1]["date"], timezone.localdate().isoformat())

    # ---- closed tasks and reassignment ----------------------------------
    def test_no_logs_after_completion(self):
        self.as_(self.rahul)
        self.post({"did": "Everything is finished now"})
        Task.objects.filter(pk=self.task.pk).update(
            status=TaskStatus.DONE, completed_at=timezone.now())
        res = self.post({"did": "One more thought after the fact"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("completed", str(res.data["detail"]))
        read = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
        self.assertEqual(read.status_code, 200)
        self.assertFalse(read.data["can_write"])
        self.assertEqual(read.data["logged_days"], 1)

    def test_reassignment_keeps_old_entries_and_hands_the_pen_over(self):
        self.as_(self.rahul)
        self.post({"did": "Rahul's day on this task"})
        Task.objects.filter(pk=self.task.pk).update(assigned_to=self.amit)
        # the handover takes the task out of Rahul's sight entirely, so
        # visible_tasks() answers before the assignee check ever runs
        self.assertEqual(self.post({"did": "Rahul tries again after handover"})
                         .status_code, 404)
        self.as_(self.amit)
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=3))
        self.assertEqual(self.post({"did": "Amit picks the work up",
                                    "date": yesterday}).status_code, 201)
        self.assertEqual(TaskDayLog.objects.get(task=self.task,
                                                date=timezone.localdate()).author,
                         self.rahul)

    # ---- go-live epoch (existing installations) -------------------------
    def test_days_before_go_live_are_not_shown_or_counted(self):
        """A task already open when the feature shipped must not display
        weeks of blank rows for time when the log did not exist."""
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=90))
        epoch = timezone.localdate() - timedelta(days=1)
        self.as_(self.rahul)
        with override_settings(DAY_LOG_EPOCH=epoch.isoformat()):
            res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
            days = res.data["days"]
            self.assertEqual(days[0]["date"], epoch.isoformat())
            self.assertEqual(res.data["missed_days"],
                             sum(1 for d in days if not d["entry"]
                                 and not d["is_future"] and not d["is_weekend"]))
            self.assertEqual(len(days), 4)          # epoch .. due, not 90 days
            self.assertTrue(all(d["date"] >= epoch.isoformat() for d in days))

    def test_cannot_log_a_day_before_go_live(self):
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=90))
        self.as_(self.rahul)
        yesterday = timezone.localdate() - timedelta(days=1)
        with override_settings(DAY_LOG_EPOCH=timezone.localdate().isoformat()):
            res = self.post({"did": "Work from before the log existed",
                             "date": yesterday.isoformat()})
            self.assertEqual(res.status_code, 400)
            self.assertIn("daily log only started", str(res.data["date"]))

    def test_task_finished_before_go_live_shows_no_log_at_all(self):
        Task.objects.filter(pk=self.task.pk).update(
            created_at=timezone.now() - timedelta(days=90),
            due_at=timezone.now() - timedelta(days=35),
            status=TaskStatus.DONE,
            completed_at=timezone.now() - timedelta(days=30))
        self.as_(self.rahul)
        with override_settings(DAY_LOG_EPOCH=timezone.localdate().isoformat()):
            res = self.client.get(f"/api/tasks/{self.task.id}/day_logs/")
            self.assertEqual(res.data["days"], [])
            self.assertEqual(res.data["missed_days"], 0)

    def test_unique_constraint_at_db_level(self):
        day = timezone.localdate()
        TaskDayLog.objects.create(task=self.task, date=day, author=self.rahul,
                                  did="First row for today")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                TaskDayLog.objects.create(task=self.task, date=day,
                                          author=self.rahul, did="Second row")
