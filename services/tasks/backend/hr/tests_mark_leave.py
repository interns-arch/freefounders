"""HR marks leave for someone (PLAN.md §19.40): the people list, the own-records rule (only the Owner marks their own),
a half-day mark, the notification; and a half-day leave day still lets the person punch in for the other half."""
from django.utils import timezone

from accounts.models import Role
from notifications.models import Notification

from . import services
from .models import Attendance, LeaveRequest, LeaveType
from .tests import Base, make
from .tests_leave_balance import monday_next_year


class MarkLeaveTests(Base):
    def setUp(self):
        super().setUp()
        self.casual = LeaveType.objects.create(name="Casual", annual_quota=5)
        self.owner = make("ownr", Role.SUPER_ADMIN, "management")

    def mark(self, user, start, end=None, **extra):
        return self.client.post("/api/leaves/", {
            "user": user.id, "leave_type": self.casual.id, "start_date": start.isoformat(),
            "end_date": (end or start).isoformat(), "reason": "Called in sick", **extra}, format="json")

    def test_people_list_follows_approve_scope(self):
        self.as_(self.amit)          # no Approve leave
        self.assertEqual(self.client.get("/api/leaves/markable/").data, [])
        self.as_(self.manager)
        ids = {p["id"] for p in self.client.get("/api/leaves/markable/").data}
        self.assertIn(self.rahul.id, ids)
        self.assertNotIn(self.manager.id, ids, "nobody marks their own leave")
        self.as_(self.owner)
        ids = [p["id"] for p in self.client.get("/api/leaves/markable/").data]
        self.assertEqual(ids[0], self.owner.id, "the Owner may mark their own")

    def test_half_day_mark_is_approved_notified_and_counts_half(self):
        mon = monday_next_year()
        self.as_(self.manager)
        res = self.mark(self.rahul, mon, half_day=True)
        self.assertEqual(res.status_code, 201, res.data)
        leave = LeaveRequest.objects.get(pk=res.data["id"])
        self.assertEqual((leave.status, leave.half_day, leave.leave_days, leave.reviewed_by_id),
                         ("approved", True, 0.5, self.manager.id))
        self.assertTrue(leave.remarks.startswith("Marked by"))
        self.assertTrue(Notification.objects.filter(user=self.rahul, title__startswith="Leave marked").exists())
        bal = {b["name"]: b for b in services.leave_balances(self.rahul, mon.year)}["Casual"]
        self.assertEqual((bal["used"], bal["available"]), (0.5, 4.5))

    def test_own_records_rule(self):
        mon = monday_next_year()
        self.as_(self.manager)
        own = self.mark(self.manager, mon)
        self.assertEqual(own.status_code, 201)
        self.assertEqual(LeaveRequest.objects.get(pk=own.data["id"]).status, "pending", "an approver only applies")
        self.as_(self.owner)
        mine = self.mark(self.owner, mon)
        self.assertEqual(mine.status_code, 201, mine.data)
        self.assertEqual(LeaveRequest.objects.get(pk=mine.data["id"]).status, "approved")

    def test_half_day_leave_still_allows_punch_in(self):
        today = timezone.localdate()
        half = LeaveRequest.objects.create(user=self.rahul, leave_type=self.casual, start_date=today, end_date=today,
                                           days=1, half_day=True, reason="x", status="approved")
        Attendance.objects.create(user=self.rahul, date=today, status="leave", leave_request=half)
        rec = services.check_in(self.rahul)
        self.assertIn(rec.status, ("present", "late"))
        self.assertEqual(rec.leave_request_id, half.id)
        full = LeaveRequest.objects.create(user=self.amit, leave_type=self.casual, start_date=today, end_date=today,
                                           days=1, reason="x", status="approved")
        Attendance.objects.create(user=self.amit, date=today, status="leave", leave_request=full)
        with self.assertRaises(services.HRError):
            services.check_in(self.amit)
