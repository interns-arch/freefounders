"""Role duties (PLAN.md §17.3) arrive with the roles and become tasks: one per person per period."""
import uuid
from datetime import date, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import access
from accounts.models import Role, User, UserAccessRole
from accounts.tests_platform import JWKS, token
from crm.duties import create_duty_tasks
from crm.models import DutyRun, RoleDuty, Task

MONDAY, WEDNESDAY, SUNDAY = date(2026, 11, 2), date(2026, 11, 4), date(2026, 11, 8)


@override_settings(PLATFORM_JWKS=JWKS)
class DutyTests(TestCase):
    def setUp(self):
        access.forget()
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.role_id = uuid.uuid4()
        self.pid = uuid.uuid4()
        self.asha = User.objects.create_user("asha", "a@x.com", "pass@12345", role=Role.WAREHOUSE, platform_person_id=self.pid)
        self.ids = {k: str(uuid.uuid4()) for k in ("daily", "weekly", "monthly", "once")}
        self.version = 0
        self.notify = mock.patch("notifications.service.gmail.send_email",
                                 return_value={"channel": "email", "status": "skipped"})
        self.notify.start()

    def tearDown(self):
        self.notify.stop()
        access.forget()

    def push(self, duties=None, people=None):
        self.version += 1
        duties = duties if duties is not None else [
            {"id": self.ids["daily"], "title": "Open the store", "frequency": "daily", "steps": ["Unlock", "Count cash"]},
            {"id": self.ids["weekly"], "title": "Weekly stock check", "frequency": "weekly", "weekday": 2},
            {"id": self.ids["monthly"], "title": "Monthly audit", "frequency": "monthly", "monthDay": 25},
            {"id": self.ids["once"], "title": "Read the store SOP", "frequency": "once"},
        ]
        res = self.api.put("/api/internal/access", {
            "version": self.version,
            "roles": [{"id": str(self.role_id), "code": "store_keeper", "name": "Store Keeper", "level": 1,
                       "grants": [{"app": "tasks", "permission": "tasks.view", "scope": "team"}], "duties": duties}],
            "people": people if people is not None else [{"personId": str(self.pid), "roleIds": [str(self.role_id)]}],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def titles(self, user):
        return sorted(Task.objects.filter(assigned_to=user).values_list("title", flat=True))

    def test_duties_arrive_with_the_role(self):
        self.push()
        self.assertEqual(RoleDuty.objects.filter(active=True).count(), 4)
        self.assertEqual(RoleDuty.objects.get(duty_id=self.ids["weekly"]).weekday, 2)

    def test_daily_duty_once_per_working_day_with_its_checklist(self):
        self.push()
        create_duty_tasks(MONDAY)
        create_duty_tasks(MONDAY)
        daily = Task.objects.filter(assigned_to=self.asha, title="Open the store")
        self.assertEqual(daily.count(), 1)
        self.assertEqual(list(daily.first().checklist.order_by("order").values_list("text", flat=True)), ["Unlock", "Count cash"])
        create_duty_tasks(SUNDAY)  # week-off: nothing new
        self.assertEqual(daily.count(), 1)
        create_duty_tasks(MONDAY + timedelta(days=1))
        self.assertEqual(daily.count(), 2)

    def test_weekly_and_monthly_wait_for_their_day(self):
        self.push()
        create_duty_tasks(MONDAY)
        self.assertNotIn("Weekly stock check", self.titles(self.asha))
        create_duty_tasks(WEDNESDAY)
        create_duty_tasks(WEDNESDAY + timedelta(days=1))
        self.assertEqual(self.titles(self.asha).count("Weekly stock check"), 1)
        self.assertNotIn("Monthly audit", self.titles(self.asha))
        create_duty_tasks(date(2026, 11, 25))
        create_duty_tasks(date(2026, 11, 26))
        self.assertEqual(self.titles(self.asha).count("Monthly audit"), 1)

    def test_joining_checklist_only_for_people_who_get_the_role_later(self):
        # Asha already held the role before the duty existed: no joining checklist for her.
        self.push(duties=[])
        UserAccessRole.objects.filter(user=self.asha).update(created_at=timezone.now() - timedelta(days=30))
        self.push()
        create_duty_tasks(MONDAY)
        self.assertNotIn("Read the store SOP", self.titles(self.asha))
        # A new joiner gets it once.
        ravi_pid = uuid.uuid4()
        ravi = User.objects.create_user("ravi", "r@x.com", "pass@12345", role=Role.WAREHOUSE, platform_person_id=ravi_pid)
        self.push(people=[{"personId": str(self.pid), "roleIds": [str(self.role_id)]},
                          {"personId": str(ravi_pid), "roleIds": [str(self.role_id)]}])
        create_duty_tasks(MONDAY)
        create_duty_tasks(MONDAY + timedelta(days=1))
        self.assertEqual(self.titles(ravi).count("Read the store SOP"), 1)
        from notifications.models import Notification
        self.assertTrue(Notification.objects.filter(user=ravi, type="task_assigned").exists())

    def test_removed_duties_and_inactive_people_get_nothing(self):
        self.push()
        self.push(duties=[{"id": self.ids["weekly"], "title": "Weekly stock check", "frequency": "weekly", "weekday": 0}])
        self.assertFalse(RoleDuty.objects.get(duty_id=self.ids["daily"]).active)
        self.asha.is_active = False
        self.asha.save()
        self.assertEqual(create_duty_tasks(MONDAY), 0)
        self.assertEqual(DutyRun.objects.count(), 0)
