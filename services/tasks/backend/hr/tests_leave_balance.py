"""Leave balance enforced (PLAN.md §19): applying, editing, HR marking and approving cannot go beyond the balance of a
leave type with a quota; pending + approved count, half days count 0.5, rejected / cancelled do not; unpaid types and
types without a quota stay unlimited; HR can go beyond it only with the explicit override, which is logged."""
from datetime import date, timedelta

from django.utils import timezone

from .models import Attendance, CompOff, LeaveRequest, LeaveType
from .tests import Base


def monday_next_year(week=0):
    """A Monday in next year's March (no holidays in the test database), `week` weeks later."""
    d = date(timezone.localdate().year + 1, 3, 1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d + timedelta(weeks=week)


class LeaveBalanceTests(Base):
    def setUp(self):
        super().setUp()
        self.casual = LeaveType.objects.create(name="Casual", annual_quota=3)

    def apply(self, start, end=None, ltype=None, **extra):
        return self.client.post("/api/leaves/", {
            "leave_type": (ltype or self.casual).id, "start_date": start.isoformat(),
            "end_date": (end or start).isoformat(), "reason": "Family function", **extra,
        }, format="json")

    def test_within_balance_then_over_with_pending_counted(self):
        mon = monday_next_year()
        self.as_(self.rahul)
        self.assertEqual(self.apply(mon, mon + timedelta(days=1)).status_code, 201)  # 2 days, pending
        over = self.apply(monday_next_year(1), monday_next_year(1) + timedelta(days=1))
        self.assertEqual(over.status_code, 400)
        self.assertEqual(over.data["detail"], "You have 1 day(s) of Casual left; this request needs 2.")
        self.assertEqual(self.apply(monday_next_year(1)).status_code, 201, "1 day still fits")
        self.assertEqual(LeaveRequest.objects.filter(user=self.rahul).count(), 2)

    def test_half_days_count_half(self):
        one = LeaveType.objects.create(name="Short", annual_quota=1)
        self.as_(self.rahul)
        first = self.apply(monday_next_year(), ltype=one, half_day=True)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual((first.data["half_day"], first.data["leave_days"]), (True, 0.5))
        self.assertEqual(self.apply(monday_next_year() + timedelta(days=1), ltype=one, half_day=True).status_code, 201)
        third = self.apply(monday_next_year() + timedelta(days=2), ltype=one, half_day=True)
        self.assertEqual(third.status_code, 400)
        self.assertEqual(third.data["detail"], "You have 0 day(s) of Short left; this request needs 0.5.")
        two_dates = self.apply(monday_next_year(2), monday_next_year(2) + timedelta(days=1), half_day=True)
        self.assertEqual(two_dates.status_code, 400)
        self.assertIn("half_day", two_dates.data)
        bal = {b["name"]: b for b in self.client.get(f"/api/leaves/balances/?year={monday_next_year().year}").data}
        self.assertEqual(bal["Short"]["limited"], True)

    def test_rejected_and_cancelled_do_not_count(self):
        mon = monday_next_year()
        self.as_(self.rahul)
        a = self.apply(mon, mon + timedelta(days=2)).data["id"]  # all 3 days
        self.assertEqual(self.apply(monday_next_year(1)).status_code, 400)
        self.client.post(f"/api/leaves/{a}/cancel/")
        b = self.apply(monday_next_year(1), monday_next_year(1) + timedelta(days=2))
        self.assertEqual(b.status_code, 201)
        self.as_(self.manager)
        self.client.post(f"/api/leaves/{b.data['id']}/review/", {"decision": "rejected"})
        self.as_(self.rahul)
        self.assertEqual(self.apply(monday_next_year(2), monday_next_year(2) + timedelta(days=2)).status_code, 201)

    def test_unlimited_types(self):
        unpaid = LeaveType.objects.create(name="Leave without pay", annual_quota=2, paid=False)
        no_quota = LeaveType.objects.create(name="Special", annual_quota=0)
        self.as_(self.rahul)
        mon = monday_next_year()
        self.assertEqual(self.apply(mon, mon + timedelta(days=4), ltype=unpaid).status_code, 201)
        self.assertEqual(self.apply(monday_next_year(1), monday_next_year(1) + timedelta(days=4), ltype=no_quota).status_code, 201)
        bal = {b["name"]: b for b in self.client.get("/api/leaves/balances/").data}
        self.assertEqual((bal["Leave without pay"]["limited"], bal["Leave without pay"]["available"]), (False, None))
        self.assertEqual(bal["Casual"]["limited"], True)

    def test_this_years_balance_shows_available(self):
        today = timezone.localdate()
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=today, end_date=today,
                                    days=1, reason="x", status="approved")
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=today, end_date=today,
                                    days=1, half_day=True, reason="x", status="pending")
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=today, end_date=today,
                                    days=1, reason="x", status="rejected")
        self.as_(self.rahul)
        bal = {b["name"]: b for b in self.client.get("/api/leaves/balances/").data}["Casual"]
        self.assertEqual((bal["quota"], bal["used"], bal["pending"], bal["balance"], bal["available"]), (3, 1, 0.5, 2, 1.5))

    def test_editing_a_pending_request_is_checked_too(self):
        mon = monday_next_year()
        self.as_(self.rahul)
        lid = self.apply(mon).data["id"]
        res = self.client.patch(f"/api/leaves/{lid}/", {"end_date": (mon + timedelta(days=3)).isoformat()}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["detail"], "You have 3 day(s) of Casual left; this request needs 4.")

    def test_hr_marks_leave_for_someone_override_logged(self):
        mon = monday_next_year()
        LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=mon, end_date=mon + timedelta(days=2),
                                    days=3, reason="x", status="approved")
        self.as_(self.amit)   # not an approver
        self.assertEqual(self.apply(monday_next_year(1), user=self.rahul.id).status_code, 403)
        self.as_(self.manager)
        refused = self.apply(monday_next_year(1), user=self.rahul.id)
        self.assertEqual(refused.status_code, 400)
        self.assertTrue(refused.data["beyond_balance_needed"])
        self.assertIn("rahul has 0 day(s) of Casual left; this request needs 1.", refused.data["detail"])
        ok = self.apply(monday_next_year(1), user=self.rahul.id, beyond_balance=True)
        self.assertEqual(ok.status_code, 201, ok.data)
        leave = LeaveRequest.objects.get(pk=ok.data["id"])
        self.assertEqual((leave.user_id, leave.status, leave.beyond_balance, leave.beyond_balance_by_id, leave.reviewed_by_id),
                         (self.rahul.id, "approved", True, self.manager.id, self.manager.id))
        self.assertIsNotNone(leave.beyond_balance_at)
        self.assertEqual(Attendance.objects.filter(user=self.rahul, leave_request=leave, status="leave").count(), 1)
        # Within the balance HR marks it without the flag, and nothing is logged as beyond.
        other = LeaveType.objects.create(name="Earned", annual_quota=10)
        within = self.apply(monday_next_year(2), ltype=other, user=self.rahul.id, beyond_balance=True)
        self.assertEqual(within.status_code, 201)
        self.assertFalse(LeaveRequest.objects.get(pk=within.data["id"]).beyond_balance)

    def test_approving_beyond_the_balance_needs_the_override(self):
        mon = monday_next_year()
        self.as_(self.rahul)
        lid = self.apply(mon, mon + timedelta(days=2)).data["id"]
        self.casual.annual_quota = 1   # HR lowered the quota after it was asked
        self.casual.save()
        self.as_(self.manager)
        team = self.client.get("/api/leaves/?scope=team&status=pending").data["results"]
        self.assertEqual(team[0]["balance_check"], {"available": 1, "needs": 3, "over": True})
        plain = self.client.post(f"/api/leaves/{lid}/review/", {"decision": "approved"})
        self.assertEqual(plain.status_code, 400)
        self.assertTrue(plain.data["beyond_balance_needed"])
        self.assertEqual(LeaveRequest.objects.get(pk=lid).status, "pending")
        # Rejecting never needs it.
        ok = self.client.post(f"/api/leaves/{lid}/review/", {"decision": "approved", "beyond_balance": True}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual((ok.data["status"], ok.data["beyond_balance"], ok.data["beyond_balance_by_detail"]["id"]),
                         ("approved", True, self.manager.id))

    def test_comp_off_balance_is_what_was_banked(self):
        comp = LeaveType.objects.create(name="Comp off", annual_quota=12, is_comp_off=True)
        CompOff.objects.create(user=self.rahul, date=date(2026, 1, 4), days=1)
        self.as_(self.rahul)
        mon = monday_next_year()
        res = self.apply(mon, mon + timedelta(days=1), ltype=comp)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["detail"], "You have 1 day(s) of Comp off left; this request needs 2.")
        self.assertEqual(self.apply(mon, ltype=comp).status_code, 201)
