"""/api/tasks/delegation/ -- who gives tasks, who receives them."""
from datetime import timedelta

from django.utils import timezone

from .models import Task, TaskActivity
from .tests_task_engine import Base


class DelegationTests(Base):
    def give(self, giver, taker, days_ago=0, **kw):
        t = Task.objects.create(title="T", assigned_to=taker, created_by=giver,
                                effort_minutes=30, due_at=timezone.now() + timedelta(days=1), **kw)
        Task.objects.filter(pk=t.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
        return t

    def get(self, **params):
        self.as_(self.admin)
        res = self.client.get("/api/tasks/delegation/", params)
        self.assertEqual(res.status_code, 200, res.data)
        return {p["name"]: p for p in res.data["people"]}, res.data

    def test_counts_given_and_received_per_window(self):
        today = timezone.localdate()
        for _ in range(3):
            self.give(self.manager, self.rahul)
        self.give(self.manager, self.amit, days_ago=400)        # long ago: overall only
        people, _ = self.get(date=today.isoformat())
        m = people["meera"]
        self.assertEqual(m["given"]["day"], 3)
        self.assertEqual(m["given"]["all"], 4)
        self.assertEqual(people["rahul"]["received"]["day"], 3)
        self.assertEqual(people["amit"]["received"]["day"], 0)
        self.assertEqual(people["amit"]["received"]["all"], 1)

    def test_self_assigned_is_counted_apart(self):
        self.give(self.rahul, self.rahul)
        people, _ = self.get()
        self.assertEqual(people["rahul"]["given"]["all"], 0)
        self.assertEqual(people["rahul"]["self"]["all"], 1)

    def test_recurring_repeats_and_form_tasks_are_not_giving(self):
        t = self.give(self.manager, self.rahul)
        TaskActivity.objects.create(task=t, actor=self.manager, text="Auto-created next daily occurrence")
        self.give(self.manager, self.rahul, description="Auto-created from form 'X' submission #1")
        people, _ = self.get()
        self.assertEqual(people["meera"]["given"]["all"], 0)

    def test_no_labels_just_counts(self):
        self.give(self.admin, self.rahul)
        people, data = self.get()
        self.assertNotIn("tag", people["boss"])
        self.assertTrue(data["everyone"])

    def test_a_manager_sees_only_their_own_numbers(self):
        self.give(self.manager, self.rahul)
        self.as_(self.manager)
        res = self.client.get("/api/tasks/delegation/")
        self.assertEqual([p["name"] for p in res.data["people"]], ["meera"])
        self.assertEqual(res.data["people"][0]["given"]["all"], 1)
        self.assertFalse(res.data["everyone"])

    def test_staff_only_see_themselves(self):
        self.as_(self.rahul)
        res = self.client.get("/api/tasks/delegation/")
        self.assertEqual([p["name"] for p in res.data["people"]], ["rahul"])

    def test_bad_date(self):
        self.as_(self.admin)
        self.assertEqual(self.client.get("/api/tasks/delegation/", {"date": "x"}).status_code, 400)


class DelegationPersonTests(Base):
    def give(self, giver, taker, days_ago=0):
        t = Task.objects.create(title="T", assigned_to=taker, created_by=giver,
                                effort_minutes=30, due_at=timezone.now() + timedelta(days=1))
        Task.objects.filter(pk=t.pk).update(created_at=timezone.now() - timedelta(days=days_ago))

    def test_who_gave_to_whom(self):
        for _ in range(3):
            self.give(self.admin, self.rahul)
        self.give(self.manager, self.rahul)
        self.give(self.rahul, self.amit)
        self.give(self.rahul, self.rahul)                         # self: ignored
        self.as_(self.admin)
        d = self.client.get("/api/tasks/delegation/person/", {"user": self.rahul.id}).data
        got = {r["name"]: r["all"] for r in d["received_from"]}
        self.assertEqual(got, {"boss": 3, "meera": 1})
        self.assertEqual(d["received_from"][0]["name"], "boss")   # most first
        self.assertEqual([(r["name"], r["all"]) for r in d["gave_to"]], [("amit", 1)])

    def test_staff_can_see_only_their_own(self):
        self.as_(self.rahul)
        self.assertEqual(self.client.get("/api/tasks/delegation/person/").status_code, 200)
        res = self.client.get("/api/tasks/delegation/person/", {"user": self.amit.id})
        self.assertEqual(res.status_code, 403)
