"""Delete a person completely (Admin -> People & access -> "Delete user completely").

DELETE /api/internal/people/<person_id> -- called by the Kaampilot Platform with its service token, inside the
token's company (the tenancy middleware picks the schema for every /api/internal/* call). The founder decided
"delete everything": the person's user and every record that belongs to them go, even when reports for past
months change. It cannot be undone. Everything happens in ONE transaction; files on disk that belonged to deleted
rows are removed only after the transaction has committed.

Optional JSON body (the founder's choices; no body = delete everything, as described further down):
  {"tasks":   {"mode": "delete"} | {"mode": "hand_over", "to": "<platform person id>"},
   "leads":   {"mode": "delete"} | {"mode": "hand_over", "to": "<platform person id>"},
   "history": {"mode": "delete"} | {"mode": "keep"}}        ("assets" belongs to the Assets app and is ignored here)
  tasks hand_over: their OPEN tasks (not done) are assigned to `to` (activity "Handed over from <name> (deleted)");
                   every task they created that stays (assigned to someone else, or handed over) gets `to` as creator.
  tasks delete:    their open tasks (assigned to them or created by them) are deleted.
  leads hand_over: leads assigned to / created by them get `to` as assignee / creator (a lead event records it), so
                   the tasks linked to those leads are not deleted. leads delete: the leads go with their linked tasks.
  history delete:  everything not handed over goes, exactly as described below.
  history keep:    finished tasks, attendance, leave, payroll, comments, activity, notices, mistakes etc. stay.
                   The user row stays, anonymised and unusable: name "Deleted user", username
                   deleted-<random>, email/WhatsApp blank, unusable password, inactive, platform_person_id NULL (that
                   person id can never sign in or be matched again). Personal data still goes (PERSONAL below): face
                   profile, punch photos and leave documents (files and fields), notifications, WhatsApp deliveries,
                   login tokens, access roles, group memberships, task subscriptions, link favourites, notice reads;
                   their reports' manager pointer and the auto-assignment lists are cleared.
  `to` must be an active user here linked to that platform person, and not the person being deleted; otherwise 400
  before anything changes.

Responses: 200 {"deleted": true, "anonymised": bool, "counts": {"app.Model": n, ...},
                "handed_over": {"tasks": n, "leads": n, "assets": 0}}
         | 200 {"deleted": false} (no such person here; the Platform may retry)
         | 400 {"detail": "..."} malformed id, body or hand-over target | 401 without the service token.

How each relation to the user is handled (RELATIONS below; a test fails when a new relation is not listed):

DELETE -- the row belongs to the person (and its own dependents go with it, by the models' CASCADE rules):
  crm.Task assigned_to / created_by        tasks assigned to them AND tasks they created for others (the founder's
                                           call); with them: sub-tasks (parent), completions, change requests,
                                           attachments (+files), activities/comments, checklist, day logs,
                                           subscribers; DutyRun/Mistake pointers to the task -> NULL
  crm.Lead assigned_to / created_by        leads + events, documents (+files), quotations, and the tasks about those
                                           leads (Task.lead is CASCADE); inbound messages/mistakes -> NULL lead
  crm.LeadEvent.actor, crm.TaskActivity.actor, crm.TaskDayLog.author,
  mistakes.MistakeEvent.actor              entries they wrote, also on other people's records
  crm.TaskCompletion.submitted_by, crm.TaskChangeRequest.requested_by, crm.DutyRun.user, crm.TaskTemplate.created_by
  notifications.Notification.user, notifications.WhatsAppDelivery.user (messages to them)
  workspace.Notice.author (+attachment file, reads), workspace.Link.added_by
  workspace.LinkCollection.created_by      only when no one else has links in it (else -> NULL, see below)
  mistakes.Mistake.employee / reported_by  mistakes logged against them and by them (+events)
  mistakes.SOP.created_by                  SOPs they wrote (mistakes citing them -> NULL sop)
  hr.Attendance.user (+punch photos), hr.AttendanceCorrection.user, hr.CompOff.user, hr.LeaveRequest.user
  (+document), hr.FaceProfile.user, hr.AttendanceReminderLog.user, payroll.SalaryStructure.user, payroll.Advance.user, payroll.Payslip.user
  accounts.UserAccessRole.user, admin.LogEntry.user, token_blacklist.OutstandingToken.user, and the m2m rows
  (group memberships, task subscriptions, link favourites, notice reads, auth groups/permissions)
  tenancy.OutboxEvent                      events about a deleted task (payload.taskId)

NULL -- the row belongs to someone else or to the company; only the pointer to the person is cleared:
  accounts.User.reporting_manager (their reports), crm.TaskCompletion.approver/reviewed_by,
  crm.TaskChangeRequest.reviewed_by, crm.TaskAttachment.uploaded_by, crm.TaskChecklistItem.created_by/done_by,
  crm.LeadDocument.uploaded_by, crm.Quotation.created_by (on other people's tasks/leads),
  crm.TaskCategory.requested_by/created_by, crm.TaskSettings.updated_by, mistakes.MistakeSettings.updated_by,
  mistakes.MistakeCategory.created_by, mistakes.SOP.owner (an SOP someone else wrote), mistakes.Mistake.manager,
  workspace.Group.owner (a shared group stays with its members), workspace.LinkCollection.created_by (still holds
  other people's links), hr.AttendanceCorrection.reviewed_by/added_by, hr.LeaveRequest.reviewed_by, hr.LeaveRequest.beyond_balance_by, hr.CompOff.created_by,
  hr.FaceProfile.enrolled_by, payroll.SalaryStructure/Advance/PayrollRun.created_by
  crm.AssignmentRule.member_ids (JSON list of user ids): the id is taken out of the list.

No relation to the user is PROTECT (hr.LeaveRequest.leave_type is PROTECT, but it points at a leave type).
"""
import uuid

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import models, router, transaction
from django.db.models.deletion import Collector

