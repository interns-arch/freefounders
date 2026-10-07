"""Delegated tab: per-agent counts and the done on-time / late filter."""
from datetime import timedelta

from django.utils import timezone

from .models import Task, TaskStatus
from .tests_task_engine import Base


class DelegatedSummaryTests(Base):
    def task(self, taker, giver=None, due_in=1, done_after_due=None):
        now = timezone.now()
        due = now + timedelta(days=due_in)
        kw = {}
        if done_after_due is not None:
            kw = {"status": TaskStatus.DONE,
                  "completed_at": due + timedelta(hours=done_after_due)}
        return Task.objects.create(title="T", assigned_to=taker, created_by=giver or self.manager,
                                   effort_minutes=30, due_at=due, **kw)

    def setUp(self):
        super().setUp()
        self.task(self.rahul)                               # open
        self.task(self.rahul, due_in=-2)                    # open + overdue
        self.task(self.rahul, due_in=-5, done_after_due=-1) # done on time
        self.task(self.rahul, due_in=-5, done_after_due=3)  # done late
        self.task(self.amit)                                # open
        self.task(self.amit, giver=self.admin)              # not mine
        self.task(self.manager)                             # self-assigned: not delegated

    def test_summary_per_agent(self):
        self.as_(self.manager)
        d = self.client.get("/api/tasks/delegated_summary/").data
        by = {a["name"]: a for a in d["agents"]}
        self.assertEqual(set(by), {"rahul", "amit"})
        r = by["rahul"]
        self.assertEqual((r["open"], r["overdue"], r["done_on_time"], r["done_late"], r["total"]),
                         (2, 1, 1, 1, 4))
        self.assertEqual(by["amit"]["open"], 1)
        self.assertEqual(d["totals"]["total"], 5)

    def test_list_filters_by_agent_and_done_on_time_or_late(self):
        self.as_(self.manager)
        base = {"scope": "delegated", "assigned_to": self.rahul.id, "status": "done"}
        late = self.client.get("/api/tasks/", {**base, "done": "late"}).data
        late = late.get("results", late)
        self.assertEqual(len(late), 1)
        ontime = self.client.get("/api/tasks/", {**base, "done": "on_time"}).data
        ontime = ontime.get("results", ontime)
        self.assertEqual(len(ontime), 1)
        opened = self.client.get("/api/tasks/", {"scope": "delegated", "assigned_to": self.rahul.id,
                                                 "status": "open,in_progress"}).data
        self.assertEqual(len(opened.get("results", opened)), 2)
