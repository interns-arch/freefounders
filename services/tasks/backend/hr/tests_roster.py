"""Roster management (PLAN.md §28): a person's shift for a date (roster entry > default shift > office hours), the
attendance rules that use it (late, early, half day, overnight punches, off days not absent, punch-in reminders,
payroll working days), who may plan whom, the plan gate, the change notification, My roster, export / import."""
import io
import json
import os
from datetime import date, datetime, time, timedelta
from unittest import mock

from django.utils import timezone
from rest_framework.test import APIClient

from accounts import access
from accounts.models import AccessGrant, AccessRole, Role
from notifications.models import Notification
from tenancy.company_settings import forget

from . import roster, services
from .models import (Attendance, AttendanceReminderLog, LeaveRequest, LeaveStatus, LeaveType, PersonShift,
                     RosterEntry, Shift)
from .punch_reminders import send_punch_reminders
from .tests import Base

ENV = {"HR_WORK_START": "09:30", "HR_WORK_END": "18:30", "HR_WEEK_OFF_DAYS": "6", "HR_LATE_GRACE_MINUTES": "15",
       "HR_HALF_DAY_HOURS": "4", "PUNCH_REMINDERS_ENABLED": "", "PUNCH_REMINDER_COUNT": "",
       "PUNCH_REMINDER_GAP_MINUTES": "", "PUNCH_REMINDER_FIRST_MINUTES": "", "ROSTER_MIN_REST_HOURS": ""}