DELETE, NULL = "delete", "null"

RELATIONS = {
    # accounts / Django
    "accounts.User.reporting_manager": NULL,
    "accounts.User_groups.user": DELETE,
    "accounts.User_user_permissions.user": DELETE,
    "accounts.UserAccessRole.user": DELETE,
    "admin.LogEntry.user": DELETE,
    "token_blacklist.OutstandingToken.user": DELETE,
    # crm
    "crm.Lead.assigned_to": DELETE,
    "crm.Lead.created_by": DELETE,
    "crm.LeadEvent.actor": DELETE,
    "crm.TaskCategory.requested_by": NULL,
    "crm.TaskCategory.created_by": NULL,
    "crm.Task_subscribers.user": DELETE,
    "crm.Task.assigned_to": DELETE,
    "crm.Task.created_by": DELETE,
    "crm.TaskCompletion.submitted_by": DELETE,
    "crm.TaskCompletion.approver": NULL,
    "crm.TaskCompletion.reviewed_by": NULL,
    "crm.TaskChangeRequest.requested_by": DELETE,
    "crm.TaskChangeRequest.reviewed_by": NULL,
    "crm.TaskAttachment.uploaded_by": NULL,
    "crm.TaskSettings.updated_by": NULL,
    "crm.TaskActivity.actor": DELETE,
    "crm.TaskChecklistItem.created_by": NULL,
    "crm.TaskChecklistItem.done_by": NULL,
    "crm.TaskDayLog.author": DELETE,
    "crm.TaskTemplate.created_by": DELETE,
    "crm.LeadDocument.uploaded_by": NULL,
    "crm.Quotation.created_by": NULL,
    "crm.DutyRun.user": DELETE,
    # notifications
    "notifications.Notification.user": DELETE,
    "notifications.WhatsAppDelivery.user": DELETE,
    # workspace
    "workspace.Group_members.user": DELETE,
    "workspace.Group.owner": NULL,
    "workspace.Notice.author": DELETE,
    "workspace.NoticeRead.user": DELETE,
    "workspace.LinkCollection.created_by": NULL,  # deleted instead when only their own links are in it
    "workspace.Link_favorites.user": DELETE,
    "workspace.Link.added_by": DELETE,
    # hr
    "hr.Attendance.user": DELETE,
    "hr.AttendanceCorrection.user": DELETE,
    "hr.AttendanceCorrection.reviewed_by": NULL,
    "hr.AttendanceCorrection.added_by": NULL,
    "hr.CompOff.user": DELETE,
    "hr.CompOff.created_by": NULL,
    "hr.LeaveRequest.user": DELETE,
    "hr.LeaveRequest.reviewed_by": NULL,
    "hr.LeaveRequest.beyond_balance_by": NULL,
    "hr.FaceProfile.user": DELETE,
    "hr.FaceProfile.enrolled_by": NULL,
    "hr.AttendanceReminderLog.user": DELETE,
    # payroll
    "payroll.SalaryStructure.user": DELETE,
    "payroll.SalaryStructure.created_by": NULL,
    "payroll.Advance.user": DELETE,
    "payroll.Advance.created_by": NULL,
    "payroll.PayrollRun.created_by": NULL,
    "payroll.Payslip.user": DELETE,
    # mistakes
    "mistakes.MistakeCategory.created_by": NULL,
    "mistakes.MistakeSettings.updated_by": NULL,
    "mistakes.SOP.owner": NULL,
    "mistakes.SOP.created_by": DELETE,
    "mistakes.Mistake.employee": DELETE,
    "mistakes.Mistake.manager": NULL,
    "mistakes.Mistake.reported_by": DELETE,
    "mistakes.MistakeEvent.actor": DELETE,
    # visitors (PLAN.md §22): the gate register is the company's security record; it stays, without the person
    "visitors.Visit.host": NULL,
    "visitors.Visit.host_decision_by": NULL,
    "visitors.Visit.check_in_by": NULL,
    "visitors.Visit.check_out_by": NULL,
    "visitors.VehicleEntry.in_by": NULL,
    "visitors.VehicleEntry.out_by": NULL,
    "visitors.GateLog.actor": NULL,
}


