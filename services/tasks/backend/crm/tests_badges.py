"""Count badges (PLAN.md §19.42): GET /api/badges/ counts only what waits for the signed-in person."""
from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from crm.models import Task, TaskChangeRequest, TaskCompletion, TaskStatus
from hr.models import AttendanceCorrection, LeaveRequest, LeaveType
from tenancy.company_settings import forget

MONDAY = date(2026, 11, 2)


class BadgeTests(TestCase):
    def setUp(self):
        forget()
        mk = User.objects.create_user
        self.admin = mk("adm", "adm@x.com", "pass@12345", role=Role.ADMIN)
        self.hr = mk("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr")
        self.manager = mk("sm", "sm@x.com", "pass@12345", role=Role.SALES_MANAGER, department="sales")
        self.rahul = mk("rahul", "rahul@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                        reporting_manager=self.manager)
        self.amit = mk("amit", "amit@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="purchase")
        self.casual = LeaveType.objects.create(name="Casual", annual_quota=12)

    def tearDown(self):
        forget()

    def get(self, user):
        c = APIClient()
        c.force_authenticate(user)
        res = c.get("/api/badges/")
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()

    def task(self, to, by=None, **kw):
        return Task.objects.create(title="Call", assigned_to=to, created_by=by or self.manager, **kw)

    def test_zero_for_a_new_person(self):
        self.assertEqual(self.get(self.amit), {
            "tasks": {"my_tasks": 0, "to_accept": 0, "requests": 0, "total": 0},
            "hr": {"leave": 0, "corrections": 0, "approvals": 0},
            "visitors": {"waiting": 0, "approvals": 0},
        })

    def test_needs_sign_in(self):
        self.assertIn(APIClient().get("/api/badges/").status_code, (401, 403))

    def test_my_tasks_counts_open_and_in_progress_assigned_to_me(self):
        self.task(self.rahul)
        self.task(self.rahul, status=TaskStatus.IN_PROGRESS, due_at=timezone.now() - timedelta(days=1))  # overdue
        self.task(self.rahul, status=TaskStatus.DONE)
        self.task(self.rahul, deleted_at=timezone.now())
        self.task(self.amit)  # someone else's
        self.assertEqual(self.get(self.rahul)["tasks"]["my_tasks"], 2)
        self.assertEqual(self.get(self.manager)["tasks"]["my_tasks"], 0, "tasks I gave out are not mine to do")

    def test_to_accept_only_pending_reviews_where_i_am_the_approver(self):
        t = self.task(self.rahul, status=TaskStatus.DONE)
        TaskCompletion.objects.create(task=t, submitted_by=self.rahul, approver=self.manager)
        TaskCompletion.objects.create(task=t, submitted_by=self.rahul, approver=self.manager, status="approved")
        TaskCompletion.objects.create(task=t, submitted_by=self.rahul, approver=self.admin)
        self.assertEqual(self.get(self.manager)["tasks"]["to_accept"], 1)
        self.assertEqual(self.get(self.rahul)["tasks"]["to_accept"], 0)

    def test_requests_match_the_requests_tab(self):
        t = self.task(self.rahul)
        TaskChangeRequest.objects.create(task=t, requested_by=self.rahul, changes={"title": "x"}, reason="typo")
        mine = self.get(self.manager)["tasks"]
        self.assertEqual(mine["requests"], 1)
        c = APIClient()
        c.force_authenticate(self.manager)
        self.assertEqual(c.get("/api/task-change-requests/?scope=inbox").json()["count"], 1)
        self.assertEqual(mine["total"], 1)
        self.assertEqual(self.get(self.rahul)["tasks"]["requests"], 0, "never your own request")
        self.assertEqual(self.get(self.amit)["tasks"]["requests"], 0)

    def test_approvals_count_leave_and_corrections_in_scope_never_my_own(self):
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=MONDAY, end_date=MONDAY, reason="x")
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=MONDAY + timedelta(days=7),
                                    end_date=MONDAY + timedelta(days=7), reason="x", status="approved")
        AttendanceCorrection.objects.create(user=self.rahul, date=MONDAY, reason="Forgot")
        LeaveRequest.objects.create(user=self.hr, leave_type=self.casual, start_date=MONDAY, end_date=MONDAY, reason="own")
        hr = self.get(self.hr)["hr"]
        self.assertEqual(hr, {"leave": 1, "corrections": 1, "approvals": 2})
        self.assertEqual(self.get(self.manager)["hr"]["approvals"], 2, "the sales department's approver")
        self.assertEqual(self.get(self.amit)["hr"]["approvals"], 0, "no approve permission")
        self.assertEqual(self.get(self.rahul)["hr"]["approvals"], 0)

    def test_regularization_counts_for_the_reporting_manager_without_approve_permission(self):
        # PLAN.md §19.38: a regularization goes to the reporting manager first, so their Approvals badge counts it
        lead = User.objects.create_user("lead", "lead@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                        department="purchase")
        self.amit.reporting_manager = lead
        self.amit.save(update_fields=["reporting_manager"])
        AttendanceCorrection.objects.create(user=self.amit, date=MONDAY, reason="Forgot")
        LeaveRequest.objects.create(user=self.amit, leave_type=self.casual, start_date=MONDAY, end_date=MONDAY, reason="x")
        self.assertEqual(self.get(lead)["hr"], {"leave": 0, "corrections": 1, "approvals": 1},
                         "leave follows the approve rule; regularization also the reporting manager")