def a_monday(offset_weeks=0):
    d = date(timezone.localdate().year + 1, 3, 1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d + timedelta(weeks=offset_weeks)


DAY = a_monday()   # a future Monday (no holidays in the test database)


def at(day, hh, mm=0):
    return timezone.make_aware(datetime.combine(day, time(hh, mm)), timezone.get_current_timezone())


class RosterBase(Base):
    def setUp(self):
        super().setUp()
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        forget()
        self.off = Shift.objects.get(is_off=True)
        self.general = Shift.objects.create(name="General", code="G", start=time(9, 0), end=time(17, 0))
        self.morning = Shift.objects.create(name="Morning", code="M", start=time(13, 0), end=time(21, 0),
                                            break_minutes=30)
        self.night = Shift.objects.create(name="Night", code="N", start=time(22, 0), end=time(6, 0), colour="info")

    def tearDown(self):
        self.env.stop()
        forget()
        access.forget()
        super().tearDown()

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def put(self, who, user, day, shift):
        RosterEntry.objects.update_or_create(user=user, date=day, defaults={"shift": shift})

    def frozen(self, when):
        return mock.patch("django.utils.timezone.now", return_value=when)


class ResolutionTests(RosterBase):
    def test_precedence_roster_then_default_then_office(self):
        plan = roster.plan_for(self.rahul, DAY)
        self.assertEqual((plan.source, plan.start, plan.end, plan.off), ("office", time(9, 30), time(18, 30), False))
        self.assertIsNone(plan.brief(), "plain office hours keep the old answers")
        PersonShift.objects.create(user=self.rahul, shift=self.general)
        plan = roster.plan_for(self.rahul, DAY)
        self.assertEqual((plan.source, plan.start), ("default", time(9, 0)))
        self.put(None, self.rahul, DAY, self.morning)
        plan = roster.plan_for(self.rahul, DAY)
        self.assertEqual((plan.source, plan.start, plan.brief()["code"]), ("roster", time(13, 0), "M"))
        self.put(None, self.rahul, DAY, self.off)
        self.assertTrue(roster.plan_for(self.rahul, DAY).off)
        self.assertFalse(roster.plan_for(self.amit, DAY).off, "other people keep their own plan")

    def test_week_off_and_rostered_work_on_it(self):
        sunday = DAY + timedelta(days=6)
        self.assertTrue(roster.is_off_day(self.rahul, sunday), "company week-off without a roster entry")
        PersonShift.objects.create(user=self.rahul, shift=self.general)
        self.assertTrue(roster.is_off_day(self.rahul, sunday), "a default shift keeps the company week-off")
        self.put(None, self.rahul, sunday, self.general)
        self.assertFalse(roster.is_off_day(self.rahul, sunday), "rostered to work on the week-off")

    def test_overnight_and_length(self):
        self.put(None, self.rahul, DAY, self.night)
        plan = roster.plan_for(self.rahul, DAY)
        self.assertTrue(plan.overnight)
        self.assertEqual(plan.end_at(), at(DAY + timedelta(days=1), 6))
        self.assertEqual(plan.length_minutes(), 480)
        self.assertEqual(roster.overtime_minutes(plan, 540), 60)


class PunchTests(RosterBase):
    def punch(self, user, kind, when):
        with self.frozen(when):
            return self.api(user).post(f"/api/attendance/{kind}/", {}, format="json")

    def test_no_roster_keeps_office_rules(self):
        self.assertEqual(self.punch(self.rahul, "check_in", at(DAY, 9, 44)).data["is_late"], False)
        self.assertEqual(self.punch(self.amit, "check_in", at(DAY, 9, 46)).data["is_late"], True)
        res = self.punch(self.rahul, "check_out", at(DAY, 18, 0))
        self.assertTrue(res.data["is_early_checkout"])

    def test_late_early_half_day_from_the_rostered_shift(self):
        self.put(None, self.rahul, DAY, self.morning)
        res = self.punch(self.rahul, "check_in", at(DAY, 13, 10))
        self.assertEqual((res.status_code, res.data["is_late"], res.data["status"]), (201, False, "present"),
                         "09:30 office hours would have made 13:10 late")
        res = self.punch(self.rahul, "check_out", at(DAY, 16, 50))
        self.assertEqual((res.data["is_early_checkout"], res.data["status"]), (True, "half_day"))
        self.put(None, self.amit, DAY, self.morning)
        self.assertTrue(self.punch(self.amit, "check_in", at(DAY, 13, 16)).data["is_late"])

    def test_overnight_punches_belong_to_the_start_date(self):
        self.put(None, self.rahul, DAY, self.night)
        res = self.punch(self.rahul, "check_in", at(DAY, 21, 55))
        self.assertEqual((res.data["date"], res.data["is_late"]), (DAY.isoformat(), False))
        with self.frozen(at(DAY + timedelta(days=1), 3, 0)):
            today = self.api(self.rahul).get("/api/attendance/today/").data
        self.assertEqual((today["date"], today["can_check_out"], today["shift"]["code"]), (DAY.isoformat(), True, "N"))
        res = self.punch(self.rahul, "check_out", at(DAY + timedelta(days=1), 6, 5))
        self.assertEqual(res.status_code, 201, res.data)
        rec = Attendance.objects.get(user=self.rahul)
        self.assertEqual((rec.date, rec.working_minutes, rec.is_early_checkout, rec.status), (DAY, 490, False, "present"))

    def test_late_arrival_after_midnight_is_the_previous_shift(self):
        self.put(None, self.amit, DAY, self.night)
        res = self.punch(self.amit, "check_in", at(DAY + timedelta(days=1), 0, 30))
        self.assertEqual((res.data["date"], res.data["is_late"]), (DAY.isoformat(), True))


class OffDayTests(RosterBase):
    def test_off_day_is_week_off_not_absent_and_payroll_counts_it(self):
        today = timezone.localdate()
        first = today.replace(day=1) - timedelta(days=1)
        first = first.replace(day=1)       # last month: every day is past
        weekday = first + timedelta(days=(0 - first.weekday()) % 7)   # its first Monday
        data = services.monthly_report(self.rahul, first.year, first.month)
        before = next(d for d in data["days"] if d["date"] == weekday.isoformat())
        self.assertEqual(before["status"], "absent")
        self.assertNotIn("shift", before)
        self.put(None, self.rahul, weekday, self.off)
        data = services.monthly_report(self.rahul, first.year, first.month)
        day = next(d for d in data["days"] if d["date"] == weekday.isoformat())
        self.assertEqual((day["status"], day["shift"]["code"]), ("week_off", "OFF"))

        from .team import team_day
        row = next(r for r in team_day([self.rahul, self.amit], weekday)["rows"] if r["user_id"] == self.rahul.id)
        self.assertEqual(row["status"], "week_off")

        from payroll.services import count_days, working_days_in
        company = working_days_in(first.year, first.month)
        self.assertEqual(working_days_in(first.year, first.month, self.rahul), company - 1)
        self.assertEqual(working_days_in(first.year, first.month, self.amit), company, "no roster: as before")
        self.assertEqual(count_days(self.rahul, first.year, first.month, company - 1)["payable_days"], 0)

    def test_leave_days_follow_the_roster(self):
        self.put(None, self.rahul, DAY + timedelta(days=1), self.off)
        days = services.leave_working_days(DAY, DAY + timedelta(days=6), self.rahul)
        self.assertEqual(len(days), 5, "Mon–Sat minus the rostered Tuesday off (Sunday is the week-off)")
        self.assertEqual(len(services.leave_working_days(DAY, DAY + timedelta(days=6))), 6)


class ReminderTests(RosterBase):
    def setUp(self):
        super().setUp()
        from accounts.models import User
        User.objects.exclude(pk__in=[self.rahul.pk, self.amit.pk]).update(is_active=False)

    def test_reminders_follow_each_persons_shift(self):
        self.put(None, self.rahul, DAY, self.morning)
        self.assertEqual(send_punch_reminders(now=at(DAY, 10, 0)), 1, "only Amit (office hours 09:30)")
        self.assertFalse(AttendanceReminderLog.objects.filter(user=self.rahul).exists())
        self.assertEqual(send_punch_reminders(now=at(DAY, 13, 30)), 2, "Rahul's first at his shift start + 30; Amit's 2nd")
        self.assertEqual(list(AttendanceReminderLog.objects.filter(user=self.rahul).values_list("n", flat=True)), [1])
        note = Notification.objects.get(user=self.rahul, type="punch_reminder")
        self.assertIn("reporting time 13:00", note.title)

    def test_no_reminder_on_a_rostered_off_day(self):
        self.put(None, self.rahul, DAY, self.off)
        self.assertEqual(send_punch_reminders(now=at(DAY, 10, 0)), 1)
        self.assertFalse(AttendanceReminderLog.objects.filter(user=self.rahul).exists())
        with self.frozen(at(DAY, 10, 0)):
            self.assertEqual(self.api(self.rahul).get("/api/attendance/today/").data["day_off"], "week_off")


class ApiTests(RosterBase):
    def setUp(self):
        super().setUp()
        self.rahul.reporting_manager = self.manager
        self.rahul.save()
        role = AccessRole.objects.get(code=Role.SALES_MANAGER)
        AccessGrant.objects.filter(role=role, permission="hr.roster").delete()
        AccessGrant.objects.create(role=role, permission="hr.roster", scope="team")
        access.forget()

    def test_permissions_and_scope(self):
        self.assertEqual(self.api(self.amit).get("/api/hr/roster/").status_code, 403, "members do not plan")
        c = self.api(self.manager)
        res = c.get(f"/api/hr/roster/?from={DAY}&to={DAY + timedelta(days=6)}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual({p["user_id"] for p in res.data["people"]}, {self.manager.id, self.rahul.id}, "team scope")
        ok = c.put("/api/hr/roster/", {"changes": [{"user": self.rahul.id, "date": str(DAY), "shift": self.night.id}]},
                   format="json")
        self.assertEqual((ok.status_code, ok.data["saved"]), (200, 1))
        no = c.put("/api/hr/roster/", {"changes": [{"user": self.amit.id, "date": str(DAY), "shift": self.night.id}]},
                   format="json")
        self.assertEqual(no.status_code, 403, "Amit is not in the manager's team")
        own = c.put("/api/hr/roster/", {"changes": [{"user": self.manager.id, "date": str(DAY), "shift": self.night.id}]},
                    format="json")
        self.assertEqual(own.status_code, 403, "nobody but the Owner plans their own roster")
        self.assertEqual(c.post("/api/hr/shifts/", {"name": "Late", "code": "L", "start": "11:00", "end": "19:00"},
                                format="json").status_code, 403, "team scope does not edit the shift library")
        admin = self.api(self.admin)
        res = admin.post("/api/hr/shifts/", {"name": "Late", "code": "l", "start": "11:00", "end": "19:00",
                                              "colour": "warning"}, format="json")
        self.assertEqual((res.status_code, res.data["code"]), (201, "L"))
        self.assertEqual(admin.post("/api/hr/shifts/", {"name": "Dup", "code": "L", "start": "11:00", "end": "19:00"},
                                    format="json").status_code, 400)
        self.assertEqual(admin.put("/api/hr/roster/", {"changes": [{"user": self.amit.id, "date": str(DAY),
                                                                     "shift": self.morning.id}]},
                                   format="json").status_code, 200, "HR settings = company scope")
        self.assertEqual(self.api(self.amit).get("/api/hr/shifts/").status_code, 200, "everyone reads the list")

    def test_change_notifies_the_person_and_defaults(self):
        c = self.api(self.admin)
        res = c.put("/api/hr/roster/", {"changes": [{"user": self.rahul.id, "date": str(DAY), "shift": self.night.id}],
                                        "defaults": [{"user": self.amit.id, "shift": self.general.id}]}, format="json")
        self.assertEqual((res.status_code, res.data["notified"], res.data["defaults"]), (200, 1, 1))
        note = Notification.objects.get(user=self.rahul, type="roster_changed")
        self.assertEqual(note.title, f"Your shift on Mon {DAY.day} {DAY:%b} changed to Night 22:00–06:00")
        self.assertEqual(note.category, "attendance")
        self.assertEqual(PersonShift.objects.get(user=self.amit).shift, self.general)
        bad = c.put("/api/hr/roster/", {"defaults": [{"user": self.amit.id, "shift": self.off.id}]}, format="json")
        self.assertEqual(bad.status_code, 400, "Off is not a default shift")
        # clearing the day falls back to the office hours
        c.put("/api/hr/roster/", {"changes": [{"user": self.rahul.id, "date": str(DAY), "shift": None}]}, format="json")
        self.assertFalse(RosterEntry.objects.filter(user=self.rahul).exists())

    def test_leave_day_is_read_only_and_warnings(self):
        lt = LeaveType.objects.create(name="Casual")
        LeaveRequest.objects.create(user=self.rahul, leave_type=lt, start_date=DAY, end_date=DAY, reason="x",
                                    status=LeaveStatus.APPROVED)
        c = self.api(self.admin)
        res = c.put("/api/hr/roster/", {"changes": [{"user": self.rahul.id, "date": str(DAY), "shift": self.night.id}]},
                    format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("on leave", res.data["detail"])
        tue = DAY + timedelta(days=1)
        c.put("/api/hr/roster/", {"changes": [{"user": self.amit.id, "date": str(DAY), "shift": self.night.id},
                                              {"user": self.amit.id, "date": str(tue), "shift": self.general.id}]},
              format="json")
        data = c.get(f"/api/hr/roster/?from={DAY}&to={DAY + timedelta(days=6)}").data
        self.assertEqual([(w["user"], w["date"]) for w in data["warnings"]], [(self.amit.id, str(tue))],
                         "06:00 → 09:00 is 3 h rest")
        self.assertEqual(len(data["leaves"]), 1)

    def test_my_roster(self):
        self.put(None, self.rahul, DAY, self.night)
        with self.frozen(at(DAY, 8)):
            data = self.api(self.rahul).get("/api/hr/roster/mine/?days=7").data
        self.assertEqual(len(data["days"]), 7)
        self.assertEqual((data["days"][0]["code"], data["days"][0]["start"]), ("N", "22:00"))
        self.assertEqual(data["days"][1]["source"], "office")
        self.assertTrue(data["days"][6]["off"])
        self.assertTrue(data["uses_roster"])

    def test_export_and_import(self):
        c = self.api(self.admin)
        self.put(None, self.amit, DAY, self.morning)
        res = c.get(f"/api/hr/roster/?from={DAY}&to={DAY + timedelta(days=6)}&export=csv")
        self.assertEqual(res.status_code, 200)
        text = res.content.decode("utf-8-sig")
        self.assertIn(f"{DAY} Mon", text)
        self.assertIn(",M,", text)
        self.amit.employee_code = "E7"
        self.amit.save()
        csv_text = f"Employee ID,Name,Department,Default shift,{DAY} Mon,{DAY + timedelta(days=1)} Tue\nE7,Amit,,G,N,-\nE9,X,,,G,\n"
        upload = io.BytesIO(csv_text.encode())
        upload.name = "roster.csv"
        dry = c.post("/api/hr/roster/import/", {"file": upload}, format="multipart")
        self.assertEqual((dry.status_code, dry.data["changes"], dry.data["defaults"], len(dry.data["problems"])),
                         (200, 2, 1, 1))
        self.assertEqual(RosterEntry.objects.get(user=self.amit).shift, self.morning, "dry run saves nothing")
        upload = io.BytesIO("Employee ID,Name,Department,Default shift,{0} Mon\nE7,Amit,,G,N\n".format(DAY).encode())
        upload.name = "roster.csv"
        done = c.post("/api/hr/roster/import/", {"file": upload, "dry_run": "false"}, format="multipart")
        self.assertEqual((done.status_code, done.data["saved"]), (200, 1))
        self.assertEqual(RosterEntry.objects.get(user=self.amit).shift, self.night)

    def test_plan_gate(self):
        from tenancy import profile
        from tenancy.models import CompanySetting
        CompanySetting.objects.update_or_create(key=profile.PROFILE_KEY, defaults={"value": json.dumps(
            {"name": "Demo", "modules": {"tasks": True, "attendance": False}})})
        profile.forget()
        try:
            res = self.api(self.admin).get("/api/hr/roster/")
            self.assertEqual(res.status_code, 403)
            self.assertIn("not in your plan", res.json()["detail"])
            self.assertEqual(self.api(self.rahul).get("/api/hr/roster/mine/").status_code, 403)
        finally:
            CompanySetting.objects.filter(key=profile.PROFILE_KEY).delete()
            profile.forget()