def user_relations():
    """(label, model, field) for every FK / one-to-one pointing at the user model, m2m through tables included."""
    User = get_user_model()
    out = []
    for model in apps.get_models(include_auto_created=True):
        for field in model._meta.concrete_fields:
            if isinstance(field, (models.ForeignKey, models.OneToOneField)) and field.related_model is User:
                out.append((f"{model._meta.label}.{field.name}", model, field))
    return out


def _decision(label, field):
    # Unlisted (a model added later): clear the pointer when the column allows it, else the row goes.
    return RELATIONS.get(label) or (NULL if field.null else DELETE)


def _files(model, rows):
    """Names of the files stored by these rows (any FileField)."""
    fields = [f for f in model._meta.concrete_fields if isinstance(f, models.FileField)]
    names = []
    if fields:
        for row in rows:
            for f in fields:
                file = getattr(row, f.attname)
                if file:
                    names.append((f.storage, str(file)))
    return names


class HandOverError(ValueError):
    """The body cannot be applied (bad hand-over target); nothing has been changed."""


TASK_DONE = "done"


def parse_options(data) -> dict:
    """The founder's choices from the request body; raises HandOverError for a malformed body."""
    if data is None or data == "" or (hasattr(data, "keys") and not list(data.keys())):
        data = {}
    if not isinstance(data, dict):
        raise HandOverError("The body must be a JSON object")
    out = {}
    for key, modes in (("tasks", ("delete", "hand_over")), ("leads", ("delete", "hand_over")), ("history", ("delete", "keep"))):
        raw = data.get(key)
        if raw is None:
            out[key] = {"mode": "delete"}
            continue
        if not isinstance(raw, dict) or raw.get("mode") not in modes:
            raise HandOverError(f"{key}.mode must be one of: {', '.join(modes)}")
        choice = {"mode": raw["mode"]}
        if raw["mode"] == "hand_over":
            try:
                choice["to"] = uuid.UUID(str(raw.get("to")))
            except ValueError:
                raise HandOverError(f"{key}.to must be a platform person id (UUID)") from None
        out[key] = choice
    return out


def _receiver(User, user, person_id: uuid.UUID, what: str):
    if person_id == user.platform_person_id:
        raise HandOverError(f"{what} cannot be handed over to the person being deleted")
    to = User.objects.filter(platform_person_id=person_id).first()
    if to is None:
        raise HandOverError(f"{what}: the person to hand over to has no Tasks access")
    if not to.is_active:
        raise HandOverError(f"{what}: the person to hand over to ({to.get_full_name() or to.username}) is not active")
    return to


def _name(user) -> str:
    return (user.get_full_name() or user.username)[:120]


