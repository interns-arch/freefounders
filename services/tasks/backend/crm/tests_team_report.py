"""Team performance dashboard: every employee scored over a range and ranked,
with the movement since the period before, rework, deadline pressure and the
load each person is carrying right now. Admin-only, and read-only.
"""
from datetime import timedelta

from django.utils import timezone

from mistakes.models import Mistake
from .models import (CompletionReviewStatus, Task, TaskChangeRequest,
                     TaskCompletion, TaskStatus)
from .tests_task_engine import Base

URL = "/api/tasks/team_report/"


class TeamReportTests(Base):
    def setUp(self):
        super().setUp()
        self.now = timezone.now()

    # ---- helpers ---------------------------------------------------------
    def task(self, who, *, done=False, late=False, overdue=False, effort=60,
             actual=None, days_ago=2, creator=None):
        """One task for `who`, anchored inside this month by its due date."""
        due = self.now - timedelta(days=days_ago)
        t = Task.objects.create(
            title="T", assigned_to=who, created_by=creator or self.manager,
            effort_minutes=effort, actual_minutes=actual, due_at=due,
            status=TaskStatus.DONE if done else TaskStatus.OPEN)
        if done:
            Task.objects.filter(pk=t.pk).update(
                completed_at=due + timedelta(hours=1 if late else -1))
        elif overdue:
            pass                      # open + due in the past == overdue
        else:
            Task.objects.filter(pk=t.pk).update(due_at=self.now + timedelta(days=5))
        return Task.objects.get(pk=t.pk)

    def get(self, **params):
        q = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client.get(f"{URL}?{q}" if q else URL)

    def row_for(self, data, user):
        return next(r for r in data["rows"] if r["user"] == user.pk)

    # ---- access ----------------------------------------------------------
    def test_admin_only(self):
        self.as_(self.rahul)                      # ordinary employee
        self.assertEqual(self.get().status_code, 403)
        self.as_(self.manager)                    # manager: still not the founder view
        self.assertEqual(self.get().status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.get().status_code, 200)

    def test_covers_every_active_employee_even_with_no_tasks(self):
        self.task(self.rahul, done=True)
        self.as_(self.admin)
        rows = self.get().data["rows"]
        self.assertEqual({r["user"] for r in rows},
                         {self.admin.pk, self.manager.pk, self.hr.pk,
                          self.rahul.pk, self.amit.pk, self.vikram.pk})
        idle = self.row_for({"rows": rows}, self.amit)
        self.assertEqual(idle["total"], 0)
        self.assertIsNone(idle["score"])

    # ---- the numbers the founder asked for -------------------------------
    def test_every_employee_carries_the_full_task_breakdown(self):
        self.task(self.rahul, done=True, effort=60, actual=45)
        self.task(self.rahul, done=True, late=True, effort=30, actual=90)
        self.task(self.rahul, overdue=True, effort=120)
        self.task(self.rahul, effort=15)                     # open, not yet due
        self.as_(self.admin)
        # range=all: the not-yet-due task is anchored on its future due date,
        # which can fall outside "this month" when the month is nearly over
        r = self.row_for(self.get(range="all").data, self.rahul)
        self.assertEqual(r["total"], 4)
        self.assertEqual(r["completed"], 2)
        self.assertEqual(r["in_time"], 1)
        self.assertEqual(r["delayed"], 1)
        self.assertEqual(r["overdue"], 1)
        self.assertEqual(r["pending"], 2)                    # open ones
        self.assertEqual(r["time_earned_minutes"], 90)       # 60 + 30 completed
        self.assertEqual(r["time_spent_minutes"], 135)       # 45 + 90 reported
        self.assertEqual(r["time_assigned_minutes"], 225)    # everything in range
        self.assertIn("name", r)
        self.assertIn("role", r)
        self.assertIn("department", r)

    def test_rows_are_ranked_best_first(self):
        for _ in range(3):
            self.task(self.rahul, done=True)                 # all on time
        self.task(self.amit, done=True, late=True)           # late
        self.as_(self.admin)
        rows = [r for r in self.get().data["rows"] if r["score"] is not None]
        self.assertEqual(rows[0]["user"], self.rahul.pk)
        scores = [r["score"] for r in rows]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_score_matches_the_employees_report_exactly(self):
        """One formula, two pages -- they must never disagree."""
        self.task(self.rahul, done=True)
        self.task(self.rahul, done=True, late=True)
        self.task(self.amit, overdue=True)
        self.as_(self.admin)
        team = {r["user"]: r["score"] for r in self.get().data["rows"]}
        emp = self.client.get("/api/tasks/employees_report/?range=this_month").data
        for r in emp["rows"]:
            self.assertEqual(team[r["user"]], r["score"], f"score drift for {r['name']}")

    # ---- team roll-up ----------------------------------------------------
    def test_team_block_reconciles_with_the_rows(self):
        self.task(self.rahul, done=True, effort=60)
        self.task(self.amit, done=True, late=True, effort=30)
        self.task(self.vikram, overdue=True, effort=45)
        self.as_(self.admin)
        d = self.get().data
        t, rows = d["team"], d["rows"]
        self.assertEqual(t["completed"], sum(r["completed"] for r in rows))
        self.assertEqual(t["overdue"], sum(r["overdue"] for r in rows))
        self.assertEqual(t["time_earned_minutes"],
                         sum(r["time_earned_minutes"] for r in rows))
        self.assertEqual(t["people"], len(rows))
        self.assertEqual(t["on_time_rate"], 50.0)            # 1 of 2 completed
        scored = [r["score"] for r in rows if r["score"] is not None]
        self.assertEqual(t["team_score"], round(sum(scored) / len(scored), 1))

    # ---- movement vs the period before -----------------------------------
    def test_delta_compares_against_the_preceding_period(self):
        last_month = (self.now.replace(day=1) - timedelta(days=5))
        old = Task.objects.create(title="old", assigned_to=self.rahul,
                                  created_by=self.manager, effort_minutes=60,
                                  due_at=last_month, status=TaskStatus.DONE)
        Task.objects.filter(pk=old.pk).update(
            completed_at=last_month + timedelta(hours=5))     # late -> low score
        self.task(self.rahul, done=True, effort=60)           # this month: on time
        self.as_(self.admin)
        d = self.get(range="this_month").data
        self.assertIsNotNone(d["previous"]["start"])
        r = self.row_for(d, self.rahul)
        self.assertIsNotNone(r["score_prev"])
        self.assertEqual(r["score_delta"], round(r["score"] - r["score_prev"], 1))
        self.assertGreater(r["score_delta"], 0)               # improved

    def test_all_time_has_no_previous_period(self):
        self.task(self.rahul, done=True)
        self.as_(self.admin)
        d = self.get(range="all").data
        self.assertIsNone(d["previous"]["start"])
        for r in d["rows"]:
            self.assertIsNone(r["score_delta"])

    # ---- rework, pressure, current load ----------------------------------
    def test_rework_counts_only_completions_sent_back(self):
        t = self.task(self.rahul, done=True)
        TaskCompletion.objects.create(task=t, submitted_by=self.rahul,
                                      approver=self.manager,
                                      status=CompletionReviewStatus.REJECTED)
        TaskCompletion.objects.create(task=t, submitted_by=self.rahul,
                                      approver=self.manager,
                                      status=CompletionReviewStatus.APPROVED)
        self.as_(self.admin)
        r = self.row_for(self.get().data, self.rahul)
        self.assertEqual(r["rework_submitted"], 2)
        self.assertEqual(r["rework_rejected"], 1)
        self.assertEqual(r["rework_rate"], 50.0)

    def test_deadline_pressure_splits_extensions_from_cancellations(self):
        t = self.task(self.rahul, overdue=True)
        TaskChangeRequest.objects.create(
            task=t, requested_by=self.rahul,
            changes={"due_at": self.now.isoformat()}, reason="need more time")
        TaskChangeRequest.objects.create(
            task=t, requested_by=self.rahul,
            changes={"cancel": True}, reason="not needed any more")
        TaskChangeRequest.objects.create(
            task=t, requested_by=self.rahul,
            changes={"priority": "low"}, reason="less urgent")
        self.as_(self.admin)
        r = self.row_for(self.get().data, self.rahul)
        self.assertEqual(r["extension_requests"], 1)
        self.assertEqual(r["cancel_requests"], 1)      # the priority one counts as neither

    def test_current_load_is_live_not_range_bound(self):
        self.task(self.rahul, overdue=True)
        self.task(self.rahul, effort=30)                       # open, due later
        self.task(self.rahul, done=True)                       # done: not a load
        self.as_(self.admin)
        r = self.row_for(self.get(range="today").data, self.rahul)
        self.assertEqual(r["open_tasks"], 2)                   # despite range=today
        self.assertEqual(r["open_overdue"], 1)

    # ---- flags -----------------------------------------------------------
    def test_unscored_person_is_explained_not_shown_as_zero(self):
        self.task(self.rahul, done=True, creator=self.rahul)   # self-assigned
        self.as_(self.admin)
        r = self.row_for(self.get().data, self.rahul)
        self.assertIsNone(r["score"])
        self.assertTrue(any("self-assigned" in f for f in r["flags"]))

    def test_overdue_pile_is_flagged(self):
        for _ in range(3):
            self.task(self.rahul, overdue=True)
        self.as_(self.admin)
        d = self.get().data
        r = self.row_for(d, self.rahul)
        self.assertTrue(any("past their date" in f for f in r["flags"]))
        self.assertGreaterEqual(d["team"]["at_risk"], 1)

    def test_mistakes_pull_the_score_down_and_are_reported(self):
        self.task(self.rahul, done=True)
        Mistake.objects.create(employee=self.rahul, reported_by=self.manager,
                               category="Process", severity="high",
                               description="Sent the wrong quote to a customer")
        self.as_(self.admin)
        r = self.row_for(self.get().data, self.rahul)
        self.assertEqual(r["mistakes"], 1)
        self.assertGreater(r["mistake_penalty"], 0)
        self.assertEqual(r["score"], round(max(0, r["task_score"] - r["mistake_penalty"]), 1))

    # ---- it must not change anything -------------------------------------
    def test_endpoint_is_read_only(self):
        self.task(self.rahul, done=True)
        before = (Task.objects.count(), TaskCompletion.objects.count(),
                  TaskChangeRequest.objects.count())
        self.as_(self.admin)
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual((Task.objects.count(), TaskCompletion.objects.count(),
                          TaskChangeRequest.objects.count()), before)

    def test_formula_is_published_with_the_numbers(self):
        self.as_(self.admin)
        d = self.get().data
        self.assertIn("on-time rate", d["formula"])
        self.assertIn("mistake penalty", d["formula"])
