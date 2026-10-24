"""Approvals (PLAN.md §17.2): who decides leave and corrections, approvers hear about new requests,
and anything left waiting is reminded, then escalated."""
from datetime import date, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, User
from crm.models import Task, TaskChangeRequest
from hr.models import LeaveRequest, LeaveType
from notifications.models import Notification
from tenancy.company_settings import forget, set_value

MONDAY = date(2026, 11, 2)


class _Base(TestCase):
    def setUp(self):
        forget()
        mk = User.objects.create_user
        self.hr = mk("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr")
        self.dept_approver = mk("sm", "sm@x.com", "pass@12345", role=Role.SALES_MANAGER, department="sales")
        self.lead = mk("lead", "lead@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales")
        self.rahul = mk("rahul", "rahul@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales",
                        reporting_manager=self.lead)
        self.other = mk("oth", "oth@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="purchase")
        self.casual = LeaveType.objects.create(name="Casual", annual_quota=12)
        self.gmail = mock.patch("notifications.service.gmail.send_email", return_value={"channel": "email", "status": "skipped"})
        self.wa = mock.patch("notifications.service.whatsapp.send_text", return_value={"channel": "whatsapp", "status": "skipped"})
        self.gmail.start()
        self.wa.start()

    def tearDown(self):
        self.gmail.stop()
        self.wa.stop()
        forget()

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def apply(self, user=None):
        res = self.as_(user or self.rahul).post("/api/leaves/", {
            "leave_type": self.casual.id, "start_date": MONDAY.isoformat(), "end_date": MONDAY.isoformat(), "reason": "Family",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return LeaveRequest.objects.get(pk=res.json()["id"])

    def review(self, user, leave, decision="approved"):
        return self.as_(user).post(f"/api/leaves/{leave.pk}/review/", {"decision": decision}, format="json")

    def told(self, user, type_):
        return Notification.objects.filter(user=user, type=type_).count()


class DepartmentRuleTests(_Base):
    """The default: today's rule, plus the approvers now hear about new requests."""

    def test_department_approvers_are_told_and_decide(self):
        leave = self.apply()
        self.assertEqual(self.told(self.dept_approver, "leave_request"), 1)
        self.assertEqual(self.told(self.lead, "leave_request"), 0)
        self.assertEqual(self.review(self.lead, leave).status_code, 403, "a manager without hr.approve cannot, by default")
        self.assertEqual(self.review(self.other, leave).status_code, 403)
        self.assertEqual(self.review(self.dept_approver, leave).status_code, 200)

    def test_correction_approvers_are_told(self):
        res = self.as_(self.rahul).post("/api/attendance-corrections/", {
            "date": (timezone.localdate() - timedelta(days=1)).isoformat(), "reason": "Forgot to check out",
            # A day without a check-in needs the check-in too (regularization, PLAN.md §19.38).
            "requested_check_in": (timezone.now() - timedelta(days=1, hours=1)).isoformat(),
            "requested_check_out": (timezone.now() - timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        # A regularization goes to the reporting manager (PLAN.md §19.38), not the department approvers.
        self.assertEqual(self.told(self.lead, "correction_request"), 1)
        self.assertEqual(self.told(self.dept_approver, "correction_request"), 0)


class ManagerRuleTests(_Base):
    def setUp(self):
        super().setUp()
        set_value("APPROVAL_LEAVE", "manager")

    def test_the_manager_is_told_sees_it_and_decides(self):
        leave = self.apply()
        self.assertEqual(self.told(self.lead, "leave_request"), 1)
        self.assertEqual(self.told(self.dept_approver, "leave_request"), 0)
        self.assertTrue(self.as_(self.lead).get("/api/hr/config/").json()["can_approve"])
        team = self.as_(self.lead).get("/api/leaves/?scope=team").json()
        self.assertEqual([r["id"] for r in team["results"]], [leave.pk])
        self.assertEqual(self.review(self.lead, leave).status_code, 200)

    def test_department_approvers_and_hr_can_still_act_others_cannot(self):
        a = self.apply()
        self.assertEqual(self.review(self.other, a).status_code, 403)
        self.assertEqual(self.review(self.dept_approver, a).status_code, 200)
        b = LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=MONDAY + timedelta(days=7),
                                        end_date=MONDAY + timedelta(days=7), reason="x")
        self.assertEqual(self.review(self.hr, b).status_code, 200)

    def test_nobody_approves_their_own(self):
        own = self.apply(self.lead)
        self.assertEqual(self.review(self.lead, own).status_code, 403)

    def test_without_a_manager_it_goes_to_the_department(self):
        self.rahul.reporting_manager = None
        self.rahul.save()
        self.apply()
        self.assertEqual(self.told(self.dept_approver, "leave_request"), 1)


class ReminderTests(_Base):
    def age(self, obj, hours):
        type(obj).objects.filter(pk=obj.pk).update(created_at=timezone.now() - timedelta(hours=hours))

    def test_leave_reminded_once_then_escalated_once(self):
        from hr.approvals import remind_and_escalate
        leave = self.apply()
        self.assertEqual(remind_and_escalate(), 0, "not yet")
        self.age(leave, 25)
        remind_and_escalate()
        remind_and_escalate()
        self.assertEqual(self.told(self.dept_approver, "approval_reminder"), 1)
        self.assertEqual(self.told(self.hr, "approval_escalated"), 0)
        self.age(leave, 49)
        remind_and_escalate()
        remind_and_escalate()
        self.assertEqual(self.told(self.hr, "approval_escalated"), 1)

    def test_decided_requests_and_switched_off_reminders_stay_quiet(self):
        from hr.approvals import remind_and_escalate
        leave = self.apply()
        self.review(self.dept_approver, leave)
        self.age(leave, 100)
        self.assertEqual(remind_and_escalate(), 0)
        set_value("APPROVAL_REMIND_HOURS", "0")
        other = self.apply(self.other)
        self.age(other, 100)
        self.assertEqual(remind_and_escalate(), 0)

    def test_task_change_requests_are_reminded_then_go_to_admins(self):
        from crm.reminders import remind_task_approvals
        admin = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.ADMIN, department="management")
        task = Task.objects.create(title="Quarterly report", assigned_to=self.rahul, created_by=self.lead)
        req = TaskChangeRequest.objects.create(task=task, requested_by=self.rahul, changes={"due_at": None}, reason="Need a week more")
        self.age(req, 25)
        remind_task_approvals()
        remind_task_approvals()
        self.assertEqual(self.told(self.lead, "approval_reminder"), 1)
        self.age(req, 49)
        remind_task_approvals()
        remind_task_approvals()
        self.assertEqual(self.told(admin, "approval_escalated"), 1)
        req.refresh_from_db()
        self.assertIsNotNone(req.admin_alerted_at)