def delete_person(person_id: uuid.UUID, options: dict | None = None) -> dict:
    opts = options or parse_options({})
    User = get_user_model()
    using = router.db_for_write(User)
    Task = apps.get_model("crm", "Task")
    Lead = apps.get_model("crm", "Lead")
    with transaction.atomic(using=using):
        user = User.objects.select_for_update().filter(platform_person_id=person_id).first()
        if user is None:
            return {"deleted": False}
        # Check every hand-over target before anything changes.
        receivers = {k: _receiver(User, user, opts[k]["to"], k.capitalize())
                     for k in ("tasks", "leads") if opts[k]["mode"] == "hand_over"}

        handed = {"tasks": 0, "leads": 0, "assets": 0}
        name = _name(user)
        if "tasks" in receivers:
            handed["tasks"] = _hand_over_tasks(Task, user, receivers["tasks"], name)
        if "leads" in receivers:
            handed["leads"] = _hand_over_leads(Lead, user, receivers["leads"], name)

        counts: dict[str, int] = {}
        files: list = []
        if opts["history"]["mode"] == "keep":
            _anonymise(user, opts, using, counts, files)
            anonymised = True
        else:
            _delete_everything(user, using, counts, files)
            anonymised = False

        def remove_files():
            for storage, fname in files:
                try:
                    storage.delete(fname)
                except Exception:  # noqa: BLE001 -- a missing file must not fail the request
                    pass

        transaction.on_commit(remove_files, using=using)
    return {"deleted": True, "anonymised": anonymised, "counts": counts, "handed_over": handed}


def delete_unlinked() -> dict:
    """Every user here who is not linked to a Platform person (old standalone users, "Deleted user" rows kept by an
    earlier deletion), with every record of theirs, as delete_person does. For resetting a test company to just its
    owner (`company -- reset`, PLAN.md §19.28); one transaction per user."""
    User = get_user_model()
    using = router.db_for_write(User)
    deleted, counts = 0, {}
    for pk in list(User.objects.filter(platform_person_id__isnull=True).values_list("pk", flat=True)):
        files: list = []
        with transaction.atomic(using=using):
            user = User.objects.select_for_update().filter(pk=pk, platform_person_id__isnull=True).first()
            if user is None:
                continue
            _delete_everything(user, using, counts, files)
            deleted += 1

            def remove_files(files=files):
                for storage, fname in files:
                    try:
                        storage.delete(fname)
                    except Exception:  # noqa: BLE001 -- a missing file must not fail the reset
                        pass

            transaction.on_commit(remove_files, using=using)
    return {"deleted": deleted, "counts": counts}


def _hand_over_tasks(Task, user, to, name) -> int:
    TaskActivity = apps.get_model("crm", "TaskActivity")
    open_tasks = list(Task.objects.filter(assigned_to=user).exclude(status=TASK_DONE))
    for task in open_tasks:
        task.assigned_to = to
        if task.created_by_id == user.pk:
            task.created_by = to
        task.save(update_fields=["assigned_to", "created_by"])
    TaskActivity.objects.bulk_create([TaskActivity(task=t, actor=None, text=f"Handed over from {name} (deleted)"[:300])
                                      for t in open_tasks])
    # Tasks they created for other people stay, with the receiver as creator.
    Task.objects.filter(created_by=user).exclude(assigned_to=user).update(created_by=to)
    return len(open_tasks)


def _hand_over_leads(Lead, user, to, name) -> int:
    LeadEvent = apps.get_model("crm", "LeadEvent")
    leads = list(Lead.objects.filter(models.Q(assigned_to=user) | models.Q(created_by=user)))
    for lead in leads:
        fields = []
        if lead.assigned_to_id == user.pk:
            lead.assigned_to = to
            fields.append("assigned_to")
        if lead.created_by_id == user.pk:
            lead.created_by = to
            fields.append("created_by")
        lead.save(update_fields=fields)
    LeadEvent.objects.bulk_create([LeadEvent(lead=lead, type="assignment", actor=None,
                                             body=f"Handed over from {name} (deleted)")
                                   for lead in leads])
    return len(leads)


def _finish(collector, using, counts, files):
    """Deletes what the collector found; remembers its files and drops outbox events about deleted tasks."""
    Task = apps.get_model("crm", "Task")
    task_ids = set()
    for model, instances in collector.data.items():
        files += _files(model, instances)
        if model is Task:
            task_ids |= {t.pk for t in instances}
    for qs in collector.fast_deletes:
        files += _files(qs.model, qs)
        if qs.model is Task:
            task_ids |= set(qs.values_list("pk", flat=True))
    _, deleted = collector.delete()
    for k, v in deleted.items():
        if v:
            counts[k] = counts.get(k, 0) + v
    if task_ids:
        OutboxEvent = apps.get_model("tenancy", "OutboxEvent")
        n, _ = OutboxEvent.objects.using(using).filter(payload__taskId__in=list(task_ids)).delete()
        if n:
            counts["tenancy.OutboxEvent"] = counts.get("tenancy.OutboxEvent", 0) + n


