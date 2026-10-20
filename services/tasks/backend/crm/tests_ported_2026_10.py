"""Tasks changes ported from the original app on 2026-10-20 (PLAN.md §19.30), adapted to FreeFounders:
"Super Admin" is the Owner here (accounts.access.is_owner = holds tasks.delete_admin_work; in these standalone
tests that is the built-in Super Admin role, as the Platform's hidden Owner role is in a company).

  3fbf6e7  only the Owner gives a task to the Owner
  6ec1bc6  deleting a task you were given needs the giver's approval; the Owners are told
  d40034c  WhatsApp only inside the company's hours; givers reminded to accept; nobody accepts their own work
  3ff22ba  a task someone gave you is changed through them, admins included
  d0a1bdf  Voice draft from words said on the phone/browser (no AI key)
  748b527  remove a wrong or outdated file from a task
  2bc1425  Team performance: who asks most to change a due date/time
"""
from datetime import datetime, timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from accounts.models import Role, User
from notifications import service
from notifications.models import Notification

from .models import ChangeRequestStatus, Task, TaskChangeRequest, TaskCompletion, TaskStatus
from .tests_task_engine import Base, make

SENT = {"channel": "whatsapp", "status": "sent", "wamid": ""}


# ---- 3fbf6e7 ---------------------------------------------------------------
class OwnerOnlyAssignTests(Base):
    def setUp(self):
        super().setUp()
        self.owner = make("prateekx", Role.SUPER_ADMIN, "management")
        self.owner2 = make("yashx", Role.SUPER_ADMIN, "management")

    def test_staff_and_admin_cannot_assign_to_the_owner(self):
        for who in (self.manager, self.admin):
            res = self.create_task(who, self.owner)
            self.assertEqual(res.status_code, 403, who.username)
            self.assertIn("Only the Owner", str(res.data))
        self.assertFalse(Task.objects.filter(assigned_to=self.owner).exists())

    def test_owner_can_assign_to_an_owner_and_themselves(self):
        self.assertEqual(self.create_task(self.owner, self.owner2).status_code, 201)
        self.assertEqual(self.create_task(self.owner, self.owner).status_code, 201)

    def test_everyone_else_is_still_assignable(self):
        self.assertEqual(self.create_task(self.manager, self.admin).status_code, 201)
        self.assertEqual(self.create_task(self.manager, self.amit).status_code, 201)

    def test_picker_hides_owners_from_non_owners(self):
        self.as_(self.admin)
        names = {p["name"] for p in self.client.get("/api/tasks/assignees/").data}
        self.assertNotIn("prateekx", names)
        self.assertIn("rahul", names)
        self.as_(self.owner)
        names = {p["name"] for p in self.client.get("/api/tasks/assignees/").data}
        self.assertIn("yashx", names)

    def test_reassigning_to_the_owner_is_refused(self):
        t = Task.objects.create(title="T", assigned_to=self.amit, created_by=self.admin,
                                effort_minutes=30, due_at=timezone.now() + timedelta(days=1))
        self.as_(self.admin)
        res = self.client.patch(f"/api/tasks/{t.id}/", {"assigned_to": self.owner.id}, format="json")
        self.assertEqual(res.status_code, 403)
        t.refresh_from_db()
        self.assertEqual(t.assigned_to, self.amit)

    def test_change_request_to_hand_it_to_the_owner_is_refused(self):
        t = Task.objects.create(title="T", assigned_to=self.amit, created_by=self.manager,
                                effort_minutes=30, due_at=timezone.now() + timedelta(days=1))
        self.as_(self.amit)
        res = self.client.post(f"/api/tasks/{t.id}/request_change/",
                               {"changes": {"assigned_to": self.owner.id}, "reason": "he knows it"},
                               format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Only the Owner", str(res.data))


# ---- 6ec1bc6 ---------------------------------------------------------------
class DeleteByRequestTests(Base):
    def setUp(self):
        super().setUp()
        self.admin2 = make("yashy", Role.ADMIN, "management")
        self.owner = make("prateeky", Role.SUPER_ADMIN, "management")
        # admin -> admin
        self.t = Task.objects.create(title="Watch training", assigned_to=self.admin2,
                                     created_by=self.admin, effort_minutes=30,
                                     due_at=timezone.now() + timedelta(days=1))

    def ask(self, who=None):
        self.as_(who or self.admin2)
        return self.client.post(f"/api/tasks/{self.t.id}/request_change/",
                                {"changes": {"cancel": True}, "reason": "Not needed any more"},
                                format="json")

    def test_receiver_admin_cannot_delete_directly(self):
        self.as_(self.admin2)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.t.id}/").status_code, 403)
        self.t.refresh_from_db()
        self.assertIsNone(self.t.deleted_at)
        self.assertFalse(self.client.get(f"/api/tasks/{self.t.id}/").data["can_delete"])

    def test_giver_can_delete_directly(self):
        self.as_(self.admin)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.t.id}/").status_code, 204)

    def test_request_goes_to_the_giver_and_approval_moves_it_to_deleted(self):
        res = self.ask()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(Notification.objects.filter(user=self.admin, type="task_change_request").exists())
        req = TaskChangeRequest.objects.get(task=self.t)
        self.as_(self.admin)                               # the giver approves
        inbox = self.client.get("/api/task-change-requests/?scope=inbox").data["results"]
        self.assertEqual([r["id"] for r in inbox], [req.id])
        res = self.client.post(f"/api/task-change-requests/{req.id}/review/",
                               {"decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.t.refresh_from_db()
        self.assertIsNotNone(self.t.deleted_at)            # in the Deleted bin
        n = Notification.objects.get(user=self.owner, type="task_deleted_on_request")
        self.assertIn("yashy", n.body)
        self.assertIn("Not needed any more", n.body)

    def test_another_admin_cannot_decide_or_see_someone_elses_delete_request(self):
        self.ask()
        req = TaskChangeRequest.objects.get(task=self.t)
        other = make("otheradmin", Role.ADMIN, "management")
        self.as_(other)
        self.assertEqual(self.client.get("/api/task-change-requests/?scope=inbox").data["results"], [])
        res = self.client.post(f"/api/task-change-requests/{req.id}/review/",
                               {"decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.t.refresh_from_db()
        self.assertIsNone(self.t.deleted_at)

    def test_owner_can_still_delete_anything_and_decide_it(self):
        self.ask()
        req = TaskChangeRequest.objects.get(task=self.t)
        self.as_(self.owner)
        res = self.client.post(f"/api/task-change-requests/{req.id}/review/",
                               {"decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)

    def test_a_giver_who_left_hands_it_to_the_owners(self):
        User.objects.filter(pk=self.admin.pk).update(is_active=False)
        self.ask()
        self.as_(self.owner)
        inbox = self.client.get("/api/task-change-requests/?scope=inbox").data["results"]
        self.assertEqual(len(inbox), 1)

    def test_rejected_request_keeps_the_task(self):
        self.ask()
        req = TaskChangeRequest.objects.get(task=self.t)
        self.as_(self.admin)
        self.client.post(f"/api/task-change-requests/{req.id}/review/",
                         {"decision": "rejected", "remarks": "Still needed"}, format="json")
        self.t.refresh_from_db()
        self.assertIsNone(self.t.deleted_at)
        self.assertFalse(Notification.objects.filter(type="task_deleted_on_request").exists())


# ---- d40034c ---------------------------------------------------------------
def at(hour):
    return timezone.make_aware(datetime(2026, 10, 15, hour, 30))


class WhatsAppHoursTests(Base):
    @override_settings(WHATSAPP_HOURS="10-19")
    def test_window_edges(self):
        self.assertFalse(service.in_whatsapp_hours(at(9)))
        self.assertTrue(service.in_whatsapp_hours(at(10)))
        self.assertTrue(service.in_whatsapp_hours(at(18)))
        self.assertFalse(service.in_whatsapp_hours(at(19)))

    @override_settings(WHATSAPP_HOURS="10-19")
    def test_the_company_sets_its_own_hours(self):
        from tenancy.company_settings import forget, set_value
        self.addCleanup(forget)
        set_value("WHATSAPP_HOURS", "8-21")
        self.assertTrue(service.in_whatsapp_hours(at(8)))
        self.assertTrue(service.in_whatsapp_hours(at(20)))

    def test_settings_endpoint(self):
        from tenancy.company_settings import forget
        self.addCleanup(forget)
        self.as_(self.rahul)
        self.assertEqual(self.client.get("/api/whatsapp-hours/").status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.client.put("/api/whatsapp-hours/", {"start": 19, "end": 10}, format="json").status_code, 400)
        res = self.client.put("/api/whatsapp-hours/", {"start": 9, "end": 20}, format="json")
        self.assertEqual(res.data, {"start": 9, "end": 20})
        self.assertEqual(self.client.get("/api/whatsapp-hours/").data, {"start": 9, "end": 20})

    @mock.patch("notifications.service.whatsapp.send_template", return_value=SENT)
    def test_inside_hours_sends_at_once(self, send):
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=True):
            n = service.notify(self.rahul, "x", "Hello", wa_template=("t", ["a"]))
        send.assert_called_once()
        self.assertIsNone(n.wa_deferred)

    @mock.patch("notifications.service.whatsapp.send_template", return_value=SENT)
    def test_outside_hours_is_held_then_sent_at_opening(self, send):
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=False):
            n = service.notify(self.rahul, "x", "Hello", wa_template=("t", ["a", "b"]))
            self.assertEqual(service.send_deferred_whatsapp(), 0)   # still closed
        send.assert_not_called()
        n.refresh_from_db()
        self.assertEqual(n.wa_deferred["template"], "t")
        self.assertIn("deferred", [c["status"] for c in n.channels])

        with mock.patch("notifications.service.in_whatsapp_hours", return_value=True):
            self.assertEqual(service.send_deferred_whatsapp(), 1)
            self.assertEqual(service.send_deferred_whatsapp(), 0)   # only once
        send.assert_called_once_with(self.rahul.whatsapp_phone, "t", ["a", "b"])
        n.refresh_from_db()
        self.assertIsNone(n.wa_deferred)
        self.assertEqual([c["status"] for c in n.channels if c["channel"] == "whatsapp"], ["sent"])

    @mock.patch("notifications.service.whatsapp.send_template", return_value=SENT)
    def test_skip_mode_drops_it(self, send):
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=False):
            n = service.notify(self.rahul, "x", "Hi", wa_template=("t", []), outside_hours="skip")
        self.assertIsNone(n.wa_deferred)
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=True):
            self.assertEqual(service.send_deferred_whatsapp(), 0)
        send.assert_not_called()

    @mock.patch("notifications.service.whatsapp.send_template", return_value=SENT)
    def test_held_too_long_is_dropped(self, send):
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=False):
            n = service.notify(self.rahul, "x", "Hi", wa_template=("t", []))
        Notification.objects.filter(pk=n.pk).update(created_at=timezone.now() - timedelta(days=5))
        with mock.patch("notifications.service.in_whatsapp_hours", return_value=True):
            service.send_deferred_whatsapp()
        send.assert_not_called()
        n.refresh_from_db()
        self.assertIsNone(n.wa_deferred)


class AcceptReminderTests(Base):
    """Finished work waiting for the giver: one grouped reminder after APPROVAL_REMIND_HOURS (24 by default),
    then daily while it waits."""

    def setUp(self):
        super().setUp()
        for i in range(2):
            t = Task.objects.create(title=f"job {i}", assigned_to=self.rahul, created_by=self.manager,
                                    status=TaskStatus.DONE, completed_at=timezone.now())
            TaskCompletion.objects.create(task=t, submitted_by=self.rahul, approver=self.manager)

    def age(self, hours):
        TaskCompletion.objects.update(created_at=timezone.now() - timedelta(hours=hours))

    def reminders(self):
        return Notification.objects.filter(user=self.manager, type="task_completion_reminder")

    def run_it(self):
        from .reminders import remind_task_approvals
        return remind_task_approvals()

    def test_fresh_work_is_not_chased(self):
        self.age(1)
        self.run_it()
        self.assertFalse(self.reminders().exists())

    def test_one_grouped_reminder_then_daily(self):
        self.age(25)
        self.run_it()
        n = self.reminders().get()
        self.assertIn("2 finished tasks", n.title)
        self.assertEqual(n.link, "/tasks?tab=reviews")
        self.run_it()
        self.assertEqual(self.reminders().count(), 1)        # not again within a day
        TaskCompletion.objects.update(reminded_at=timezone.now() - timedelta(hours=25))
        self.run_it()
        self.assertEqual(self.reminders().count(), 2)

    def test_accepted_work_is_not_chased(self):
        self.age(25)
        TaskCompletion.objects.update(status="approved")
        self.run_it()
        self.assertFalse(self.reminders().exists())


class OwnWorkTests(Base):
    def test_admin_cannot_accept_own_work_and_mine_shows_approver(self):
        t = Task.objects.create(title="mine", assigned_to=self.admin, created_by=self.manager,
                                status=TaskStatus.DONE, completed_at=timezone.now())
        c = TaskCompletion.objects.create(task=t, submitted_by=self.admin, approver=self.manager)
        self.as_(self.admin)
        res = self.client.post(f"/api/task-completions/{c.id}/review/",
                               {"decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 403)
        c.refresh_from_db()
        self.assertEqual(c.status, "pending")
        mine = self.client.get("/api/task-completions/?scope=mine").data
        row = (mine.get("results") if isinstance(mine, dict) else mine)[0]
        self.assertEqual(row["approver_detail"]["id"], self.manager.id)


# ---- 3ff22ba ---------------------------------------------------------------
class ReceivedTaskEditsTests(Base):
    """An admin who RECEIVED a task asks the giver for changes, like anyone."""

    def setUp(self):
        super().setUp()
        self.giver = make("yash", Role.ADMIN, "management")
        self.task = Task.objects.create(title="sim", assigned_to=self.admin, created_by=self.giver,
                                        due_at=timezone.now() + timedelta(hours=3))
        self.new_due = (timezone.now() + timedelta(days=2)).isoformat()

    def test_direct_date_change_is_refused_but_status_is_fine(self):
        self.as_(self.admin)
        res = self.client.patch(f"/api/tasks/{self.task.id}/", {"due_at": self.new_due}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertIn("yash", res.data["detail"])
        self.assertTrue(self.client.get(f"/api/tasks/{self.task.id}/").data["edits_need_giver"])
        res = self.client.patch(f"/api/tasks/{self.task.id}/", {"status": "in_progress"}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_request_goes_to_giver_who_approves(self):
        self.as_(self.admin)
        res = self.client.post(f"/api/tasks/{self.task.id}/request_change/",
                               {"changes": {"due_at": self.new_due}, "reason": "Vendor closed today"},
                               format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(Notification.objects.filter(user=self.giver, type="task_change_request").exists())
        self.as_(self.giver)
        res = self.client.post(f"/api/task-change-requests/{res.data['id']}/review/",
                               {"decision": "approved"}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.task.refresh_from_db()
        self.assertEqual(self.task.due_at.date(), (timezone.now() + timedelta(days=2)).date())

    def test_admin_still_edits_tasks_they_gave_directly(self):
        own = Task.objects.create(title="mine", assigned_to=self.rahul, created_by=self.admin)
        self.as_(self.admin)
        self.assertFalse(self.client.get(f"/api/tasks/{own.id}/").data["edits_need_giver"])
        res = self.client.patch(f"/api/tasks/{own.id}/", {"due_at": self.new_due}, format="json")
        self.assertEqual(res.status_code, 200)


# ---- d0a1bdf ---------------------------------------------------------------
class VoiceTranscriptTests(Base):
    """Speech turned into words on the phone/browser: no AI key needed."""
    URL = "/api/tasks/voice_draft/"

    def say(self, words):
        self.as_(self.manager)
        return self.client.post(self.URL, {"transcript": words}, format="json")

    def test_name_day_time_and_effort_are_read(self):
        res = self.say("Rahul ko kal 5 baje tak quotation bhejna hai 30 minute ka kaam")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["assigned_to"], self.rahul.id)
        due = timezone.localtime(datetime.fromisoformat(res.data["due_at"]))
        self.assertEqual(due.date(), timezone.localdate() + timedelta(days=1))
        self.assertEqual(due.hour, 17)
        self.assertEqual(res.data["effort_minutes"], 30)
        self.assertTrue(res.data["title"])
        self.assertEqual(res.data["transcript"],
                         "Rahul ko kal 5 baje tak quotation bhejna hai 30 minute ka kaam")

    def test_english_and_relative_deadline(self):
        res = self.say("ask amit to check the stock in 2 hours")
        self.assertEqual(res.data["assigned_to"], self.amit.id)
        due = datetime.fromisoformat(res.data["due_at"])
        self.assertAlmostEqual((due - timezone.now()).total_seconds() / 3600, 2, delta=0.1)
        self.assertIsNone(res.data["effort_minutes"])

    def test_nothing_said_about_who_or_when_fills_nothing(self):
        res = self.say("stock check karna hai")
        self.assertIsNone(res.data["assigned_to"])
        self.assertIsNone(res.data["due_at"])

    def test_empty_is_refused(self):
        self.assertEqual(self.say("  ").status_code, 400)


# ---- 748b527 ---------------------------------------------------------------
class RemoveFileTests(Base):
    def setUp(self):
        super().setUp()
        from django.core.files.uploadedfile import SimpleUploadedFile

        from .models import TaskAttachment
        self.task = Task.objects.create(title="pay", assigned_to=self.rahul, created_by=self.manager)
        self.old = TaskAttachment.objects.create(
            task=self.task, filename="old.pdf", uploaded_by=self.manager,
            file=SimpleUploadedFile("old.pdf", b"%PDF old"))
        self.new = TaskAttachment.objects.create(
            task=self.task, filename="new.pdf", uploaded_by=self.manager,
            file=SimpleUploadedFile("new.pdf", b"%PDF new"))

    def remove(self, user, att):
        self.as_(user)
        return self.client.post(f"/api/tasks/{self.task.id}/remove_file/", {"id": att.id}, format="json")

    def test_uploader_removes_and_it_is_logged(self):
        res = self.remove(self.manager, self.old)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual([f["filename"] for f in res.data], ["new.pdf"])
        self.assertTrue(self.task.activities.filter(text="Removed file: old.pdf").exists())

    def test_someone_else_cannot(self):
        self.assertIn(self.remove(self.amit, self.old).status_code, (403, 404))   # cannot even see it
        self.assertEqual(self.remove(self.rahul, self.old).status_code, 403)   # not theirs
        self.assertEqual(self.task.attachments.count(), 2)

    def test_after_done_only_giver_or_admin(self):
        from .models import TaskAttachment
        mine = TaskAttachment.objects.create(task=self.task, filename="proof.pdf",
                                             uploaded_by=self.rahul, file="x/proof.pdf")
        Task.objects.filter(pk=self.task.pk).update(status=TaskStatus.DONE)
        self.assertEqual(self.remove(self.rahul, mine).status_code, 403)
        self.assertEqual(self.remove(self.admin, mine).status_code, 200)


# ---- 2bc1425 ---------------------------------------------------------------
class ChangeRequestLeadersTests(Base):
    URL = "/api/tasks/change_request_leaders/"

    def setUp(self):
        super().setUp()
        self.now = timezone.now()
        self.t = Task.objects.create(
            title="Quote", assigned_to=self.rahul, created_by=self.manager,
            effort_minutes=60, due_at=self.now + timedelta(days=2))

    def ask(self, who, changes, status=ChangeRequestStatus.PENDING, days_ago=0):
        cr = TaskChangeRequest.objects.create(
            task=self.t, requested_by=who, changes=changes, reason="because", status=status)
        if days_ago:
            TaskChangeRequest.objects.filter(pk=cr.pk).update(created_at=self.now - timedelta(days=days_ago))
        return cr

    def get(self, **params):
        q = "&".join(f"{k}={v}" for k, v in params.items())
        return self.client.get(f"{self.URL}?{q}" if q else self.URL)

    def test_team_performance_only(self):
        self.as_(self.rahul)
        self.assertEqual(self.get().status_code, 403)
        self.as_(self.manager)
        self.assertEqual(self.get().status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.get().status_code, 200)

    def test_ranked_most_first_with_outcome_split(self):
        due = (self.now + timedelta(days=9)).isoformat()
        self.ask(self.rahul, {"due_at": due}, ChangeRequestStatus.APPROVED)
        self.ask(self.rahul, {"due_at": due}, ChangeRequestStatus.APPROVED)
        self.ask(self.rahul, {"due_at": due}, ChangeRequestStatus.REJECTED)
        self.ask(self.rahul, {"due_at": due, "priority": "high"})  # still a date move
        self.ask(self.amit, {"due_at": due})
        self.as_(self.admin)
        data = self.get(range="all").data
        self.assertEqual((data["total"], data["people"], data["pending"]), (5, 2, 2))
        top, second = data["rows"]
        self.assertEqual((top["user"], second["user"]), (self.rahul.pk, self.amit.pk))
        self.assertEqual((top["total"], top["approved"], top["rejected"], top["pending"]), (4, 2, 1, 1))
        self.assertEqual(top["approval_rate"], 66.7)
        self.assertEqual(top["tasks"], 1)
        self.assertEqual(len(top["requests"]), 4)
        self.assertEqual(top["requests"][0]["task_code"], self.t.code)
        self.assertIsNone(second["approval_rate"])        # nothing decided yet

    def test_requests_that_do_not_move_the_date_are_not_counted(self):
        self.ask(self.rahul, {"cancel": True})
        self.ask(self.rahul, {"title": "New title"})
        self.ask(self.amit, {"priority": "high"})
        self.as_(self.admin)
        data = self.get(range="all").data
        self.assertEqual((data["total"], data["rows"]), (0, []))

    def test_counted_by_the_day_the_request_was_raised(self):
        self.ask(self.rahul, {"due_at": self.now.isoformat()})
        self.ask(self.amit, {"due_at": "2026-01-01T10:00:00Z"}, days_ago=400)   # long before
        self.as_(self.admin)
        self.assertEqual([r["user"] for r in self.get(range="this_year").data["rows"]], [self.rahul.pk])
        self.assertEqual(len(self.get(range="all").data["rows"]), 2)

    def test_custom_range(self):
        self.ask(self.rahul, {"due_at": "2026-01-01T10:00:00Z"}, days_ago=10)
        self.as_(self.admin)
        d = (self.now - timedelta(days=10)).date().isoformat()
        self.assertEqual(len(self.get(range="custom", start=d, end=d).data["rows"]), 1)
        self.assertEqual(self.get(range="custom", start="bad", end=d).status_code, 400)
