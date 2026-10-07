"""/api/tasks/home/ -- the dashboard's score, mistakes, overdue-by-person,
ageing, top performers and needs-a-look blocks."""
from datetime import timedelta

from django.utils import timezone

from .models import Task, TaskActivity, TaskStatus
from .tests_task_engine import Base


class HomeTests(Base):
    def task(self, who, giver, days_late=None, done=False, **kw):
        now = timezone.now()
        due = now - timedelta(days=days_late) if days_late is not None else now + timedelta(days=2)
        return Task.objects.create(title="T", assigned_to=who, created_by=giver, effort_minutes=30,
                                   due_at=due, status=TaskStatus.DONE if done else TaskStatus.OPEN,
                                   completed_at=now - timedelta(days=(days_late or 0) + 1) if done else None,
                                   **kw)

    def home(self, as_user, **params):
        self.as_(as_user)
        res = self.client.get("/api/tasks/home/", params)
        self.assertEqual(res.status_code, 200, res.data)
        return res.data

    def test_staff_get_their_own_block_and_no_team(self):
        self.task(self.rahul, self.manager, done=True)
        d = self.home(self.rahul)
        self.assertIsNone(d["team"])
        self.assertEqual(d["me"]["completed"], 1)
        self.assertIsNotNone(d["me"]["score"])

    def test_overdue_by_person_and_ageing(self):
        self.task(self.rahul, self.admin, days_late=2)
        self.task(self.rahul, self.admin, days_late=10)
        self.task(self.amit, self.admin, days_late=40)
        self.task(self.amit, self.admin)                      # not overdue
        team = self.home(self.admin)["team"]
        by = {r["name"]: r["overdue"] for r in team["overdue_by_person"]}
        self.assertEqual(by["rahul"], 2)
        self.assertEqual(by["amit"], 1)
        self.assertEqual(team["overdue_by_person"][0]["name"], "rahul")   # most first
        ages = {a["label"]: a["count"] for a in team["ageing"]}
        self.assertEqual(ages, {"1-3 days": 1, "4-7 days": 0, "8-30 days": 1, "30+ days": 1})
        self.assertEqual(team["overdue"], 3)

    def test_department_filter_narrows_the_team(self):
        self.task(self.rahul, self.admin, days_late=2)        # sales
        self.task(self.vikram, self.admin, days_late=2)       # purchase
        team = self.home(self.admin, department="purchase")["team"]
        self.assertEqual([r["name"] for r in team["overdue_by_person"]], ["vikram"])

    def test_quiet_person_with_open_work_needs_a_look(self):
        t = self.task(self.amit, self.admin)
        TaskActivity.objects.create(task=t, actor=self.rahul, text="did something")
        team = self.home(self.admin)["team"]
        names = {r["name"] for r in team["attention"]}
        self.assertIn("amit", names)          # open work, nothing logged
        self.assertNotIn("rahul", names)      # nothing open

    def test_top_performers_ranked_by_score(self):
        self.task(self.rahul, self.admin, done=True)
        self.task(self.amit, self.admin, days_late=1)
        top = self.home(self.admin)["team"]["top"]
        self.assertEqual(top[0]["name"], "rahul")

    def test_bad_custom_range_is_a_400(self):
        self.as_(self.admin)
        res = self.client.get("/api/tasks/home/", {"range": "custom", "start": "2026-10-09",
                                                   "end": "2026-10-01"})
        self.assertEqual(res.status_code, 400)


class PurgeUserTests(Base):
    """My Team -> deactivate -> Delete permanently."""

    def setUp(self):
        super().setUp()
        from accounts.models import Role
        from .tests_task_engine import make
        self.gone = make("anujx", Role.SALES_EXECUTIVE)
        now = timezone.now()
        self.open_t = Task.objects.create(title="his open", assigned_to=self.gone, created_by=self.admin,
                                          effort_minutes=30, due_at=now - timedelta(days=2))
        self.given = Task.objects.create(title="he gave", assigned_to=self.rahul, created_by=self.gone,
                                         effort_minutes=30, due_at=now + timedelta(days=1))
        self.sub = Task.objects.create(title="sub of his", assigned_to=self.amit, created_by=self.admin,
                                       parent=self.open_t, effort_minutes=10, due_at=now)

    def purge(self, who, confirm=None, as_user=None):
        self.as_(as_user or self.admin)
        return self.client.post(f"/api/users/{who.id}/purge/",
                                {"confirm": who.username if confirm is None else confirm}, format="json")

    def test_must_deactivate_first(self):
        self.assertEqual(self.purge(self.gone).status_code, 400)

    def test_preview_counts(self):
        self.as_(self.admin)
        d = self.client.get(f"/api/users/{self.gone.id}/purge/").data
        self.assertEqual((d["tasks_open"], d["tasks_overdue"], d["tasks_given_to_others"]), (1, 1, 1))

    def test_wrong_confirmation_is_refused(self):
        self.gone.is_active = False; self.gone.save()
        self.assertEqual(self.purge(self.gone, confirm="nope").status_code, 400)

    def test_deletes_user_and_their_tasks_keeps_others_work(self):
        from accounts.models import User
        self.gone.is_active = False; self.gone.save()
        res = self.purge(self.gone)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(User.objects.filter(username="anujx").exists())
        self.assertFalse(Task.objects.filter(pk=self.open_t.pk).exists())
        self.given.refresh_from_db()
        self.assertIsNone(self.given.created_by)             # kept, unlinked
        self.sub.refresh_from_db()
        self.assertIsNone(self.sub.parent)                   # someone else's sub-task survives

    def test_non_admin_cannot(self):
        self.gone.is_active = False; self.gone.save()
        self.assertEqual(self.purge(self.gone, as_user=self.rahul).status_code, 403)