def _drop_from_assignment_rules(user, using):
    AssignmentRule = apps.get_model("crm", "AssignmentRule")
    for rule in AssignmentRule.objects.using(using).select_for_update():
        if user.pk in (rule.member_ids or []):
            rule.member_ids = [i for i in rule.member_ids if i != user.pk]
            rule.rr_index = 0
            rule.save(update_fields=["member_ids", "rr_index", "updated_at"])


def _delete_everything(user, using, counts, files):
    """history "delete": the user and every row that belongs to them (RELATIONS)."""
    User = type(user)
    collector = Collector(using=using)
    for label, model, field in user_relations():
        if model is User and field.name == "reporting_manager":
            User.objects.filter(reporting_manager=user).exclude(pk=user.pk).update(reporting_manager=None)
            continue
        rows = model._base_manager.using(using).filter(**{field.name: user})
        if _decision(label, field) == DELETE:
            collector.collect(rows)
        elif label == "workspace.LinkCollection.created_by":
            Link = apps.get_model("workspace", "Link")
            shared = Link.objects.using(using).filter(collection__in=rows).exclude(added_by=user).values("collection_id")
            own = list(rows.exclude(pk__in=shared))
            if own:
                collector.collect(own)
            rows.exclude(pk__in=[c.pk for c in own]).update(**{field.name: None})
        else:
            rows.update(**{field.name: None})
    collector.collect([user])
    _drop_from_assignment_rules(user, using)
    _finish(collector, using, counts, files)


# Rows that are personal data or access, not history: removed even when history is kept.
PERSONAL = (
    "hr.FaceProfile.user", "hr.AttendanceReminderLog.user", "notifications.Notification.user", "notifications.WhatsAppDelivery.user",
    "token_blacklist.OutstandingToken.user", "accounts.UserAccessRole.user", "accounts.User_groups.user",
    "accounts.User_user_permissions.user", "workspace.Group_members.user", "crm.Task_subscribers.user",
    "workspace.Link_favorites.user", "workspace.NoticeRead.user",
)


def _anonymise(user, opts, using, counts, files):
    """history "keep": the history stays, pointing at an anonymous, unusable user row."""
    User = type(user)
    Task = apps.get_model("crm", "Task")
    Lead = apps.get_model("crm", "Lead")
    collector = Collector(using=using)
    relations = {label: (model, field) for label, model, field in user_relations()}
    for label in PERSONAL:
        if label in relations:
            model, field = relations[label]
            collector.collect(model._base_manager.using(using).filter(**{field.name: user}))
    if opts["tasks"]["mode"] == "delete":
        collector.collect(Task.objects.filter(models.Q(assigned_to=user) | models.Q(created_by=user)).exclude(status=TASK_DONE))
    if opts["leads"]["mode"] == "delete":
        collector.collect(Lead.objects.filter(models.Q(assigned_to=user) | models.Q(created_by=user)))

    # Punch photos and leave documents: the files and fields go, the rows stay.
    Attendance = apps.get_model("hr", "Attendance")
    LeaveRequest = apps.get_model("hr", "LeaveRequest")
    photos = Attendance.objects.filter(user=user).filter(~models.Q(check_in_photo="") | ~models.Q(check_out_photo=""))
    files += _files(Attendance, photos)
    n = photos.update(check_in_photo="", check_out_photo="")
    if n:
        counts["hr.Attendance photos"] = n
    docs = LeaveRequest.objects.filter(user=user, document__isnull=False).exclude(document="")
    files += _files(LeaveRequest, docs)
    n = docs.update(document=None)
    if n:
        counts["hr.LeaveRequest documents"] = n

    User.objects.filter(reporting_manager=user).exclude(pk=user.pk).update(reporting_manager=None)
    _drop_from_assignment_rules(user, using)
    _finish(collector, using, counts, files)

    user.refresh_from_db()
    user.first_name, user.last_name = "Deleted", "user"
    user.username = f"deleted-{uuid.uuid4().hex[:10]}"
    user.email = ""
    user.whatsapp_phone = ""
    user.set_unusable_password()
    user.is_active = False
    user.is_staff = False
    user.is_superuser = False
    user.reporting_manager = None
    user.platform_person_id = None
    user.save()
    counts["accounts.User anonymised"] = 1
