"""Delete a person completely (Admin -> People & access -> "Delete user completely").

DELETE /api/internal/people/<person_id> -- called by the FreeFounders Platform with its service token, inside the
token's company (the tenancy middleware picks the schema for every /api/internal/* call). The founder decided
"delete everything": the person's user and every record that belongs to them go, even when reports for past
months change. It cannot be undone. Everything happens in ONE transaction; files on disk that belonged to deleted
rows are removed only after the transaction has committed.

Responses: 200 {"deleted": true, "counts": {"app.Model": n, ...}} | 200 {"deleted": false} (no such person here;
the Platform may retry) | 400 malformed id | 401 without the service token.

How each relation to the user is handled (RELATIONS below; a test fails when a new relation is not listed):

DELETE -- the row belongs to the person (and its own dependents go with it, by the models' CASCADE rules):
  crm.Task assigned_to / created_by        tasks assigned to them AND tasks they created for others (the founder's
                                           call); with them: sub-tasks (parent), completions, change requests,
                                           attachments (+files), activities/comments, checklist, day logs,
                                           subscribers; DutyRun/FormSubmission/Mistake pointers to the task -> NULL
  crm.Lead assigned_to / created_by        leads + events, documents (+files), quotations, and the tasks about those
                                           leads (Task.lead is CASCADE); inbound messages/forms/mistakes -> NULL lead
  crm.LeadEvent.actor, crm.TaskActivity.actor, crm.TaskDayLog.author, mistakes.MistakeEvent.actor,
  workspace.IdeaComment.author             entries they wrote, also on other people's records
  crm.TaskCompletion.submitted_by, crm.TaskChangeRequest.requested_by, crm.DutyRun.user, crm.TaskTemplate.created_by
  notifications.Notification.user, notifications.WhatsAppDelivery.user (messages to them)
  workspace.Notice.author (+attachment file, reads), workspace.Idea.author (+votes, comments), workspace.Link.added_by
  workspace.LinkCollection.created_by      only when no one else has links in it (else -> NULL, see below)
  webforms.Form.created_by (+fields, submissions, files), webforms.FormSubmission.submitted_by (+files)
  mistakes.Mistake.employee / reported_by  mistakes logged against them and by them (+events)
  mistakes.SOP.created_by                  SOPs they wrote (mistakes citing them -> NULL sop)
  hr.Attendance.user (+punch photos), hr.AttendanceCorrection.user, hr.CompOff.user, hr.LeaveRequest.user
  (+document), hr.FaceProfile.user, payroll.SalaryStructure.user, payroll.Advance.user, payroll.Payslip.user
  accounts.UserAccessRole.user, admin.LogEntry.user, token_blacklist.OutstandingToken.user, and the m2m rows
  (group memberships, task subscriptions, link favourites, idea votes, notice reads, auth groups/permissions)
  tenancy.OutboxEvent                      events about a deleted task (payload.taskId)

NULL -- the row belongs to someone else or to the company; only the pointer to the person is cleared:
  accounts.User.reporting_manager (their reports), crm.TaskCompletion.approver/reviewed_by,
  crm.TaskChangeRequest.reviewed_by, crm.TaskAttachment.uploaded_by, crm.TaskChecklistItem.created_by/done_by,
  crm.LeadDocument.uploaded_by, crm.Quotation.created_by (on other people's tasks/leads),
  crm.TaskCategory.requested_by/created_by, crm.TaskSettings.updated_by, mistakes.MistakeSettings.updated_by,
  mistakes.MistakeCategory.created_by, mistakes.SOP.owner (an SOP someone else wrote), mistakes.Mistake.manager,
  workspace.Group.owner (a shared group stays with its members), workspace.LinkCollection.created_by (still holds
  other people's links), hr.AttendanceCorrection.reviewed_by, hr.LeaveRequest.reviewed_by, hr.CompOff.created_by,
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
    "workspace.Idea_votes.user": DELETE,
    "workspace.Idea.author": DELETE,
    "workspace.IdeaComment.author": DELETE,
    # webforms
    "webforms.Form.created_by": DELETE,
    "webforms.FormSubmission.submitted_by": DELETE,
    # hr
    "hr.Attendance.user": DELETE,
    "hr.AttendanceCorrection.user": DELETE,
    "hr.AttendanceCorrection.reviewed_by": NULL,
    "hr.CompOff.user": DELETE,
    "hr.CompOff.created_by": NULL,
    "hr.LeaveRequest.user": DELETE,
    "hr.LeaveRequest.reviewed_by": NULL,
    "hr.FaceProfile.user": DELETE,
    "hr.FaceProfile.enrolled_by": NULL,
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


def delete_person(person_id: uuid.UUID) -> dict:
    User = get_user_model()
    using = router.db_for_write(User)
    with transaction.atomic(using=using):
        user = User.objects.select_for_update().filter(platform_person_id=person_id).first()
        if user is None:
            return {"deleted": False}

        counts: dict[str, int] = {}
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

        # Ids taken out of the round-robin lists.
        AssignmentRule = apps.get_model("crm", "AssignmentRule")
        for rule in AssignmentRule.objects.using(using).select_for_update():
            if user.pk in (rule.member_ids or []):
                rule.member_ids = [i for i in rule.member_ids if i != user.pk]
                rule.rr_index = 0
                rule.save(update_fields=["member_ids", "rr_index", "updated_at"])

        # Everything the collector will delete: remember files and deleted task ids first.
        files, task_ids = [], set()
        Task = apps.get_model("crm", "Task")
        for model, instances in collector.data.items():
            files += _files(model, instances)
            if model is Task:
                task_ids |= {t.pk for t in instances}
        for qs in collector.fast_deletes:
            files += _files(qs.model, qs)
            if qs.model is Task:
                task_ids |= set(qs.values_list("pk", flat=True))

        _, deleted = collector.delete()
        counts.update({k: v for k, v in deleted.items() if v})

        if task_ids:
            OutboxEvent = apps.get_model("tenancy", "OutboxEvent")
            n, _ = OutboxEvent.objects.using(using).filter(payload__taskId__in=list(task_ids)).delete()
            if n:
                counts["tenancy.OutboxEvent"] = n

        def remove_files():
            for storage, name in files:
                try:
                    storage.delete(name)
                except Exception:  # noqa: BLE001 -- a missing file must not fail the request
                    pass

        transaction.on_commit(remove_files, using=using)
    return {"deleted": True, "counts": counts}
