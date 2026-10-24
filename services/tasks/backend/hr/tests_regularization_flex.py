"""Regularization: flexible limits and HR adds (PLAN.md §19.38 addendum, 2026-10-24). No upper cap on the company's
limit / days back, the limit period (month / week / year), per-person limits, and HR / a manager regularizing a day
for someone directly (applied at once, not counted, any past day, scope, own-record rule, never a future day, the
person is told, Added by in the record and the downloads)."""
from datetime import date, timedelta

from notifications.models import Notification

from .models import Attendance, AttendanceCorrection
from .tests_regularization import _Base


class FlexibleLimitTests(_Base):
    def test_no_upper_cap(self):
        res = self.as_(self.hr).put("/api/hr/settings/", {"reg_monthly_limit": 5000, "reg_days_back": 365}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["reg_monthly_limit"]["value"], res.data["reg_days_back"]["value"]), (5000, 365))
        self.assertEqual(self.ask(day=self.today - timedelta(days=300)).status_code, 201)
        policy = self.as_(self.rahul).get("/api/attendance-corrections/policy/").data
        self.assertEqual((policy["limit"], policy["period"], policy["days_back"]), (5000, "month", 365))
        bad = self.as_(self.hr).put("/api/hr/settings/", {"reg_monthly_limit": 100001, "reg_limit_period": "day"},
                                    format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(set(bad.data), {"reg_monthly_limit", "reg_limit_period"})

    def test_weekly_period(self):
        self.setting("REGULARIZATION_DAYS_BACK", "60")
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "1")
        self.setting("REGULARIZATION_LIMIT_PERIOD", "week")
        monday = self.today - timedelta(days=self.today.weekday() + 7)    # Monday of last week
        self.assertEqual(self.ask(day=monday).status_code, 201)
        res = self.ask(day=monday + timedelta(days=1))
        self.assertEqual((res.status_code, res.data["code"]), (400, "monthly_limit"))
        self.assertIn("Weekly limit reached: you can raise 1 regularization request(s) a week", res.data["detail"])
        self.assertIn(f"the week of {monday:%d-%m-%Y}", res.data["detail"])
        self.assertEqual(self.ask(day=monday - timedelta(days=1)).status_code, 201)   # the week before

    def test_yearly_period(self):
        self.setting("REGULARIZATION_DAYS_BACK", "1000")
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "2")
        self.setting("REGULARIZATION_LIMIT_PERIOD", "year")
        last_year = date(self.today.year - 1, 6, 10)
        self.assertEqual(self.ask(day=last_year).status_code, 201)
        self.assertEqual(self.ask(day=last_year + timedelta(days=40)).status_code, 201)   # another month, same year
        res = self.ask(day=last_year + timedelta(days=80))
        self.assertEqual(res.status_code, 400)
        self.assertIn("Yearly limit reached", res.data["detail"])
        self.assertIn(f"in {last_year.year} (0 left)", res.data["detail"])
        if self.yesterday.year == self.today.year:   # this year starts again from 0
            self.assertEqual(self.ask().status_code, 201)

    def test_per_person_limits(self):
        self.setting("REGULARIZATION_DAYS_BACK", "100")
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "1")
        res = self.as_(self.hr).put("/api/hr/settings/", {"reg_person_limits": [
            {"user": self.rahul.pk, "limit": 3}, {"user": self.priya.pk, "limit": 0}]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["reg_person_limits"]["value"],
                         [{"user": self.priya.pk, "name": "priya", "limit": 0},
                          {"user": self.rahul.pk, "name": "rahul", "limit": 3}])
        first = (self.today.replace(day=1) - timedelta(days=1)).replace(day=1)   # last month: 4 days in one month
        days = [first + timedelta(days=i) for i in range(4)]
        for d in days[:3]:
            self.assertEqual(self.ask(day=d).status_code, 201)
        res = self.ask(day=days[3])
        self.assertEqual(res.data["code"], "monthly_limit")
        self.assertIn("you can raise 3", res.data["detail"])
        for d in days:   # unlimited for priya
            self.assertEqual(self.ask(user=self.priya, day=d).status_code, 201)
        # everyone else keeps the company's limit
        self.assertEqual(self.ask(user=self.hr, day=days[0]).status_code, 201)
        self.assertEqual(self.ask(user=self.hr, day=days[1]).status_code, 400)
        # the form shows the person's own limit
        self.setting("REGULARIZATION_DAYS_BACK", "100")
        policy = self.as_(self.priya).get("/api/attendance-corrections/policy/").data
        self.assertEqual((policy["limit"], policy["personal_limit"], policy["left"]), (0, True, None))
        bad = self.as_(self.hr).put("/api/hr/settings/", {"reg_person_limits": [{"user": 999999, "limit": 2}]},
                                    format="json")
        self.assertEqual(bad.status_code, 400)
        # an empty list removes them
        res = self.as_(self.hr).put("/api/hr/settings/", {"reg_person_limits": []}, format="json")
        self.assertEqual(res.data["reg_person_limits"]["value"], [])


class HrAddTests(_Base):
    def add(self, actor, target, day=None, **body):
        body = {"user": target.pk, "date": (day or self.yesterday).isoformat(), "reason_type": "forgot_in",
                "check_in_time": "09:30", "check_out_time": "18:30", **body}
        return self.as_(actor).post("/api/attendance-corrections/add_for/", body, format="json")

    def test_applied_at_once_not_counted_any_past_day_and_told(self):
        self.setting("REGULARIZATION_MONTHLY_LIMIT", "1")
        old = self.today - timedelta(days=200)   # far beyond the 7 days back
        res = self.add(self.hr, self.rahul, day=old, reason="Biometric was down")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["status"], res.data["source"], res.data["added_by_detail"]["username"],
                          res.data["reviewed_by_detail"]["username"]), ("approved", "hr", "hr", "hr"))
        self.assertEqual(res.data["original_status"], "absent")
        rec = Attendance.objects.get(user=self.rahul, date=old)
        self.assertEqual((rec.status, rec.working_minutes, rec.regularization_id), ("present", 540, res.data["id"]))
        note = Notification.objects.get(user=self.rahul, type="correction_reviewed")
        self.assertIn("added by hr", note.body)
        self.assertIn(old.strftime("%d-%m-%Y"), note.title)
        # nobody was asked to approve it, and the person's own limit is untouched
        self.assertFalse(Notification.objects.filter(type="correction_request").exists())
        self.add(self.hr, self.rahul, day=self.yesterday)
        self.assertEqual(self.ask(day=self.today - timedelta(days=2)).status_code, 201)
        # Added by in the record and the downloads
        mine = self.as_(self.rahul).get("/api/attendance-corrections/", {"export": "csv"}).content.decode("utf-8-sig")
        self.assertIn("Added by HR", mine)
        self.assertIn("Requested", mine)
        report = self.as_(self.hr).get("/api/attendance/report/", {
            "type": "regularization", "format": "csv", "from": old.isoformat(), "to": self.today.isoformat()})
        text = report.content.decode("utf-8-sig")
        self.assertIn("Source", text.splitlines()[0])
        self.assertIn("Added by hr", text)

    def test_scope_and_own_records(self):
        # the reporting manager for their report; not for someone outside their team
        self.assertEqual(self.add(self.sales_mgr, self.rahul).status_code, 201)
        self.assertEqual(self.add(self.sales_mgr, self.priya).status_code, 403)
        self.assertEqual(self.add(self.rahul, self.priya).status_code, 403)
        people = [p["id"] for p in self.as_(self.sales_mgr).get("/api/attendance-corrections/people/").data]
        self.assertEqual(people, [self.rahul.pk])
        # nobody for themselves, except the Owner
        res = self.add(self.hr, self.hr)
        self.assertEqual(res.status_code, 403)
        self.assertIn("own attendance", str(res.data))
        self.assertEqual(self.add(self.owner, self.owner).status_code, 201)
        self.assertIn(self.owner.pk, [p["id"] for p in self.as_(self.owner).get("/api/attendance-corrections/people/").data])

    def test_future_and_pending_refused(self):
        self.assertEqual(self.add(self.hr, self.rahul, day=self.today + timedelta(days=1)).status_code, 400)
        cid = self.ask().data["id"]
        res = self.add(self.hr, self.rahul)
        self.assertEqual((res.status_code, res.data["code"]), (400, "duplicate"))
        self.assertTrue(AttendanceCorrection.objects.filter(pk=cid, status="pending").exists())
