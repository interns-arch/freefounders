"""Cross-app rules, Tasks side (PLAN.md §17.4): the outbox, tasks created for another app's work (an Assets
ticket), the "finished" event only once the work is accepted, and the exit checklist."""
import uuid
from datetime import date
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from accounts.tests_platform import JWKS, token
from crm.models import Task, TaskCompletion
from tenancy.company_settings import forget, set_value
from tenancy.models import OutboxEvent


@override_settings(PLATFORM_JWKS=JWKS)
class FlowTests(TestCase):
    def setUp(self):
        forget()
        self.platform = APIClient()
        self.platform.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.boss_pid, self.it_pid, self.leaver_pid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        mk = User.objects.create_user
        self.boss = mk("boss", "b@x.com", "pass@12345", role=Role.IT_LEAD, platform_person_id=self.boss_pid)
        self.it = mk("it", "i@x.com", "pass@12345", role=Role.IT_TEAM, platform_person_id=self.it_pid, reporting_manager=self.boss)
        self.leaver = mk("leaver", "l@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, platform_person_id=self.leaver_pid,
                         reporting_manager=self.boss)
        self.hr = mk("hr", "h@x.com", "pass@12345", role=Role.HR_MANAGER)
        self.mail = mock.patch("notifications.service.gmail.send_email", return_value={"channel": "email", "status": "skipped"})
        self.mail.start()

    def tearDown(self):
        self.mail.stop()
        forget()

    def ticket_task(self, **extra):
        return self.platform.post("/api/internal/tasks", {
            "assigneePersonId": str(self.it_pid), "title": "Ticket TKT-00001: Laptop will not start",
            "description": "Reported by Mia", "priority": "HIGH", "externalRef": "assets:ticket:abc",
            "externalUrl": "/assets/tickets?open=abc", **extra}, format="json")

    def events(self, after=0):
        return self.platform.get(f"/api/internal/events?after={after}").json()

    def test_internal_endpoints_need_the_platform(self):
        for path in ("/api/internal/events", "/api/internal/tasks", "/api/internal/exit-tasks"):
            res = APIClient().get(path) if path.endswith("events") else APIClient().post(path, {}, format="json")
            self.assertEqual(res.status_code, 401, path)

    def test_a_ticket_becomes_a_task_once(self):
        res = self.ticket_task()
        self.assertEqual(res.status_code, 201, res.content)
        task = Task.objects.get(pk=res.json()["taskId"])
        self.assertEqual((task.assigned_to, task.priority, task.external_url), (self.it, "high", "/assets/tickets?open=abc"))
        again = self.ticket_task()
        self.assertEqual((again.status_code, again.json()["taskId"], again.json()["created"]), (200, task.pk, False))
        self.assertEqual(self.ticket_task(assigneePersonId=str(uuid.uuid4()), externalRef="assets:ticket:zzz").status_code, 404)

    def complete(self, task, user):
        c = APIClient()
        c.force_authenticate(user)
        return c.post(f"/api/tasks/{task.pk}/complete/", {"remarks": "Replaced the battery", "actual_minutes": 30}, format="json")

    def test_finished_is_announced_only_when_the_work_is_accepted(self):
        task = Task.objects.get(pk=self.ticket_task().json()["taskId"])
        self.assertEqual(self.complete(task, self.it).status_code, 200)
        # No giver: the manager reviews it, so nothing is announced yet.
        review = TaskCompletion.objects.get(task=task)
        self.assertEqual(review.approver, self.boss)
        self.assertEqual(self.events(), [])
        c = APIClient()
        c.force_authenticate(self.boss)
        self.assertEqual(c.post(f"/api/task-completions/{review.pk}/review/", {"decision": "approved"}, format="json").status_code, 200)
        evts = self.events()
        self.assertEqual([e["type"] for e in evts], ["task.completed"])
        self.assertEqual(evts[0]["payload"]["externalRef"], "assets:ticket:abc")
        self.assertEqual(evts[0]["payload"]["remarks"], "Replaced the battery")
        self.assertEqual(self.events(after=evts[0]["id"]), [])

    def test_no_reviewer_means_finished_at_once_and_plain_tasks_say_nothing(self):
        self.it.reporting_manager = None
        self.it.save()
        with mock.patch("crm.task_views._completion_reviewer", return_value=None):
            task = Task.objects.get(pk=self.ticket_task().json()["taskId"])
            self.complete(task, self.it)
            plain = Task.objects.create(title="Plain", assigned_to=self.it, created_by=self.it)
            self.complete(plain, self.it)
        self.assertEqual([e["payload"]["externalRef"] for e in self.events()], ["assets:ticket:abc"])

    def test_nothing_is_written_without_platform_sign_in(self):
        from tenancy.outbox import emit
        with override_settings(PLATFORM_JWKS="", PLATFORM_JWKS_URL=""):
            emit("task.completed", {})
        self.assertEqual(OutboxEvent.objects.count(), 0)

    def test_exit_checklist_goes_to_the_manager_once(self):
        res = self.platform.post("/api/internal/exit-tasks", {"personId": str(self.leaver_pid), "lastWorkingDate": "2026-11-30",
                                                              "reason": "Moving cities"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        task = Task.objects.get(pk=res.json()["taskId"])
        self.assertEqual(task.assigned_to, self.boss)
        self.assertEqual(task.due_at.date(), date(2026, 11, 30))
        self.assertEqual(task.checklist.count(), 5)
        again = self.platform.post("/api/internal/exit-tasks", {"personId": str(self.leaver_pid), "lastWorkingDate": "2026-11-30"}, format="json")
        self.assertEqual(again.json()["created"], False)

    def test_exit_checklist_without_a_manager_goes_to_hr_with_the_company_list(self):
        self.leaver.reporting_manager = None
        self.leaver.save()
        set_value("EXIT_CHECKLIST", "Return laptop\nReturn SIM\n\nSign NDA")
        res = self.platform.post("/api/internal/exit-tasks", {"personId": str(self.leaver_pid), "lastWorkingDate": "2026-11-30"}, format="json")
        task = Task.objects.get(pk=res.json()["taskId"])
        self.assertEqual(task.assigned_to, self.hr)
        self.assertEqual(list(task.checklist.order_by("order").values_list("text", flat=True)), ["Return laptop", "Return SIM", "Sign NDA"])
