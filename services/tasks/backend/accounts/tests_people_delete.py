"""Delete a person completely (DELETE /api/internal/people/<person_id>, accounts/people_delete.py)."""
import os
import shutil
import tempfile
import uuid
from datetime import date

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from accounts.people_delete import RELATIONS, user_relations
from accounts.tests_platform import JWKS, token
from crm.models import AssignmentRule, Lead, LeadEvent, Task, TaskActivity, TaskCompletion
from hr.models import Attendance, FaceProfile, LeaveRequest, LeaveType
from notifications.models import Notification
from tenancy.models import OutboxEvent
from workspace.models import Group

MEDIA = tempfile.mkdtemp(prefix="ff-delete-")


@override_settings(PLATFORM_JWKS=JWKS, MEDIA_ROOT=MEDIA)
class DeletePersonTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.pid = uuid.uuid4()
        self.boss = User.objects.create_user("boss", "b@x.com", "pass@12345", role=Role.SALES_MANAGER,
                                             platform_person_id=uuid.uuid4())
        self.mia = User.objects.create_user("mia", "m@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                            platform_person_id=self.pid, reporting_manager=self.boss)
        self.other = User.objects.create_user("ravi", "r@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                              platform_person_id=uuid.uuid4(), reporting_manager=self.mia)

    def url(self, pid=None):
        return f"/api/internal/people/{pid or self.pid}"

    def test_every_relation_to_the_user_has_a_decision(self):
        missing = [label for label, _, _ in user_relations() if label not in RELATIONS]
        self.assertEqual(missing, [], "add these to accounts/people_delete.py RELATIONS")

    def test_deletes_the_person_and_everything_of_theirs(self):
        mia, other, boss = self.mia, self.other, self.boss
        assigned = Task.objects.create(title="Mia's own", assigned_to=mia, created_by=boss)
        created = Task.objects.create(title="Mia gave Ravi", assigned_to=other, created_by=mia)
        ravis = Task.objects.create(title="Ravi's own", assigned_to=other, created_by=other)
        TaskActivity.objects.create(task=ravis, actor=mia, text="Looks good", kind="comment")
        TaskActivity.objects.create(task=ravis, actor=other, text="Thanks", kind="comment")
        review = TaskCompletion.objects.create(task=ravis, submitted_by=other, approver=mia, reviewed_by=mia)
        OutboxEvent.objects.create(type="task.completed", payload={"taskId": created.pk, "externalRef": "x"})
        OutboxEvent.objects.create(type="task.completed", payload={"taskId": ravis.pk, "externalRef": "y"})

        attendance = Attendance.objects.create(user=mia, date=date(2026, 9, 1))
        attendance.check_in_photo.save("in.jpg", ContentFile(b"jpg"), save=True)
        photo = attendance.check_in_photo.path
        self.assertTrue(os.path.exists(photo))
        leave_type = LeaveType.objects.create(name="Casual")
        LeaveRequest.objects.create(user=mia, leave_type=leave_type, start_date=date(2026, 9, 2),
                                    end_date=date(2026, 9, 2), reason="x")
        ravi_leave = LeaveRequest.objects.create(user=other, leave_type=leave_type, start_date=date(2026, 9, 3),
                                                 end_date=date(2026, 9, 3), reason="y", reviewed_by=mia)
        lead = Lead.objects.create(customer_name="Acme", assigned_to=mia, created_by=boss)
        LeadEvent.objects.create(lead=lead, actor=mia, type="note", body="called")
        Notification.objects.create(user=mia, type="x", title="hello")
        group = Group.objects.create(name="Sales floor", owner=mia)
        group.members.add(mia, other)
        rule = AssignmentRule.objects.create(department="sales", member_ids=[other.pk, mia.pk])

        with self.captureOnCommitCallbacks(execute=True):
            res = self.api.delete(self.url())
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertTrue(body["deleted"])
        self.assertEqual(body["counts"]["accounts.User"], 1)
        self.assertEqual(body["counts"]["crm.Task"], 2)
        self.assertEqual(body["counts"]["tenancy.OutboxEvent"], 1)

        self.assertFalse(User.objects.filter(platform_person_id=self.pid).exists())
        self.assertEqual(set(Task.objects.values_list("title", flat=True)), {"Ravi's own"})
        self.assertEqual(list(TaskActivity.objects.filter(task=ravis).values_list("text", flat=True)), ["Thanks"])
        self.assertFalse(Attendance.objects.filter(pk=attendance.pk).exists())
        self.assertFalse(os.path.exists(photo))
        self.assertEqual(list(LeaveRequest.objects.values_list("pk", flat=True)), [ravi_leave.pk])
        self.assertFalse(Lead.objects.exists())
        self.assertFalse(Notification.objects.exists())
        self.assertEqual(OutboxEvent.objects.count(), 1)

        # Other people's records stay, with the pointer to her cleared.
        review.refresh_from_db()
        self.assertIsNone(review.approver)
        self.assertIsNone(review.reviewed_by)
        ravi_leave.refresh_from_db()
        self.assertIsNone(ravi_leave.reviewed_by)
        other.refresh_from_db()
        self.assertIsNone(other.reporting_manager)
        group.refresh_from_db()
        self.assertIsNone(group.owner)
        self.assertEqual(list(group.members.all()), [other])
        rule.refresh_from_db()
        self.assertEqual(rule.member_ids, [other.pk])
        self.assertTrue(User.objects.filter(pk=boss.pk).exists())

    def test_idempotent(self):
        self.assertTrue(self.api.delete(self.url()).json()["deleted"])
        res = self.api.delete(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"deleted": False})
        self.assertEqual(self.api.delete(self.url(uuid.uuid4())).json(), {"deleted": False})

    def test_needs_the_platform_and_a_uuid(self):
        self.assertEqual(APIClient().delete(self.url()).status_code, 401)
        user_token = APIClient()
        user_token.credentials(HTTP_AUTHORIZATION=f"Bearer {token(str(self.pid), {'tasks': str(self.mia.pk)})}")
        self.assertEqual(user_token.delete(self.url()).status_code, 401)
        self.assertEqual(self.api.delete(self.url("not-a-uuid")).status_code, 400)
        self.assertTrue(User.objects.filter(platform_person_id=self.pid).exists())


@override_settings(PLATFORM_JWKS=JWKS, MEDIA_ROOT=MEDIA)
class DeletePersonChoicesTests(TestCase):
    """The founder's choices in the DELETE body: hand over open work, keep history under an anonymised user."""

    def setUp(self):
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
        self.pid = uuid.uuid4()
        self.boss_pid = uuid.uuid4()
        self.boss = User.objects.create_user("boss", "b@x.com", "pass@12345", role=Role.SALES_MANAGER,
                                             platform_person_id=self.boss_pid)
        self.mia = User.objects.create_user("mia", "m@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                            platform_person_id=self.pid, first_name="Mia", last_name="Rao")
        self.ravi = User.objects.create_user("ravi", "r@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                             platform_person_id=uuid.uuid4())

    def delete(self, body=None):
        return self.api.delete(f"/api/internal/people/{self.pid}", body, format="json")

    def test_hand_over_open_tasks_and_leads(self):
        open_task = Task.objects.create(title="Open", assigned_to=self.mia, created_by=self.boss)
        own_open = Task.objects.create(title="Own open", assigned_to=self.mia, created_by=self.mia)
        Task.objects.create(title="Finished", assigned_to=self.mia, created_by=self.boss, status="done")
        for_ravi = Task.objects.create(title="Mia gave Ravi", assigned_to=self.ravi, created_by=self.mia)
        lead = Lead.objects.create(customer_name="Acme", assigned_to=self.mia, created_by=self.mia)
        lead_task = Task.objects.create(title="Call Acme", assigned_to=self.ravi, created_by=self.boss, lead=lead)

        to = {"mode": "hand_over", "to": str(self.boss_pid)}
        res = self.delete({"tasks": to, "leads": to})
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertEqual(body["handed_over"], {"tasks": 2, "leads": 1, "assets": 0})
        self.assertTrue(body["deleted"])
        self.assertFalse(body["anonymised"])
        self.assertFalse(User.objects.filter(pk=self.mia.pk).exists())

        open_task.refresh_from_db()
        self.assertEqual(open_task.assigned_to, self.boss)
        self.assertTrue(open_task.activities.filter(text="Handed over from Mia Rao (deleted)").exists())
        own_open.refresh_from_db()
        self.assertEqual((own_open.assigned_to, own_open.created_by), (self.boss, self.boss))
        self.assertFalse(Task.objects.filter(title="Finished").exists())  # history: delete
        for_ravi.refresh_from_db()
        self.assertEqual((for_ravi.assigned_to, for_ravi.created_by), (self.ravi, self.boss))
        lead.refresh_from_db()
        self.assertEqual((lead.assigned_to, lead.created_by), (self.boss, self.boss))
        self.assertTrue(Task.objects.filter(pk=lead_task.pk).exists(), "tasks linked to the lead survive")
        self.assertTrue(LeadEvent.objects.filter(lead=lead, body="Handed over from Mia Rao (deleted)").exists())

    def test_keep_history_anonymises(self):
        done = Task.objects.create(title="Finished", assigned_to=self.mia, created_by=self.boss, status="done")
        TaskActivity.objects.create(task=done, actor=self.mia, text="All done", kind="comment")
        Task.objects.create(title="Still open", assigned_to=self.mia, created_by=self.boss)
        attendance = Attendance.objects.create(user=self.mia, date=date(2026, 9, 1))
        attendance.check_in_photo.save("in.jpg", ContentFile(b"jpg"), save=True)
        photo = attendance.check_in_photo.path
        FaceProfile.objects.create(user=self.mia, descriptor=[0.1, 0.2])
        Notification.objects.create(user=self.mia, type="x", title="hello")
        leave_type = LeaveType.objects.create(name="Sick")
        leave = LeaveRequest.objects.create(user=self.mia, leave_type=leave_type, start_date=date(2026, 9, 2),
                                            end_date=date(2026, 9, 2), reason="flu")
        leave.document.save("note.pdf", ContentFile(b"pdf"), save=True)
        self.ravi.reporting_manager = self.mia
        self.ravi.save()

        with self.captureOnCommitCallbacks(execute=True):
            res = self.delete({"history": {"mode": "keep"}})
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertTrue(body["deleted"])
        self.assertTrue(body["anonymised"])
        self.assertEqual(body["handed_over"], {"tasks": 0, "leads": 0, "assets": 0})

        mia = User.objects.get(pk=self.mia.pk)
        self.assertEqual((mia.first_name, mia.last_name, mia.email, mia.whatsapp_phone), ("Deleted", "user", "", ""))
        self.assertTrue(mia.username.startswith("deleted-"))
        self.assertIsNone(mia.platform_person_id)
        self.assertFalse(mia.is_active)
        self.assertFalse(mia.has_usable_password())
        # History stays.
        self.assertTrue(Task.objects.filter(pk=done.pk, assigned_to=mia).exists())
        self.assertTrue(TaskActivity.objects.filter(task=done, actor=mia).exists())
        self.assertTrue(Attendance.objects.filter(pk=attendance.pk).exists())
        self.assertTrue(LeaveRequest.objects.filter(pk=leave.pk).exists())
        # Open work (tasks: delete by default) and personal data go.
        self.assertFalse(Task.objects.filter(title="Still open").exists())
        attendance.refresh_from_db()
        self.assertFalse(attendance.check_in_photo)
        self.assertFalse(os.path.exists(photo))
        leave.refresh_from_db()
        self.assertFalse(leave.document)
        self.assertFalse(FaceProfile.objects.filter(user=mia).exists())
        self.assertFalse(Notification.objects.filter(user=mia).exists())
        self.ravi.refresh_from_db()
        self.assertIsNone(self.ravi.reporting_manager)

        # Nobody can sign in as them or match them again.
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token(str(self.pid), {'tasks': str(mia.pk)})}")
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        login = APIClient().post("/api/auth/login", {"username": mia.username, "password": "pass@12345"}, format="json")
        self.assertEqual(login.status_code, 401)
        self.assertEqual(self.delete({"history": {"mode": "keep"}}).json(), {"deleted": False})

    def test_bad_receiver_changes_nothing(self):
        task = Task.objects.create(title="Open", assigned_to=self.mia, created_by=self.mia)
        self.boss.is_active = False
        self.boss.save()
        cases = {
            "unknown person": {"tasks": {"mode": "hand_over", "to": str(uuid.uuid4())}},
            "themselves": {"leads": {"mode": "hand_over", "to": str(self.pid)}},
            "inactive": {"tasks": {"mode": "hand_over", "to": str(self.boss_pid)}},
            "not a uuid": {"tasks": {"mode": "hand_over", "to": "bob"}},
            "bad mode": {"history": {"mode": "shred"}},
        }
        for name, body in cases.items():
            res = self.delete(body)
            self.assertEqual(res.status_code, 400, name)
            self.assertIn("detail", res.json(), name)
        self.assertTrue(User.objects.filter(platform_person_id=self.pid, is_active=True).exists())
        task.refresh_from_db()
        self.assertEqual(task.assigned_to, self.mia)

    def test_empty_body_deletes_everything(self):
        Task.objects.create(title="Finished", assigned_to=self.mia, created_by=self.mia, status="done")
        body = self.delete({}).json()
        self.assertEqual((body["deleted"], body["anonymised"]), (True, False))
        self.assertFalse(Task.objects.exists())
        self.assertFalse(User.objects.filter(pk=self.mia.pk).exists())
