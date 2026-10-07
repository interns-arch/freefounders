from collections import Counter
from datetime import datetime, time as dt_time, timedelta

from django.conf import settings as django_settings
from django.db.models import Count, F, Max as models_Max, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status as http, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError, NotFound
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.models import User, Role, is_top_admin
from accounts.permissions import HasCapability, has_capability
from notifications.service import notify

from config import llm

from .ai_tasks import (draft_from_speech, draft_task, proofread,
                       review_sentence, summarize_task)
from .models import (
    ChangeRequestStatus, EventType, Holiday, LeadEvent, Task, TaskActivity,
    TaskAttachment, TaskCategory, TaskChangeRequest, TaskChecklistItem,
    TaskDayLog,
    CompletionReviewStatus, TaskCompletion, TaskFrequency, TaskSettings,
    TaskStatus, TaskTemplate,
)
from .scoping import (
    assignable_users, assignment_level, can_assign_to, can_delete_task,
    ROLE_LEVEL, can_edit_task, delete_refusal, visible_leads, visible_tasks,
)
from .serializers import (
    HolidaySerializer, TaskActivitySerializer, TaskAttachmentSerializer,
    TaskChangeRequestSerializer, TaskCompletionSerializer, TaskDayLogSerializer,
    TaskSerializer,
    people_for_picker,
    TaskSettingsSerializer, TaskTemplateSerializer, UserBriefSerializer,
)


def act(task, actor, text):
    TaskActivity.objects.create(task=task, actor=actor, text=text[:300])


# ---- Daily progress log (per-day self-report) ---------------------------
# A stale task must not render hundreds of rows in the slide-over.
DAY_LOG_MAX_DAYS = 60
# How far back a forgotten day can still be filled in: today + this many days
# before it. Anything older stays blank on purpose -- a log written a week
# late is a story, not a record.
DAY_LOG_BACKFILL_DAYS = 2


def day_log_epoch():
    """The day the daily log went live, or None on a fresh install. Days
    before it are not shown and never count as missed -- nobody skipped a
    report that could not be written yet. Configured by DAY_LOG_EPOCH."""
    raw = (getattr(django_settings, "DAY_LOG_EPOCH", "") or "").strip()
    return parse_date(raw) if raw else None


def day_log_window(task):
    """The calendar days the timeline covers: the task's start through its
    due date, stretched to reach today (an overdue task is still being worked
    on) and to cover any day that already carries an entry. Local dates only
    -- the server owns the day boundaries so the browser never recomputes
    them in its own timezone."""
    today = timezone.localdate()
    start = timezone.localdate(task.created_at)
    end = timezone.localdate(task.due_at) if task.due_at else start
    epoch = day_log_epoch()
    if epoch:
        start = max(start, epoch)
    logged = list(task.day_logs.values_list("date", flat=True))
    if logged:
        start = min(start, min(logged))   # an entry always keeps its own day
        end = max(end, max(logged))
    # a finished task stops at the day it was finished; a live one runs to
    # today. `start` is deliberately NOT part of this max: a task that was
    # already finished before the epoch ends before it begins, which leaves
    # an empty window and hides the section entirely.
    end = max(end, timezone.localdate(task.completed_at) if task.completed_at else today)
    if (end - start).days + 1 > DAY_LOG_MAX_DAYS:
        start = end - timedelta(days=DAY_LOG_MAX_DAYS - 1)   # keep the recent tail
    return start, end


def day_log_payload(task, user):
    """Everything the Daily progress log section renders: one row per day,
    with that day's entry or nothing at all, plus who may write."""
    start, end = day_log_window(task)
    by_date = {l.date: l for l in task.day_logs.select_related("author")}
    today = timezone.localdate()
    days = []
    for i in range((end - start).days + 1):
        d = start + timedelta(days=i)
        entry = by_date.get(d)
        days.append({
            "date": d.isoformat(),
            "label": d.strftime("%a %d %b"),
            "is_today": d == today,
            "is_future": d > today,
            "is_weekend": d.weekday() >= 5,   # a blank Sunday is not a miss
            "entry": TaskDayLogSerializer(entry).data if entry else None,
        })
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "today": today.isoformat(),
        "can_write": bool(task.assigned_to_id == user.id
                          and task.status != TaskStatus.DONE and not task.deleted_at),
        "backfill_days": DAY_LOG_BACKFILL_DAYS,
        "days": days,
        "logged_days": len(by_date),
        "missed_days": sum(1 for d in days if not d["entry"]
                           and not d["is_future"] and not d["is_weekend"]),
        # Shown BESIDE Task.actual_minutes, never folded into it -- see day_log().
        "logged_minutes": sum(l.minutes_spent or 0 for l in by_date.values()),
    }


def _admins():
    from accounts.permissions import ROLE_CAPABILITIES
    admin_roles = [r for r, caps in ROLE_CAPABILITIES.items() if "tasks.view_all" in caps]
    return User.objects.filter(is_active=True, role__in=admin_roles)


def NL_JOIN(lines):
    """Join notification body lines. Named so the literal newline never has to
    survive a shell round-trip in tooling."""
    return chr(10).join(lines)


def _category_approvers(requester):
    """Who can turn a category request into a real category: the requester's
    own manager if they may assign tasks, otherwise the admins."""
    manager = requester.reporting_manager
    if manager and manager.is_active and has_capability(manager, "tasks.assign"):
        return [manager]
    return list(_admins().exclude(pk=requester.pk))


def _approvers_for(req: TaskChangeRequest):
    """Who decides a Modification Request. The rule is "one step up from
    the person asking", never a broadcast to every admin:

      assignee asks           -> the person who GAVE them the task
      creator asks (own task) -> that person's reporting manager
      nobody on file          -> admins, as a last resort only

    An approver who would rather not decide can still Escalate to admin."""
    task = req.task
    # Asking to delete work that belongs to an admin: only a Super Admin can
    # carry that out, so send it straight there rather than to somebody who
    # would have to refuse it.
    if req.changes.get("cancel") and task.assigned_to \
            and assignment_level(task.assigned_to) >= 3:
        supers = list(User.objects.filter(
            is_active=True, role=Role.SUPER_ADMIN).exclude(pk=req.requested_by_id))
        if supers:
            return supers
    if req.requested_by_id != task.created_by_id and task.created_by \
            and task.created_by.is_active:
        return [task.created_by]
    manager = req.requested_by.reporting_manager
    if manager and manager.is_active and manager.pk != req.requested_by_id:
        return [manager]
    return list(_admins().exclude(pk=req.requested_by_id))


def _completion_reviewer(task, submitter):
    """Who accepts or rejects this completion: the person who gave the task.

    Nobody reviews their own work, so a self-assigned task has no reviewer and
    is simply done. If the giver has left, it falls to their manager and then
    to the admins -- the same ladder change requests use, so there is one
    answer to "who decides" in this app, not two.
    """
    giver = task.created_by
    if giver and giver.is_active and giver.pk != submitter.pk:
        return giver
    if giver and giver.pk == submitter.pk:
        return None                      # your own task: nothing to approve
    mgr = getattr(submitter, "reporting_manager", None)
    if mgr and mgr.is_active and mgr.pk != submitter.pk:
        return mgr
    return _admins().exclude(pk=submitter.pk).first()


def _completion_body(c) -> str:
    """The reviewer decides from this message alone, so it carries the task,
    who did it, how long it took against the estimate, and what they said."""
    t = c.task
    who = (c.submitted_by.get_full_name() or c.submitted_by.username)
    est = f"{t.effort_minutes}m" if t.effort_minutes else "not set"
    took = f"{t.actual_minutes}m" if t.actual_minutes else "not recorded"
    lines = [
        f"{t.code}: {t.title}",
        f"Finished by {who}.",
        f"Time: {took} spent, {est} estimated.",
    ]
    if t.due_at:
        local = timezone.localtime(t.due_at)
        late = t.completed_at and t.completed_at > t.due_at
        lines.append(f"Due was {local:%d %b, %I:%M %p}" + (" - finished late." if late else "."))
    if c.note:
        lines.append("")
        lines.append(f"What they did: {c.note[:400]}")
    lines.append("")
    lines.append("Accept it, or send it back with a reason.")
    return NL_JOIN(lines)


def _change_request_body(req: TaskChangeRequest, approver) -> str:
    """The approval email/WhatsApp has to stand on its own: WHICH task, WHOSE
    task it is, what exactly changes, and why it reached this person. Without
    that an approver only sees "wants to change due_at, assigned_to" and has
    no idea why it landed in their inbox."""
    task = req.task

    def who(u):
        return (u.get_full_name() or u.username) if u else "-"

    if approver.id == task.created_by_id:
        because = "This is yours to decide because you gave out this task."
    elif approver.id == getattr(req.requested_by, "reporting_manager_id", None):
        because = ("This is yours to decide because "
                   f"{who(req.requested_by)} reports to you and this is their own task.")
    elif has_capability(approver, "tasks.view_all"):
        because = ("This reached you as an admin because there is no reporting "
                   f"manager on file for {who(req.requested_by)} - set one in "
                   "My Team so these stop coming to admins.")
    else:
        because = "You have been asked to review this request."
    lines = [
        f"Task: {task.code} - {task.title}",
        f"Assigned to: {who(task.assigned_to)}",
        f"Task created by: {who(task.created_by)}",
        f"Change requested by: {who(req.requested_by)}",
        "",
        "Proposed changes:",
    ]
    lines += [f"  - {line}" for line in req.describe()]
    lines += ["", f"Reason: {req.reason[:300]}", "", because,
              "Open Tasks -> Requests to approve, reject or escalate."]
    return "\n".join(lines)


def _change_request_wa(req: TaskChangeRequest, approver):
    """The WhatsApp reminder that a request is waiting on this person. Only
    non-admins get it: admins see every request under Tasks -> Requests and
    would otherwise be pinged for the whole company."""
    if is_top_admin(approver.role):
        return None
    task = req.task
    return ("task_change_request", [
        approver.get_full_name() or approver.username,
        req.requested_by.get_full_name() or req.requested_by.username,
        f"{task.code} - {task.title}",
        "; ".join(req.describe()) or "-",
        req.reason[:300] or "-",
    ])


def can_review_request(user, req: TaskChangeRequest) -> bool:
    """Derived from _approvers_for, so routing and permission never drift."""
    if req.requested_by_id == user.id:
        return False                       # never your own request
    if req.escalated:                      # escalated: only admin decides
        return has_capability(user, "tasks.view_all")
    if any(a.pk == user.pk for a in _approvers_for(req)):
        return True
    return has_capability(user, "tasks.view_all")   # admin backstop


def _notify_task_assigned(task, actor):
    """WhatsApp automation A: the assignment ping carries ALL the details —
    one message tells the whole story."""
    if task.assigned_to_id == actor.id:
        return
    bits = [f"{task.code} · {task.title}"]
    if task.description:
        bits.append(task.description[:300])
    facts = []
    if task.due_at:
        facts.append(f"Due: {timezone.localtime(task.due_at):%d %b %H:%M}")
    if task.effort_minutes:
        facts.append(f"Effort: {task.effort_minutes}m")
    if task.priority != "normal":
        facts.append(f"Priority: {task.get_priority_display()}")
    if task.category:
        facts.append(f"Category: {task.category}")
    if task.frequency != TaskFrequency.ONE_TIME:
        facts.append(f"Repeats: {task.get_frequency_display()}"
                     + (f" till {task.repeat_until:%d %b}" if task.repeat_until else ""))
    if task.lead:
        facts.append(f"Lead: {task.lead.customer_name}")
    if facts:
        bits.append(" · ".join(facts))
    who = actor.get_full_name() or actor.username
    bits.append(f"Assigned by: {who} · {timezone.localtime():%d %b %Y, %I:%M %p}")
    notify(
        task.assigned_to, "task_assigned",
        f"Task assigned by {who}: {task.title}"[:200],
        "\n".join(bits),
        link=f"/tasks/{task.id}",
        wa_template=("new_task_assigne", [
            task.assigned_to.get_full_name() or task.assigned_to.username,
            f"{task.code} · {task.title}",
            task.description or "—",
            f"{task.get_priority_display()} (by {who})",
            f"{timezone.localtime(task.due_at):%d %b %Y, %I:%M %p}" if task.due_at else "Not set",
        ]),
    )


def _notify_task_completed(task, actor):
    """WhatsApp automation B: completion goes to EVERYONE involved — the
    creator, the assignee (when someone else closed it) and all followers
    (in-loop subscribers)."""
    took = f" — took {task.actual_minutes}m" if task.actual_minutes else ""
    assigned = f" (assigned {task.effort_minutes}m)" if task.effort_minutes else ""
    body = (f"{task.code} · {task.title}\nCompleted by "
            f"{actor.get_full_name() or actor.username} on "
            f"{timezone.localtime():%d %b %Y, %I:%M %p}{took}{assigned}."
            + (f"\nNote: {task.completion_note[:200]}" if task.completion_note else ""))
    when = f"{timezone.localtime():%d %b %Y, %I:%M %p}"
    targets = {task.created_by, task.assigned_to}
    targets.update(task.subscribers.all())
    for target in targets:
        if target and target.is_active and target.pk != actor.pk:
            notify(target, "task_completed",
                   f"✅ Completed: {task.title}"[:200], body, link=f"/tasks/{task.id}",
                   wa_template=("task_completed_alert", [
                       target.get_full_name() or target.username,
                       f"{task.code} · {task.title}",
                       actor.get_full_name() or actor.username,
                       when + (took or "") + (assigned or ""),
                       task.completion_note or "—",
                   ]))


def _advance_due(due, frequency):
    if frequency == TaskFrequency.DAILY:
        return due + timedelta(days=1)
    if frequency == TaskFrequency.WEEKLY:
        return due + timedelta(weeks=1)
    # monthly: same day next month (clamped to 28 to stay valid)
    month = due.month % 12 + 1
    year = due.year + (1 if due.month == 12 else 0)
    return due.replace(year=year, month=month, day=min(due.day, 28))


def _spawn_next_occurrence(task, actor):
    """Completing a recurring task creates the next one -- unless the
    recurrence's end date (repeat_until) has been reached."""
    if task.frequency == TaskFrequency.ONE_TIME or not task.due_at:
        return None
    next_due = _advance_due(task.due_at, task.frequency)
    if task.repeat_until and timezone.localtime(next_due).date() > task.repeat_until:
        act(task, actor, f"Recurrence ended (until {task.repeat_until})")
        return None
    nxt = Task.objects.create(
        title=task.title, description=task.description, category=task.category,
        frequency=task.frequency, repeat_until=task.repeat_until,
        effort_minutes=task.effort_minutes,
        lead=task.lead, assigned_to=task.assigned_to,
        created_by=task.created_by, priority=task.priority,
        due_at=next_due,
    )
    nxt.subscribers.set(task.subscribers.all())
    act(nxt, actor, f"Auto-created next {task.get_frequency_display().lower()} occurrence")
    return nxt


# ---------------------------------------------------------------------------

RANGES = ("today", "yesterday", "this_week", "last_week", "this_month",
          "last_month", "this_year", "all")


def _range_bounds(name, now):
    """(start, end) date bounds in local time; None = unbounded."""
    today = timezone.localtime(now).date()
    if name == "today":
        return today, today
    if name == "yesterday":
        d = today - timedelta(days=1)
        return d, d
    if name == "this_week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if name == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
        return start, start + timedelta(days=6)
    if name == "this_month":
        first = today.replace(day=1)
        next_first = (first + timedelta(days=32)).replace(day=1)
        return first, next_first - timedelta(days=1)
    if name == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1), last_prev
    if name == "this_year":
        return today.replace(month=1, day=1), today.replace(month=12, day=31)
    return None, None  # all


class TaskViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = TaskSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        user = self.request.user
        p = self.request.query_params
        scope = p.get("scope")
        if scope == "deleted":
            # The Deleted Tasks bin -- admin only
            if not has_capability(user, "tasks.view_all"):
                from rest_framework.exceptions import PermissionDenied as PD
                raise PD("Only an admin can view deleted tasks.")
            return (visible_tasks(user, include_deleted=True)
                    .filter(deleted_at__isnull=False).order_by("-deleted_at"))
        qs = visible_tasks(user)
        if scope == "my":
            qs = qs.filter(assigned_to=user)
        elif scope == "delegated":
            qs = qs.filter(created_by=user).exclude(assigned_to=user)
        elif scope == "subscribed":
            qs = qs.filter(subscribers=user)
        if p.get("status"):
            qs = qs.filter(status__in=p["status"].split(","))
        if p.get("assigned_to"):
            # "All Tasks" filters by one person or several at once
            ids = [i for i in p["assigned_to"].split(",") if i.strip().isdigit()]
            qs = qs.filter(assigned_to_id__in=ids) if ids else qs.none()
        if p.get("department"):
            qs = qs.filter(assigned_to__department__in=p["department"].split(","))
        if p.get("manager"):
            # everyone reporting to this manager (their team's tasks in one go)
            qs = qs.filter(assigned_to__reporting_manager_id=p["manager"])
        if p.get("created_by"):
            qs = qs.filter(created_by_id=p["created_by"])
        if p.get("priority"):
            qs = qs.filter(priority__in=p["priority"].split(","))
        if p.get("lead"):
            qs = qs.filter(lead_id=p["lead"])
        if p.get("group"):
            qs = qs.filter(group_id=p["group"])
        if p.get("category"):
            qs = qs.filter(category__iexact=p["category"])
        if p.get("frequency"):
            qs = qs.filter(frequency=p["frequency"])
        if p.get("recurring") == "true":
            qs = qs.exclude(frequency=TaskFrequency.ONE_TIME)
        if p.get("overdue") == "true":
            qs = qs.exclude(status=TaskStatus.DONE).filter(due_at__lt=timezone.now())
        if p.get("done") in ("on_time", "late"):
            # finished on time = done by the due date (or no due date at all)
            on_time = Q(due_at__isnull=True) | Q(completed_at__lte=F("due_at"))
            qs = qs.filter(status=TaskStatus.DONE)
            qs = qs.filter(on_time) if p["done"] == "on_time" else qs.exclude(on_time)
        if p.get("range") and p["range"] != "all":
            start, end = self._report_bounds(p, timezone.now())
            if start:
                from django.db.models import Q as _Q
                # A finished task is judged by the day it was CLOSED -- that is
                # what "completed this week" means. One still open has no such
                # date, so it is judged by the deadline it is measured against.
                lo = timezone.make_aware(datetime.combine(start, dt_time.min))
                hi = timezone.make_aware(datetime.combine(end, dt_time.max))
                qs = qs.filter(
                    _Q(status=TaskStatus.DONE, completed_at__range=(lo, hi))
                    | (~_Q(status=TaskStatus.DONE) & _Q(due_at__range=(lo, hi))))
                # the screen shows these, so nobody has to work out where a
                # week ends -- the same fix the dashboard already got
                self.request.applied_range = (start.isoformat(), end.isoformat())
        if p.get("search"):
            from django.db.models import Q as _Q
            term = p["search"].strip()
            clause = (_Q(title__icontains=term) | _Q(description__icontains=term)
                      | _Q(assigned_to__first_name__icontains=term)
                      | _Q(assigned_to__last_name__icontains=term)
                      | _Q(assigned_to__username__icontains=term))
            # "code" is a property (T-00042), so match its digits against the pk
            digits = term.lstrip("Tt-").lstrip("0")
            if digits.isdigit():
                clause |= _Q(pk=int(digits))
            qs = qs.filter(clause)
        return qs

    def _resolve_category(self, user, department, name):
        """Employees must pick a managed category; managers/admin typing a
        new name create it on the fly (the inline 'Add Category')."""
        name = (name or "").strip()
        if not name:
            return ""
        from django.db.models import Q as _Q
        match = (TaskCategory.objects.filter(name__iexact=name)
                 .filter(_Q(department="") | _Q(department=department or ""))
                 .order_by("-active").first())
        if match and match.active:
            return match.name           # canonical casing
        if has_capability(user, "tasks.assign"):
            if match:                   # was deactivated — bring it back
                match.active = True
                match.save(update_fields=["active"])
                return match.name
            TaskCategory.objects.create(name=name[:60], department=department or "",
                                        created_by=user)
            return name[:60]
        raise ValidationError({
            "category": "Pick a category from the list — only managers can add new ones."})

    def perform_create(self, serializer):
        user = self.request.user
        assignee = serializer.validated_data.get("assigned_to")
        if assignee and not can_assign_to(user, assignee):
            raise PermissionDenied("That person is not an active user.")
        # B6: effort is mandatory when creating a task by hand -- scoring
        # depends on it (system-created tasks from forms/templates are exempt).
        missing = {}
        if not serializer.validated_data.get("effort_minutes"):
            missing["effort_minutes"] = "Effort is required — how long should this task take?"
        # No due date means no reminder, no overdue flag and no on-time score,
        # so the task quietly falls out of every report. Make it mandatory.
        due = serializer.validated_data.get("due_at")
        if not due:
            missing["due_at"] = "Due date is required — reminders and on-time scoring need it."
        elif due <= timezone.now():
            local = timezone.localtime(due)
            missing["due_at"] = (
                f"That deadline is already past ({local:%d %b %Y, %I:%M %p}). "
                "Check AM/PM — did you mean "
                f"{(local + timedelta(hours=12)):%I:%M %p}?")
        if missing:
            raise ValidationError(missing)
        serializer.validated_data["category"] = self._resolve_category(
            user,
            serializer.validated_data.get("department", ""),
            serializer.validated_data.get("category", ""))
        # E1: sub-tasks are one level deep and only under tasks you can see
        parent = serializer.validated_data.get("parent")
        if parent:
            if parent.deleted_at or not visible_tasks(user).filter(pk=parent.pk).exists():
                raise ValidationError({"parent": "Unknown parent task."})
            if parent.parent_id:
                raise ValidationError({"parent": "Sub-tasks can't have their own sub-tasks."})
        lead = serializer.validated_data.get("lead")
        if lead and not visible_leads(user).filter(pk=lead.pk).exists():
            raise PermissionDenied("You cannot link a task to a lead you cannot see.")
        group = serializer.validated_data.get("group")
        if group:
            from workspace.access import user_group_ids, is_workspace_admin
            if group.id not in user_group_ids(user) and not is_workspace_admin(user):
                raise PermissionDenied("You can only create tasks in groups you belong to.")
        task = serializer.save(created_by=user)
        task.subscribers.add(user)  # creator follows their own delegation
        # The person GIVING the task breaks it into steps -- the assignee
        # ticks them off one by one and cannot finish until all are done.
        steps = self.request.data.get("checklist") or []
        if isinstance(steps, list):
            for i, step in enumerate(steps[:30]):
                if isinstance(step, dict):
                    text = str(step.get("text", "")).strip()
                    due_at = step.get("due_at") or None
                else:
                    text = str(step).strip()
                    due_at = None
                
                if text:
                    TaskChecklistItem.objects.create(
                        task=task, text=text[:200], order=i,
                        due_at=due_at,
                        created_by=user)
        # B7: "In-Loop" — colleagues added at creation start following the task
        in_loop = self.request.data.get("in_loop") or []
        if isinstance(in_loop, list):
            for uid in in_loop[:20]:
                colleague = User.objects.filter(pk=uid, is_active=True).first()
                if colleague and colleague.pk != user.pk:
                    task.subscribers.add(colleague)
                    notify(colleague, "task_inloop",
                           f"Kept in the loop - {task.code}: {task.title}"[:200],
                           "\n".join([
                               f"Task: {task.code} - {task.title}",
                               f"Assigned to: {task.assigned_to.get_full_name() or task.assigned_to.username}",
                               f"Added you: {user.get_full_name() or user.username}",
                               f"Due: {timezone.localtime(task.due_at):%d %b %Y, %I:%M %p}"
                               if task.due_at else "Due: not set",
                               "",
                               "You are only following this - it is not assigned to you.",
                               "It shows under Tasks > Subscribed.",
                           ]),
                           link=f"/tasks/{task.id}",
                           wa_template=("task_inloop_alert", [
                               colleague.get_full_name() or colleague.username,
                               f"{task.code} - {task.title}",
                               task.assigned_to.get_full_name() or task.assigned_to.username,
                               user.get_full_name() or user.username,
                               f"{timezone.localtime(task.due_at):%d %b %Y, %I:%M %p}"
                               if task.due_at else "Not set",
                           ]))
        act(task, user, f"Created and assigned to {task.assigned_to.get_full_name() or task.assigned_to.username}")
        if task.lead:
            LeadEvent.objects.create(
                lead=task.lead, type=EventType.NOTE, actor=user,
                body=f"Task created: {task.title}", payload={"task_id": task.pk},
            )
        _notify_task_assigned(task, user)

    def perform_update(self, serializer):
        """B1 edit lockdown (Sir's anti-manipulation rule):
        - Admin: full edit, logged.
        - Assignee: STATUS ONLY (their whole job is moving it forward).
        - Everyone else -- including the creator: no direct edits. Propose a
          Modification Request instead."""
        user = self.request.user
        task = self.get_object()
        is_admin = has_capability(user, "tasks.view_all")
        data = serializer.validated_data

        if not is_admin:
            changed = {k for k, v in data.items() if getattr(task, k) != v}
            if task.assigned_to_id == user.id and changed <= {"status"}:
                pass  # assignee moving their own task forward
            elif not changed:
                pass  # no-op save
            else:
                raise PermissionDenied(
                    "Tasks can't be edited directly — use “Request change” and the "
                    + ("task creator" if task.created_by_id != user.id else "admin")
                    + " will approve it.")
        else:
            new_assignee = data.get("assigned_to", task.assigned_to)
            if new_assignee and new_assignee != task.assigned_to and not can_assign_to(user, new_assignee):
                raise PermissionDenied("That person is not an active user.")

        old_assignee, old_status = task.assigned_to, task.status

        # B3: completion evidence -- enforced no matter which path marks it done
        if data.get("status") == TaskStatus.DONE and old_status != TaskStatus.DONE:
            self._enforce_completion_evidence(task)

        updated = serializer.save()
        self._after_status_change(updated, user, old_status, old_assignee, is_admin)

    def _enforce_checklist_done(self, task):
        """A task built out of steps is finished when the STEPS are finished --
        you cannot skip to the end and tick the whole thing off."""
        left = task.checklist.filter(done=False)
        n = left.count()
        if n:
            raise ValidationError({
                "detail": f"{n} step{'' if n == 1 else 's'} still open — finish the "
                          "checklist first: " + ", ".join(i.text for i in left[:3])
                          + ("…" if n > 3 else ""),
                "needs": "checklist"})

    def _enforce_completion_evidence(self, task, remarks="", has_new_file=False):
        self._enforce_checklist_done(task)
        # P2: a completion description is ALWAYS required now (reviewer's
        # rule) -- the settings toggle only governs the proof attachment.
        if not remarks:
            raise ValidationError({
                "detail": "A completion description is required — say what was done.",
                "needs": "remarks"})
        cfg = TaskSettings.get()
        if cfg.require_completion_attachment and not has_new_file and not task.attachments.exists():
            raise ValidationError({
                "detail": "A proof attachment (file/photo) is required to complete this task.",
                "needs": "attachment"})

    def _after_status_change(self, updated, user, old_status, old_assignee, was_admin_edit=False):
        if updated.status != old_status:
            act(updated, user, f"Status: {old_status} -> {updated.status}")
        if updated.status == TaskStatus.DONE and old_status != TaskStatus.DONE:
            updated.completed_at = timezone.now()
            updated.save(update_fields=["completed_at"])
            _notify_task_completed(updated, user)
            self._sync_linked_mistake(updated, user)
            if updated.lead:
                LeadEvent.objects.create(
                    lead=updated.lead, type=EventType.NOTE, actor=user,
                    body=f"Task completed: {updated.title}", payload={"task_id": updated.pk},
                )
            _spawn_next_occurrence(updated, user)
        elif updated.status != TaskStatus.DONE and old_status == TaskStatus.DONE:
            updated.completed_at = None
            updated.save(update_fields=["completed_at"])
        if updated.assigned_to != old_assignee:
            act(updated, user, f"Reassigned to {updated.assigned_to.get_full_name() or updated.assigned_to.username}")
            _notify_task_assigned(updated, user)
        if was_admin_edit and user.pk not in (updated.assigned_to_id, updated.created_by_id):
            act(updated, user, "Edited directly by admin")

    def _sync_linked_mistake(self, task, user):
        """A completed corrective task updates its mistake automatically
        (Sir's task-integration rule). Lazy import — mistakes imports crm."""
        from mistakes.models import Mistake
        from mistakes.views import log as mlog
        mistake = Mistake.objects.filter(corrective_task=task).select_related("manager").first()
        if not mistake:
            return
        mlog(mistake, user, f"Corrective task {task.code} completed"
             + (f": {task.completion_note[:150]}" if task.completion_note else ""))
        if mistake.manager and mistake.manager.pk != user.pk:
            notify(mistake.manager, "mistake_update",
                   f"{mistake.code}: corrective task done",
                   f"{task.code} {task.title} — review and resolve the mistake.",
                   link="/mistakes")

    def perform_destroy(self, instance):
        """SOFT delete -- the task lands in the Deleted bin.

        The assignee never gets here: they raise a cancel request instead,
        with a reason, and the person who gave them the task decides.
        """
        if not can_delete_task(self.request.user, instance):
            raise PermissionDenied(delete_refusal(self.request.user, instance))
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at"])
        act(instance, self.request.user, "Moved to Deleted Tasks")

    @action(detail=True, methods=["post"], permission_classes=[HasCapability.of("tasks.view_all")])
    def restore(self, request, pk=None):
        task = Task.objects.filter(pk=pk, deleted_at__isnull=False).first()
        if not task:
            raise ValidationError({"detail": "This task is not in the Deleted bin."})
        task.deleted_at = None
        task.save(update_fields=["deleted_at"])
        act(task, request.user, "Restored from Deleted Tasks")
        return Response(TaskSerializer(task, context={"request": request}).data)

    def retrieve(self, request, *args, **kwargs):
        """E1: the detail slide-over gets checklist + sub-tasks inline, and
        the daily progress log with them -- one round trip, not four."""
        data = super().retrieve(request, *args, **kwargs).data
        task = self.get_object()
        from .serializers import TaskChecklistItemSerializer
        data["checklist"] = TaskChecklistItemSerializer(task.checklist.all(), many=True).data
        data["subtasks"] = [
            {"id": s.id, "code": s.code, "title": s.title, "status": s.status,
             "assignee": s.assigned_to.get_full_name() or s.assigned_to.username}
            for s in task.subtasks.select_related("assigned_to").filter(deleted_at__isnull=True)
        ]
        data["day_log"] = day_log_payload(task, request.user)
        return Response(data)

    def _can_touch_detail(self, user, task) -> bool:
        return (user.pk in (task.assigned_to_id, task.created_by_id)
                or has_capability(user, "tasks.view_all"))

    # ---- E1: checklist / comments / per-task feed ------------------------
    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        """Task Updates feed — system logs + comments for ONE task."""
        acts = self.get_object().activities.select_related("actor")[:100]
        return Response(TaskActivitySerializer(acts, many=True).data)

    @action(detail=True, methods=["get"], url_path="day_logs")
    def day_logs(self, request, pk=None):
        """The day-by-day timeline: every calendar day between the task's
        start and its due date, carrying that day's entry or nothing at all.
        Anyone who can see the task can read it; only the assignee writes."""
        return Response(day_log_payload(self.get_object(), request.user))

    @action(detail=True, methods=["post"], url_path="day_log")
    def day_log(self, request, pk=None):
        """Add or replace ONE day's progress entry -- "what I did today" plus
        an optional plan for tomorrow, % and minutes. Assignee only, one entry
        per calendar day, so posting twice on the same day edits that day."""
        task = self.get_object()
        if task.assigned_to_id != request.user.id:
            raise PermissionDenied(
                "Only the person this task is assigned to can write the daily "
                "progress log. You can read it and leave a comment instead.")
        if task.status == TaskStatus.DONE:
            raise ValidationError({"detail":
                "This task is already completed — its daily log is closed."})
        if task.deleted_at:
            raise ValidationError({"detail": "This task is deleted."})

        today = timezone.localdate()
        raw_date = request.data.get("date")
        if raw_date in (None, ""):
            day = today
        else:
            day = parse_date(str(raw_date))
            if not day:
                raise ValidationError({"date":
                    "Send the day as YYYY-MM-DD, or leave it out for today."})
        if day > today:
            raise ValidationError({"date":
                "You cannot write tomorrow's entry today. Put it under "
                "“Plan for tomorrow” and fill the day in when it arrives."})
        if (today - day).days > DAY_LOG_BACKFILL_DAYS:
            raise ValidationError({"date":
                f"{day:%d %b} is too far back to fill in now — only the last "
                f"{DAY_LOG_BACKFILL_DAYS + 1} days (today included) can be edited. "
                "Post today's entry and say what happened."})
        started = timezone.localdate(task.created_at)
        epoch = day_log_epoch()
        if day < started:
            raise ValidationError({"date":
                f"This task only started on {started:%d %b} — there is no "
                f"{day:%d %b} to report on."})
        if epoch and day < epoch:
            raise ValidationError({"date":
                f"The daily log only started on {epoch:%d %b} — days before "
                "that were never meant to be filled in."})

        did = str(request.data.get("did", "")).strip()
        if len(did) < 5:
            raise ValidationError({"did":
                "Write what you actually did today — a line or two is enough "
                "(e.g. “Called the vendor and got the revised quote”)."})
        plan = str(request.data.get("plan_tomorrow", "")).strip()

        percent = request.data.get("percent_done")
        if percent not in (None, ""):
            try:
                percent = int(percent)
                if not 0 <= percent <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"percent_done":
                    "% work done must be a whole number between 0 and 100."})
        else:
            percent = None
        minutes = request.data.get("minutes_spent")
        if minutes not in (None, ""):
            try:
                minutes = int(minutes)
                if not 1 <= minutes <= 60 * 24:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"minutes_spent":
                    "Time spent must be between 1 and 1440 minutes (24 hours). "
                    "It is this one day's time, not the total for the task."})
        else:
            minutes = None

        log, created = TaskDayLog.objects.update_or_create(
            task=task, date=day,
            defaults={"did": did[:2000], "plan_tomorrow": plan[:2000],
                      "percent_done": percent, "minutes_spent": minutes,
                      "author": request.user},
        )

        # The task's progress_percent is the LATEST self-reported number, so
        # mirror this day's % only when it is the newest day logged -- going
        # back to fix Monday must not drag today's headline figure backwards.
        # actual_minutes is deliberately NOT touched: it is a running total set
        # by status updates and completion, and adding day minutes on top would
        # double count in the Time Spent report.
        fields = []
        newest = task.day_logs.order_by("-date").values_list("date", flat=True).first()
        if percent is not None and day == newest:
            task.progress_percent = percent
            fields.append("progress_percent")
        old_status = task.status
        if task.status == TaskStatus.OPEN:
            task.status = TaskStatus.IN_PROGRESS
            fields.append("status")
        if fields:
            task.save(update_fields=fields)
        act(task, request.user,
            f"Day log {day:%d %b} ({'added' if created else 'updated'}): {did[:150]}")
        if old_status != task.status:
            act(task, request.user, f"Status: {old_status} -> {task.status}")
        return Response(day_log_payload(task, request.user),
                        status=http.HTTP_201_CREATED if created else http.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def comment(self, request, pk=None):
        task = self.get_object()
        text = str(request.data.get("text", "")).strip()
        if not text:
            raise ValidationError({"text": "Say something."})
        TaskActivity.objects.create(task=task, actor=request.user,
                                    text=text[:300], kind="comment")
        for target in (task.assigned_to, task.created_by):
            if target and target.is_active and target.pk != request.user.pk:
                who_c = request.user.get_full_name() or request.user.username
                notify(target, "task_comment",
                       f"Comment from {who_c} on {task.code}: {task.title}"[:200],
                       "\n".join([
                           f"Task: {task.code} - {task.title}",
                           f"Assigned to: {task.assigned_to.get_full_name() or task.assigned_to.username}"
                           if task.assigned_to else "Assigned to: -",
                           "",
                           f"{who_c} wrote:",
                           text[:300],
                           "",
                           "Open Tasks to reply.",
                       ]),
                       link=f"/tasks/{task.id}", link_label="Reply to this task",
                       wa_template=("task_comment_alert", [
                           target.get_full_name() or target.username,
                           who_c,
                           f"{task.code} - {task.title}",
                           text[:280],
                       ]))
        acts = task.activities.select_related("actor")[:100]
        return Response(TaskActivitySerializer(acts, many=True).data,
                        status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def add_check(self, request, pk=None):
        task = self.get_object()
        if not self._can_touch_detail(request.user, task):
            raise PermissionDenied("Only the assignee, creator or admin can edit the checklist.")
        text = str(request.data.get("text", "")).strip()
        due_at = request.data.get("due_at") or None
        if not text:
            raise ValidationError({"text": "Checklist item text is required."})
        last = task.checklist.order_by("-order").first()
        TaskChecklistItem.objects.create(task=task, text=text[:200],
                                         due_at=due_at,
                                         order=(last.order + 1) if last else 0,
                                         created_by=request.user)
        from .serializers import TaskChecklistItemSerializer
        return Response(TaskChecklistItemSerializer(task.checklist.all(), many=True).data,
                        status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="check/(?P<item_id>[0-9]+)")
    def check(self, request, pk=None, item_id=None):
        """Toggle one checklist item (or ?delete=true removes it)."""
        task = self.get_object()
        if not self._can_touch_detail(request.user, task):
            raise PermissionDenied("Only the assignee, creator or admin can edit the checklist.")
        item = task.checklist.filter(pk=item_id).first()
        if not item:
            raise ValidationError({"detail": "Unknown checklist item."})
        if request.query_params.get("delete") == "true":
            if item.done:
                raise ValidationError(
                    {"detail": "This step is already done — it cannot be removed."})
            if request.user.id == task.assigned_to_id                     and request.user.id != task.created_by_id                     and not has_capability(request.user, "tasks.view_all"):
                raise PermissionDenied(
                    "Only the person who set the steps can remove one.")
            item.delete()
        elif item.done:
            # un-ticking clears the note as well, so it can never go stale
            item.done, item.note, item.done_by, item.done_at = False, "", None, None
            item.save(update_fields=["done", "note", "done_by", "done_at"])
            act(task, request.user, f"Step re-opened: {item.text[:110]}")
        else:
            note = str(request.data.get("note", "")).strip()
            if len(note) < 5:
                raise ValidationError({
                    "note": "Say what you did for this step (a few words).",
                    "needs": "note"})
            item.done, item.note = True, note[:300]
            item.done_by, item.done_at = request.user, timezone.now()
            item.save(update_fields=["done", "note", "done_by", "done_at"])
            act(task, request.user, f"Step done: {item.text[:90]} - {note[:120]}")
        from .serializers import TaskChecklistItemSerializer
        return Response(TaskChecklistItemSerializer(task.checklist.all(), many=True).data)

    # ---- E3: AI layer (Claude behind AI_ENABLED, rules otherwise) --------
    @action(detail=False, methods=["post"])
    def ai_draft(self, request):
        """'Generate with AI Prompt': natural language -> title/description/
        checklist draft. Never blocks — falls back to rules."""
        prompt = str(request.data.get("prompt", "")).strip()
        if not prompt:
            raise ValidationError({"prompt": "Describe the task in your own words."})
        return Response(draft_task(prompt))

    @action(detail=False, methods=["post"])
    def proofread(self, request):
        """Spelling and grammar pass over whatever a person typed. The browser
        underlines mistakes but only offers fixes on right-click, which nobody
        finds -- this is the button they were looking for."""
        text = str(request.data.get("text", ""))
        if not text.strip():
            raise ValidationError({"text": "Nothing to check."})
        if len(text) > 4000:
            raise ValidationError({"text": "Too long to check — keep it under 4000 characters."})
        return Response(proofread(text))

    # a voice note is short; anything longer is a meeting, not a task
    VOICE_MAX_BYTES = 10 * 1024 * 1024

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def voice_draft(self, request):
        """T-00136: speak a task, get the form filled in. Creates nothing."""
        clip = request.FILES.get("audio")
        if not clip:
            raise ValidationError({"audio": "Record something first."})
        if clip.size > self.VOICE_MAX_BYTES:
            raise ValidationError({"audio": "That recording is too long — keep it under a minute or two."})
        if not llm.can_transcribe():
            raise ValidationError({"audio":
                "Voice notes need the Gemini key. Type the task instead."})

        people = list(assignable_users(request.user)
                      .order_by("first_name", "username")[:200])
        names = [(u.get_full_name() or u.username).strip() for u in people]

        transcript = llm.transcribe(clip.read(), clip.content_type or "audio/webm",
                                    hint=", ".join(names[:60]))
        if not transcript:
            raise ValidationError({"audio":
                "Could not make out the recording — try again somewhere quieter, "
                "or type it."})

        now = timezone.now()
        draft = draft_from_speech(transcript, timezone.localtime(now), names)

        # ---- who: matched here, never chosen by the model -----------------
        assigned_to = assigned_to_name = None
        spoken = (draft.get("assignee") or "").strip().lower()
        if spoken:
            # A full name wins over a partial one, but only if exactly one
            # person has it. Two colleagues with the same name means we do not
            # know who was meant -- say so rather than pick the first row.
            exact = [u for u, n in zip(people, names) if n.lower() == spoken]
            loose = [u for u, n in zip(people, names)
                     if spoken in n.lower() or n.lower().split()[0] == spoken]
            match = (exact[0] if len(exact) == 1
                     else loose[0] if (not exact and len(loose) == 1) else None)
            if match:
                assigned_to = match.id
                assigned_to_name = match.get_full_name() or match.username

        # ---- when: same past-deadline guard as the typed form -------------
        due_at = None
        raw_due = draft.get("due_at")
        if raw_due:
            parsed = parse_datetime(str(raw_due))
            if parsed:
                if timezone.is_naive(parsed):
                    parsed = timezone.make_aware(parsed)
                if parsed > now:
                    due_at = parsed.isoformat()

        return Response({
            "transcript": transcript,
            "title": draft.get("title", ""),
            "description": draft.get("description", ""),
            "checklist": draft.get("checklist", []),
            "assigned_to": assigned_to,
            "assigned_to_name": assigned_to_name,
            # said a name we could not place -- tell them rather than guessing
            "assignee_heard": draft.get("assignee") if not assigned_to else None,
            "due_at": due_at,
            "due_heard": raw_due if (raw_due and not due_at) else None,
            "effort_minutes": draft.get("effort_minutes"),
            "provider": draft.get("provider"),
        })

    @action(detail=True, methods=["post"])
    def summarize(self, request, pk=None):
        task = self.get_object()
        return Response(summarize_task(task, list(task.activities.all()[:15])))

    # ---- extra actions ---------------------------------------------------
    @action(detail=False, methods=["get"])
    def assignees(self, request):
        """A1: the people THIS user may assign to -- every active user."""
        users = list(assignable_users(request.user).order_by("first_name", "username"))
        return Response(people_for_picker(users))

    # C1 soft-warning thresholds: a full workday of pending effort, or a
    # pile of open tasks. Informs the assigner — never blocks the save.
    WORKLOAD_WARN_MINUTES = 8 * 60
    WORKLOAD_WARN_OPEN = 10

    @action(detail=False, methods=["get"])
    def workload(self, request):
        """C1/C2: one person's current pipeline — open-task count, priority
        breakdown, pending effort. Visible to anyone who could assign to
        them, their reporting manager, and dept/all viewers."""
        try:
            target_id = int(request.query_params.get("user", ""))
        except (TypeError, ValueError):
            raise ValidationError({"user": "Pass a user id."})
        target = User.objects.filter(pk=target_id, is_active=True).first()
        if not target:
            raise ValidationError({"user": "Unknown or inactive user."})
        allowed = (
            can_assign_to(request.user, target)
            or has_capability(request.user, "tasks.view_all")
            or (has_capability(request.user, "tasks.view_department")
                and target.department == request.user.department)
            or target.reporting_manager_id == request.user.id
        )
        if not allowed:
            raise PermissionDenied("You cannot view this person's workload.")

        qs = Task.objects.filter(assigned_to=target, deleted_at__isnull=True) \
                         .exclude(status=TaskStatus.DONE)
        rows = list(qs.values_list("priority", "effort_minutes", "due_at"))
        now = timezone.now()
        by_priority = Counter(p for p, _, _ in rows)
        pending_effort = sum(e for _, e, _ in rows if e)
        no_effort = sum(1 for _, e, _ in rows if not e)
        open_count = len(rows)
        return Response({
            "user": target.pk,
            "name": target.get_full_name() or target.username,
            "open_tasks": open_count,
            "overdue": sum(1 for _, _, d in rows if d and d < now),
            "priority_breakdown": {p: by_priority.get(p, 0)
                                   for p in ("urgent", "high", "normal", "low")},
            "pending_effort_minutes": pending_effort,
            "tasks_without_effort": no_effort,  # count toward load but earn 0h
            "overloaded": (pending_effort >= self.WORKLOAD_WARN_MINUTES
                           or open_count >= self.WORKLOAD_WARN_OPEN),
        })

    @action(detail=True, methods=["post"])
    def estimate(self, request, pk=None):
        """A2: the assignee's one-time counter-estimate. It never overwrites
        the assigner's effort value -- both go to the review report."""
        task = self.get_object()
        if task.assigned_to_id != request.user.id:
            raise PermissionDenied("Only the assignee can give their estimate.")
        if task.assignee_estimate_minutes is not None:
            raise ValidationError({"detail": "You already gave your estimate — it can't be changed."})
        try:
            minutes = int(request.data.get("minutes"))
            if not 1 <= minutes <= 60 * 24 * 30:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({"minutes": "Give your estimate in minutes (1 – 43200)."})
        task.assignee_estimate_minutes = minutes
        task.save(update_fields=["assignee_estimate_minutes"])
        assigner_view = f"{task.effort_minutes} min" if task.effort_minutes else "not set"
        act(task, request.user, f"Assignee estimate: {minutes} min (assigner said: {assigner_view})")
        return Response(TaskSerializer(task, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def progress(self, request, pk=None):
        """P1: repeatable 'In Progress — Status Update'. % work done, total
        effort spent so far, comment — each optional (but send at least one).
        Everything lands in the task's activity history."""
        task = self.get_object()
        if task.assigned_to_id != request.user.id:
            raise PermissionDenied("Only the assignee can post a status update.")
        if task.status == TaskStatus.DONE:
            raise ValidationError({"detail": "This task is already completed."})
        if task.deleted_at:
            raise ValidationError({"detail": "This task is deleted."})

        updates = []
        percent = request.data.get("percent")
        if percent not in (None, ""):
            try:
                percent = int(percent)
                if not 0 <= percent <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"percent": "% work done must be between 0 and 100."})
            task.progress_percent = percent
            updates.append(f"{percent}% done")
        spent = request.data.get("spent_minutes")
        if spent not in (None, ""):
            try:
                spent = int(spent)
                if not 1 <= spent <= 60 * 24 * 90:
                    raise ValueError
            except (TypeError, ValueError):
                raise ValidationError({"spent_minutes": "Effort spent must be a positive number of minutes."})
            task.actual_minutes = spent          # running total so far
            updates.append(f"{spent}m spent so far")
        comment = str(request.data.get("comment", "")).strip()
        if comment:
            updates.append(f"“{comment[:200]}”")
        if not updates:
            raise ValidationError({"detail": "Nothing to update — add a %, effort spent, or a comment."})

        old_status = task.status
        if task.status == TaskStatus.OPEN:
            task.status = TaskStatus.IN_PROGRESS
        task.save(update_fields=["progress_percent", "actual_minutes", "status"])
        act(task, request.user, "Status update: " + " · ".join(updates))
        if old_status != task.status:
            act(task, request.user, f"Status: {old_status} -> {task.status}")
        # the person who delegated it sees progress without asking
        if task.created_by_id and task.created_by_id != request.user.id \
                and task.created_by.is_active:
            who_upd = request.user.get_full_name() or request.user.username
            headline = (f"{task.progress_percent}% done"
                        if percent not in (None, "") else "status update")
            notify(task.created_by, "task_progress",
                   f"Progress on {task.code} ({headline}): {task.title}"[:200],
                   "\n".join([
                       f"Task: {task.code} - {task.title}",
                       f"Updated by: {who_upd}",
                       "",
                       "Update: " + " * ".join(updates),
                       f"Due: {timezone.localtime(task.due_at):%d %b %Y, %I:%M %p}"
                       if task.due_at else "Due: not set",
                       "",
                       "No action needed unless this looks off - open Tasks to reply.",
                   ]),
                   link=f"/tasks/{task.id}")
        return Response(TaskSerializer(task, context={"request": request}).data)

    @action(detail=False, methods=["get"])
    def time_report(self, request):
        """P3: per person over ?range= — Time Earned (assigned effort
        credited when the task completes) vs Time Spent (actual minutes the
        assignee reported). Employees see themselves; managers their
        department + reports; admin everyone."""
        user = request.user
        now = timezone.localtime()
        today = now.date()
        rng = request.query_params.get("range", "this_month")
        starts = {
            "today": today,
            "this_week": today - timedelta(days=today.weekday()),
            "this_month": today.replace(day=1),
            "this_year": today.replace(month=1, day=1),
            "all": None,
        }
        if rng not in starts:
            raise ValidationError({"range": f"Use one of: {', '.join(starts)}."})

        qs = Task.objects.filter(status=TaskStatus.DONE, deleted_at__isnull=True,
                                 completed_at__isnull=False)
        if starts[rng]:
            qs = qs.filter(completed_at__date__gte=starts[rng])
        if has_capability(user, "tasks.view_all"):
            pass
        elif has_capability(user, "tasks.view_department"):
            from django.db.models import Q as _Q
            qs = qs.filter(_Q(assigned_to__department=user.department)
                           | _Q(assigned_to__reporting_manager=user)
                           | _Q(assigned_to=user))
        else:
            qs = qs.filter(assigned_to=user)

        people = {}
        for assignee_id, name, username, effort, actual in qs.values_list(
                "assigned_to_id", "assigned_to__first_name",
                "assigned_to__username", "effort_minutes", "actual_minutes"):
            row = people.setdefault(assignee_id, {
                "user": assignee_id, "name": name or username,
                "done": 0, "time_earned_minutes": 0, "time_spent_minutes": 0,
                "no_effort_tasks": 0,
            })
            row["done"] += 1
            if effort:
                row["time_earned_minutes"] += effort
            else:
                row["no_effort_tasks"] += 1   # visible, so assigners learn
            row["time_spent_minutes"] += actual or 0
        rows = sorted(people.values(), key=lambda r: -r["time_earned_minutes"])
        return Response({"range": rng, "rows": rows})

    # D2 score weights (Sir's proposal, shown openly in the UI tooltip)
    SCORE_ON_TIME_WEIGHT = 60
    SCORE_EFFORT_WEIGHT = 40
    MULTITASK_PARALLEL = 3      # D4: a "multitask day" has >= this many active tasks

    def _report_bounds(self, p, now):
        """Presets from _range_bounds plus range=custom&start=&end= (D3)."""
        rng = p.get("range", "this_month")
        if rng == "custom":
            from datetime import date as _date
            try:
                start = _date.fromisoformat(p.get("start", ""))
                end = _date.fromisoformat(p.get("end", ""))
            except ValueError:
                raise ValidationError({"range": "Custom range needs start and end as YYYY-MM-DD."})
            if end < start:
                raise ValidationError({"range": "End date is before the start date."})
            return start, end
        return _range_bounds(rng, now)

    def _report_users(self, user, only_id=None):
        """People this viewer may see task data for: admin -> everyone,
        department viewer -> their department, and ANYONE -> their own direct
        reports (matching visible_tasks, so a lead with reports outside their
        department still sees that team). ?user= narrows to one of them."""
        from django.db.models import Q as _Q
        if has_capability(user, "tasks.view_all"):
            users = list(User.objects.filter(is_active=True))
        else:
            scope = _Q(pk=user.pk) | _Q(reporting_manager=user)
            if has_capability(user, "tasks.view_department"):
                scope |= _Q(department=user.department)
            users = list(User.objects.filter(is_active=True).filter(scope).distinct())
        if only_id:
            try:
                only_id = int(only_id)
            except (TypeError, ValueError):
                raise ValidationError({"user": "Pass a user id."})
            users = [u for u in users if u.pk == only_id]
            if not users:
                raise PermissionDenied("You cannot view this person's tasks.")
        return users

    @action(detail=False, methods=["get"])
    def people(self, request):
        """Who the "All Tasks" / Activities person-filter may list — the same
        set of people this viewer can already see tasks for."""
        users = sorted(self._report_users(request.user),
                       key=lambda u: (u.first_name or u.username).lower())
        return Response([{
            "id": u.pk,
            "name": u.get_full_name() or u.username,
            "username": u.username,
            "role": u.role,
            "role_display": u.get_role_display(),
            "department": u.department,
            "department_display": u.get_department_display(),
            "reports_to": u.reporting_manager_id,
        } for u in users])

    def _task_buckets(self, users, start, end):
        """The task rows every report starts from, bucketed per assignee and
        filtered to the range by the DUE-DATE anchor (falling back to created
        date). Also returns the ids of mistake-correction tasks, which are
        never scored -- the mistake penalty already covers them, and counting
        both would punish the same slip twice."""
        raw = Task.objects.filter(assigned_to__in=users, deleted_at__isnull=True) \
            .values("id", "assigned_to_id", "created_by_id", "status", "due_at",
                    "completed_at", "created_at", "effort_minutes", "actual_minutes",
                    "group__name")
        from .scoring import corrective_task_ids
        corrective = corrective_task_ids([t["id"] for t in raw])
        per = {u.pk: [] for u in users}
        for t in raw:
            anchor = timezone.localtime(t["due_at"] or t["created_at"]).date()
            if start and not (start <= anchor <= end):
                continue
            per[t["assigned_to_id"]].append(t)
        return per, corrective

    def _score_formula(self):
        """The score spelled out in words. The UI prints this verbatim -- the
        score is never a black box somebody has to take on trust."""
        from mistakes.analytics import MAX_EMPLOYEE_PENALTY
        return (f"Score = {self.SCORE_ON_TIME_WEIGHT} \u00d7 on-time rate + "
                f"{self.SCORE_EFFORT_WEIGHT} \u00d7 (time earned \u00f7 time assigned) "
                f"\u2212 mistake penalty (low 1 \u00b7 medium 3 \u00b7 high 6 \u00b7 critical 10, "
                f"repeats \u00d72, max {MAX_EMPLOYEE_PENALTY}). "
                f"Only tasks assigned BY SOMEONE ELSE are scored \u2014 a task "
                f"you create for yourself, or one raised to correct a "
                f"mistake, earns no points")

    def _person_rows(self, per, corrective, name_of, start, end, now, today,
                     always_emit=False):
        """One scored row per person, sorted best first. Shared by the
        Employees report and the Team dashboard so there is exactly one
        implementation of the score -- two copies would eventually disagree,
        and a score nobody can reproduce is worthless."""
        rows = []
        for uid, sub in per.items():
            if not sub:
                # Somebody with nothing in this range still gets a row when the
                # caller wants the whole team -- an idle employee is a finding,
                # not an absence, and silently dropping them hides it.
                if always_emit:
                    rows.append({"user": uid, "name": name_of[uid], "total": 0,
                                 "overdue": 0, "pending": 0, "in_progress": 0,
                                 "completed": 0, "in_time": 0, "delayed": 0,
                                 "self_assigned": 0, "scored_completed": 0,
                                 "scored_missed": 0,
                                 "time_assigned_minutes": 0, "time_earned_minutes": 0,
                                 "time_spent_minutes": 0, "on_time_rate": None,
                                 "effort_ratio": None, "score": None,
                                 "multitask_days": 0, "multitask_on_time": None,
                                 "review": "No tasks in this range."})
                continue
            c = Counter()
            assigned = earned = spent = 0
            # Scoring counts ONLY tasks somebody else handed you: a task you
            # created for yourself earns no points, so nobody can inflate a
            # score by self-assigning easy work.
            sc_assigned = sc_earned = sc_completed = sc_in_time = sc_missed = 0
            intervals = []
            for t in sub:
                # not scored: your own task, or one raised to correct a mistake
                own = t["created_by_id"] == uid or t["id"] in corrective
                if own:
                    c["self_assigned"] += 1
                if t["status"] != TaskStatus.DONE and t["due_at"] and t["due_at"] < now:
                    c["overdue"] += 1
                    if not own:
                        sc_missed += 1    # judged, not skipped, by the on-time rate
                if t["status"] == TaskStatus.OPEN:
                    c["pending"] += 1
                elif t["status"] == TaskStatus.IN_PROGRESS:
                    c["in_progress"] += 1
                else:
                    c["completed"] += 1
                    late = t["due_at"] and t["completed_at"] and t["completed_at"] > t["due_at"]
                    c["delayed" if late else "in_time"] += 1
                    earned += t["effort_minutes"] or 0
                    spent += t["actual_minutes"] or 0
                    if not own:
                        sc_completed += 1
                        sc_earned += t["effort_minutes"] or 0
                        if not late:
                            sc_in_time += 1
                assigned += t["effort_minutes"] or 0
                if not own:
                    sc_assigned += t["effort_minutes"] or 0
                s = timezone.localtime(t["created_at"]).date()
                e = timezone.localtime(t["completed_at"]).date() if t["completed_at"] else today
                intervals.append((s, e, t))

            # D4: multitask days — >= MULTITASK_PARALLEL tasks active the same day
            win_start = start or min(s for s, _, _ in intervals)
            win_end = min(end or today, today)
            n_days = min((win_end - win_start).days + 1, 92)   # capped sweep
            diff = [0] * (n_days + 1)
            for s, e, _ in intervals:
                lo = max((s - win_start).days, 0)
                hi = min((e - win_start).days, n_days - 1)
                if hi < 0 or lo >= n_days:
                    continue
                diff[lo] += 1
                diff[hi + 1] -= 1
            counts, running = [], 0
            for d in diff[:n_days]:
                running += d
                counts.append(running)
            mt_days = {win_start + timedelta(days=i)
                       for i, n in enumerate(counts) if n >= self.MULTITASK_PARALLEL}
            mt_done = mt_in_time = 0
            for _, _, t in intervals:
                if t["status"] == TaskStatus.DONE and t["completed_at"] \
                        and timezone.localtime(t["completed_at"]).date() in mt_days:
                    mt_done += 1
                    if not (t["due_at"] and t["completed_at"] > t["due_at"]):
                        mt_in_time += 1

            # Rates behind the score use the delegated tasks only — someone
            # with nothing but self-assigned work scores nothing at all.
            judged = sc_completed + sc_missed      # finished + still overdue
            on_time_rate = (sc_in_time / judged) if judged else None
            effort_ratio = min(1.0, sc_earned / sc_assigned) if sc_assigned else None
            score = None
            if on_time_rate is not None and effort_ratio is not None:
                score = round(self.SCORE_ON_TIME_WEIGHT * on_time_rate
                              + self.SCORE_EFFORT_WEIGHT * effort_ratio, 1)
            elif on_time_rate is not None:   # no effort values set anywhere
                score = round(100 * on_time_rate, 1)

            row = {
                "user": uid, "name": name_of[uid], "total": len(sub),
                **{k: c.get(k, 0) for k in ("overdue", "pending", "in_progress",
                                            "completed", "in_time", "delayed",
                                            "self_assigned")},
                "scored_completed": sc_completed,     # delegated + finished
                "scored_missed": sc_missed,           # delegated + still overdue
                "time_assigned_minutes": assigned,
                "time_earned_minutes": earned,
                "time_spent_minutes": spent,
                "on_time_rate": round(on_time_rate * 100, 1) if on_time_rate is not None else None,
                "effort_ratio": round(effort_ratio * 100, 1) if effort_ratio is not None else None,
                "score": score,
                "multitask_days": len(mt_days),
                "multitask_on_time": round(100 * mt_in_time / mt_done, 1) if mt_done else None,
            }
            row["review"] = review_sentence(row)   # E3: Sir's review categories
            rows.append(row)

        # M4: mistakes pull the score down — transparently
        from mistakes.analytics import MAX_EMPLOYEE_PENALTY, mistake_penalties
        pens = mistake_penalties([r["user"] for r in rows], start, end)
        for r in rows:
            pen = pens.get(r["user"], {"mistakes": 0, "repeats": 0, "penalty": 0, "action_rate": None})
            r["mistakes"] = pen["mistakes"]
            r["repeat_mistakes"] = pen["repeats"]
            r["mistake_penalty"] = pen["penalty"]
            r["mistake_action_rate"] = pen["action_rate"]
            r["task_score"] = r["score"]
            r["score"] = (round(max(0, r["score"] - pen["penalty"]), 1)
                          if r["score"] is not None else None)
        rows.sort(key=lambda r: (-(r["score"] or -1), r["name"]))
        return rows

    @action(detail=False, methods=["get"])
    def employees_report(self, request):
        """D2/D3/D4: per-person report over the range — counts, transparent
        score, time earned/assigned/spent, multitasker index. ?grain=daily
        returns the per-day view instead (completion-day crediting, D1)."""
        now = timezone.now()
        p = request.query_params
        start, end = self._report_bounds(p, now)
        users = self._report_users(request.user, only_id=p.get("user"))
        today = timezone.localtime(now).date()

        users_by_id = {u.pk: u for u in users}
        per, corrective = self._task_buckets(users, start, end)

        if p.get("grain") == "daily":
            # D1: effort credits land on the COMPLETION day, whole
            days = {}
            for sub in per.values():
                for t in sub:
                    if t["status"] != TaskStatus.DONE or not t["completed_at"]:
                        continue
                    d = timezone.localtime(t["completed_at"]).date()
                    row = days.setdefault(d, {"date": d, "completed": 0, "in_time": 0,
                                              "delayed": 0, "time_earned_minutes": 0,
                                              "time_spent_minutes": 0})
                    row["completed"] += 1
                    late = t["due_at"] and t["completed_at"] > t["due_at"]
                    row["delayed" if late else "in_time"] += 1
                    row["time_earned_minutes"] += t["effort_minutes"] or 0
                    row["time_spent_minutes"] += t["actual_minutes"] or 0
            return Response({"rows": sorted(days.values(), key=lambda r: r["date"], reverse=True)})

        def tally(subset):
            """The six numbers every report table shows, so Monthly, Groups
            and OverDue all read the same as the Employees table."""
            c = Counter()
            for t in subset:
                if t["status"] != TaskStatus.DONE and t["due_at"] and t["due_at"] < now:
                    c["overdue"] += 1
                if t["status"] == TaskStatus.OPEN:
                    c["pending"] += 1
                elif t["status"] == TaskStatus.IN_PROGRESS:
                    c["in_progress"] += 1
                else:
                    c["completed"] += 1
                    late = (t["due_at"] and t["completed_at"]
                            and t["completed_at"] > t["due_at"])
                    c["delayed" if late else "in_time"] += 1
            done = c.get("completed", 0)
            return {"total": len(subset),
                    **{k: c.get(k, 0) for k in ("overdue", "pending", "in_progress",
                                                "completed", "in_time", "delayed")},
                    "score": round(100 * c.get("in_time", 0) / done, 1) if done else None}

        if p.get("grain") == "monthly":
            months = {}
            for sub in per.values():
                for t in sub:
                    d = timezone.localtime(t["due_at"] or t["created_at"]).date()
                    months.setdefault(d.replace(day=1), []).append(t)
            return Response({"rows": [
                {"month": m.isoformat(), "label": m.strftime("%b %Y"), **tally(sub)}
                for m, sub in sorted(months.items(), reverse=True)]})

        if p.get("grain") == "group":
            groups = {}
            for sub in per.values():
                for t in sub:
                    groups.setdefault(t["group__name"] or "No group", []).append(t)
            return Response({"rows": [
                {"group": g, **tally(sub)}
                for g, sub in sorted(groups.items(), key=lambda kv: kv[0].lower())]})

        if p.get("grain") == "overdue":
            # Who is sitting on late work, and how long the OLDEST one has been
            # late -- "4 months ago" is what starts a conversation, not the count.
            rows = []
            for uid, sub in per.items():
                late = [t for t in sub if t["status"] != TaskStatus.DONE
                        and t["due_at"] and t["due_at"] < now]
                if not late:
                    continue
                oldest = min(t["due_at"] for t in late)
                who = users_by_id[uid]
                rows.append({"user": uid, "name": who.get_full_name() or who.username,
                             "oldest_due_at": oldest,
                             "days_overdue": (now - oldest).days, **tally(sub)})
            rows.sort(key=lambda r: -r["days_overdue"])
            return Response({"rows": rows})

        name_of = {u.pk: (u.get_full_name() or u.username) for u in users}
        rows = self._person_rows(per, corrective, name_of, start, end, now, today,
                                 always_emit=bool(p.get("user")))
        return Response({"rows": rows, "formula": self._score_formula()})

    # Team dashboard thresholds -- a row is flagged, never hidden or ranked
    # down by these: they exist to point the reader at a conversation.
    AT_RISK_SCORE = 45          # below this, something is wrong
    SLIDE_DELTA = -15           # dropped this much since the period before
    OVERDUE_FLAG = 3            # this many open tasks already past their date
    REWORK_FLAG = 2             # this many completions sent back

    @action(detail=False, methods=["post"],
            permission_classes=[HasCapability.of("tasks.view_all")])
    def send_overdue_email(self, request):
        """Send the Monday email right now to every active person: overdue
        tasks or "pipeline is clear", plus their performance. Safe to repeat:
        once per person per day."""
        from .reminders import send_weekly_overdue_email
        return Response({"sent": send_weekly_overdue_email(force=True)})

    @action(detail=False, methods=["get"],
            permission_classes=[HasCapability.of("tasks.view_all")])
    def team_report(self, request):
        """The founder's view: every employee scored over the range and
        ranked, using the SAME score the Employees report shows, plus the
        things a single number hides -- how much was done, pending, overdue,
        how long it took, how often work came back, how often deadlines were
        renegotiated, and what each person is carrying right now.

        Read-only: it writes nothing and creates nothing."""
        now = timezone.now()
        p = request.query_params
        start, end = self._report_bounds(p, now)
        users = self._report_users(request.user)
        today = timezone.localtime(now).date()
        name_of = {u.pk: (u.get_full_name() or u.username) for u in users}
        meta = {u.pk: (u.get_role_display(), u.get_department_display()) for u in users}
        ids = list(name_of)

        per, corrective = self._task_buckets(users, start, end)
        # always_emit: the founder sees every employee, including anyone who
        # has nothing in this range at all
        rows = self._person_rows(per, corrective, name_of, start, end, now, today,
                                 always_emit=True)

        # --- movement since the period immediately before -------------------
        # Same length, ending the day before this one starts. "All time" has
        # nothing before it, so those deltas stay null rather than pretending.
        prev_start = prev_end = None
        prev = {}
        if start and end:
            span = (end - start).days + 1
            prev_end = start - timedelta(days=1)
            prev_start = prev_end - timedelta(days=span - 1)
            p_per, p_corrective = self._task_buckets(users, prev_start, prev_end)
            prev = {r["user"]: r["score"] for r in self._person_rows(
                p_per, p_corrective, name_of, prev_start, prev_end, now, today)}

        # --- rework: completions the approver sent back ---------------------
        subs = TaskCompletion.objects.filter(submitted_by_id__in=ids)
        if start:
            subs = subs.filter(created_at__date__range=(start, end))
        rework = {}
        for uid, status in subs.values_list("submitted_by_id", "status"):
            b = rework.setdefault(uid, {"submitted": 0, "rejected": 0})
            b["submitted"] += 1
            if status == CompletionReviewStatus.REJECTED:
                b["rejected"] += 1

        # --- deadline pressure: what people asked to change -----------------
        crs = TaskChangeRequest.objects.filter(requested_by_id__in=ids)
        if start:
            crs = crs.filter(created_at__date__range=(start, end))
        pressure = {}
        for uid, changes in crs.values_list("requested_by_id", "changes"):
            b = pressure.setdefault(uid, {"extensions": 0, "cancels": 0})
            ch = changes or {}
            if ch.get("cancel"):
                b["cancels"] += 1
            elif "due_at" in ch:
                b["extensions"] += 1

        # --- what each person is carrying RIGHT NOW (not range-bound) -------
        load = {}
        for uid, due, eff in Task.objects.filter(
                assigned_to_id__in=ids, deleted_at__isnull=True
        ).exclude(status=TaskStatus.DONE).values_list(
                "assigned_to_id", "due_at", "effort_minutes"):
            b = load.setdefault(uid, {"open_tasks": 0, "open_overdue": 0,
                                      "pending_effort_minutes": 0})
            b["open_tasks"] += 1
            if due and due < now:
                b["open_overdue"] += 1
            b["pending_effort_minutes"] += eff or 0

        for r in rows:
            uid = r["user"]
            r["role"], r["department"] = meta.get(uid, ("", ""))
            before = prev.get(uid)
            r["score_prev"] = before
            r["score_delta"] = (round(r["score"] - before, 1)
                                if r["score"] is not None and before is not None
                                else None)
            rw = rework.get(uid, {"submitted": 0, "rejected": 0})
            r["rework_submitted"] = rw["submitted"]
            r["rework_rejected"] = rw["rejected"]
            r["rework_rate"] = (round(100 * rw["rejected"] / rw["submitted"], 1)
                                if rw["submitted"] else None)
            pr = pressure.get(uid, {"extensions": 0, "cancels": 0})
            r["extension_requests"] = pr["extensions"]
            r["cancel_requests"] = pr["cancels"]
            r.update(load.get(uid, {"open_tasks": 0, "open_overdue": 0,
                                    "pending_effort_minutes": 0}))

            # Flags are sentences, not codes -- whoever reads this should know
            # what to ask about without looking anything up.
            flags = []
            if r["score"] is None:
                flags.append("Nothing scored here \u2014 self-assigned work, or no "
                             "effort value was ever set")
            else:
                if r["score"] < self.AT_RISK_SCORE:
                    flags.append(f"Score {r['score']} is below {self.AT_RISK_SCORE}")
                if r["score_delta"] is not None and r["score_delta"] <= self.SLIDE_DELTA:
                    flags.append(f"Down {abs(r['score_delta'])} points since the "
                                 "period before")
            if r["open_overdue"] >= self.OVERDUE_FLAG:
                flags.append(f"{r['open_overdue']} tasks are past their date right now")
            if rw["rejected"] >= self.REWORK_FLAG:
                flags.append(f"{rw['rejected']} completions were sent back for redoing")
            r["flags"] = flags

        # --- the team as a whole --------------------------------------------
        def total(key):
            return sum(r.get(key) or 0 for r in rows)

        scored = [r["score"] for r in rows if r["score"] is not None]
        prev_scored = [v for v in prev.values() if v is not None]
        team_score = round(sum(scored) / len(scored), 1) if scored else None
        team_prev = (round(sum(prev_scored) / len(prev_scored), 1)
                     if prev_scored else None)
        completed = total("completed")
        team = {
            "people": len(rows),
            "scored_people": len(scored),
            "team_score": team_score,
            "team_score_prev": team_prev,
            "team_score_delta": (round(team_score - team_prev, 1)
                                 if team_score is not None and team_prev is not None
                                 else None),
            "completed": completed,
            "in_time": total("in_time"),
            "delayed": total("delayed"),
            "pending": total("pending"),
            "in_progress": total("in_progress"),
            "overdue": total("overdue"),
            "total": total("total"),
            # Of everything finished in this range, how much landed on time.
            "on_time_rate": (round(100 * total("in_time") / completed, 1)
                             if completed else None),
            "time_assigned_minutes": total("time_assigned_minutes"),
            "time_earned_minutes": total("time_earned_minutes"),
            "time_spent_minutes": total("time_spent_minutes"),
            "open_tasks": total("open_tasks"),
            "open_overdue": total("open_overdue"),
            "mistakes": total("mistakes"),
            "rework_rejected": total("rework_rejected"),
            "at_risk": sum(1 for r in rows if r["flags"]),
        }
        return Response({
            "range": {"start": start, "end": end},
            "previous": {"start": prev_start, "end": prev_end},
            "team": team,
            "rows": rows,
            "formula": self._score_formula(),
        })

    AGE_BUCKETS = ((1, 3, "1-3 days"), (4, 7, "4-7 days"),
                   (8, 30, "8-30 days"), (31, None, "30+ days"))
    QUIET_DAYS = 3              # open work and nothing logged for this long

    @action(detail=False, methods=["get"])
    def home(self, request):
        """Everything the dashboard shows beyond the plain counts, in one call.

          me    -> the viewer's own score for the range (the SAME number the
                   Team Performance page gives them) and the period before,
                   plus their open mistakes
          team  -> only for someone with a team: overdue work by person and
                   by age, the top three for the range, and who needs a look

        ?range=this_week|this_month|last_month|custom(&start=&end=) moves the
        scores; ?department= narrows the team part. Overdue work is always as
        of right now -- a deadline already missed does not belong to a range.
        Read-only."""
        from mistakes.models import Mistake, MistakeStatus
        now = timezone.now()
        today = timezone.localtime(now).date()
        p = request.query_params
        if not p.get("range"):
            p = p.copy()
            p["range"] = "this_month"
        start, end = self._report_bounds(p, now)
        me = request.user

        def rows_for(users, s, e):
            per, corrective = self._task_buckets(users, s, e)
            names = {u.pk: (u.get_full_name() or u.username) for u in users}
            return {r["user"]: r for r in self._person_rows(
                per, corrective, names, s, e, now, today, always_emit=True)}

        prev_start = prev_end = None
        if start and end:
            span = (end - start).days + 1
            prev_end = start - timedelta(days=1)
            prev_start = prev_end - timedelta(days=span - 1)

        mine = rows_for([me], start, end).get(me.pk, {})
        mine_prev = rows_for([me], prev_start, prev_end).get(me.pk, {}) if prev_start else {}
        score, before = mine.get("score"), mine_prev.get("score")
        open_mistakes = (Mistake.objects.filter(employee=me)
                         .exclude(status=MistakeStatus.RESOLVED)
                         .order_by("sla_due_at", "-id"))
        out = {
            "range": {"start": start, "end": end},
            "previous": {"start": prev_start, "end": prev_end},
            "me": {
                "score": score,
                "score_prev": before,
                "score_delta": (round(score - before, 1)
                                if score is not None and before is not None else None),
                "on_time_rate": mine.get("on_time_rate"),
                "completed": mine.get("completed", 0),
                "in_time": mine.get("in_time", 0),
                "delayed": mine.get("delayed", 0),
                "mistakes_open": open_mistakes.count(),
                "mistakes": [
                    {"id": m.id, "category": m.category, "severity": m.severity,
                     "severity_display": m.get_severity_display(),
                     "status": m.status, "status_display": m.get_status_display(),
                     "description": m.description[:140], "sla_due_at": m.sla_due_at,
                     "is_overdue": m.sla_overdue, "code": m.code, "created_at": m.created_at}
                    for m in open_mistakes[:5]
                ],
            },
            "team": None,
        }

        users = self._report_users(me)
        if len(users) <= 1:
            return Response(out)               # nobody but me: no team block
        departments = sorted({u.department for u in users if u.department})
        if p.get("department"):
            wanted = set(p["department"].split(","))
            users = [u for u in users if u.department in wanted]
        ids = [u.pk for u in users]
        name_of = {u.pk: (u.get_full_name() or u.username) for u in users}
        role_of = {u.pk: u.get_role_display() for u in users}

        # --- overdue right now: by person and by how late -------------------
        by_person, ages = {}, [0] * len(self.AGE_BUCKETS)
        open_by_person = Counter()
        for uid, due in Task.objects.filter(
                assigned_to_id__in=ids, deleted_at__isnull=True
        ).exclude(status=TaskStatus.DONE).values_list("assigned_to_id", "due_at"):
            open_by_person[uid] += 1
            if not due or due >= now:
                continue
            by_person[uid] = by_person.get(uid, 0) + 1
            late = max(1, (today - timezone.localtime(due).date()).days)
            for i, (lo, hi, _) in enumerate(self.AGE_BUCKETS):
                if late >= lo and (hi is None or late <= hi):
                    ages[i] += 1
                    break
        overdue_people = sorted(
            ({"id": uid, "name": name_of[uid], "role": role_of[uid], "overdue": n,
              "open": open_by_person[uid]} for uid, n in by_person.items()),
            key=lambda r: (-r["overdue"], r["name"]))

        # --- best of the range, and who needs a look ------------------------
        rows = rows_for(users, start, end)
        prev = rows_for(users, prev_start, prev_end) if prev_start else {}
        scored = [r for r in rows.values() if r.get("score") is not None]
        scored.sort(key=lambda r: (-r["score"], -(r.get("completed") or 0)))
        top = [{"id": r["user"], "name": r["name"], "role": role_of[r["user"]],
                "score": r["score"], "on_time_rate": r.get("on_time_rate"),
                "completed": r.get("completed", 0),
                "score_delta": (round(r["score"] - prev[r["user"]]["score"], 1)
                                if prev.get(r["user"], {}).get("score") is not None else None)}
               for r in scored[:3]]

        last_seen = dict(TaskActivity.objects.filter(actor_id__in=ids)
                         .values("actor_id").annotate(last=models_Max("created_at"))
                         .values_list("actor_id", "last"))
        quiet_before = now - timedelta(days=self.QUIET_DAYS)
        attention = []
        for uid in ids:
            why = []
            seen = last_seen.get(uid)
            if open_by_person[uid] and (seen is None or seen < quiet_before):
                days = (now - seen).days if seen else None
                why.append(f"No task activity for {days} days" if days
                           else "No task activity yet")
            if by_person.get(uid, 0) >= self.OVERDUE_FLAG:
                why.append(f"{by_person[uid]} tasks past their date")
            sc = rows.get(uid, {}).get("score")
            if sc is not None and sc < self.AT_RISK_SCORE:
                why.append(f"Score {sc}, below {self.AT_RISK_SCORE}")
            if why:
                attention.append({"id": uid, "name": name_of[uid], "role": role_of[uid],
                                  "reasons": why, "open": open_by_person[uid],
                                  "overdue": by_person.get(uid, 0), "last_activity": seen})
        attention.sort(key=lambda r: (-len(r["reasons"]), -r["overdue"], r["name"]))

        out["team"] = {
            "people": len(ids),
            "departments": departments,
            "open": sum(open_by_person.values()),
            "overdue": sum(by_person.values()),
            "overdue_by_person": overdue_people,
            "ageing": [{"label": label, "count": ages[i]}
                       for i, (_, _, label) in enumerate(self.AGE_BUCKETS)],
            "top": top,
            "attention": attention,
        }
        return Response(out)

    @action(detail=False, methods=["get"])
    def delegation(self, request):
        """How many tasks each person GAVE to someone else and RECEIVED from
        someone else, counted by the day the task was given: the chosen day
        (?date=YYYY-MM-DD, default today), that day's week (Mon-Sun), its
        month, and overall. Self-assigned work is counted apart. Automatic
        repeats of a recurring task and tasks made by a web form are not
        anyone "giving" work, so they are left out. Plain counts, no labels.

        Admins and super admins get everyone (?department= narrows it);
        everybody else gets only their own row. Read-only."""
        from datetime import date as _date
        p = request.query_params
        try:
            day = _date.fromisoformat(p["date"]) if p.get("date") else timezone.localdate()
        except ValueError:
            raise ValidationError({"date": "Use YYYY-MM-DD."})
        week_start = day - timedelta(days=day.weekday())
        week_end = week_start + timedelta(days=6)
        month_start = day.replace(day=1)
        month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)

        me = request.user
        is_admin = is_top_admin(me.role)
        if is_admin:
            users = list(User.objects.filter(is_active=True))
            if p.get("department"):
                wanted = set(p["department"].split(","))
                users = [u for u in users if u.department in wanted]
        else:
            users = [me]
        ids = {u.pk for u in users}

        repeats = set(TaskActivity.objects.filter(text__startswith="Auto-created next")
                      .values_list("task_id", flat=True))
        rows = (Task.objects.filter(deleted_at__isnull=True, created_by__isnull=False)
                .filter(Q(created_by_id__in=ids) | Q(assigned_to_id__in=ids))
                .exclude(description__startswith="Auto-created from form")
                .values_list("id", "created_by_id", "assigned_to_id", "created_at"))

        def blank():
            return {"day": 0, "week": 0, "month": 0, "all": 0}
        given = {i: blank() for i in ids}
        received = {i: blank() for i in ids}
        self_made = {i: blank() for i in ids}
        pairs = {}                      # (giver, receiver) -> count this month

        def bump(bucket, d):
            bucket["all"] += 1
            if month_start <= d <= month_end:
                bucket["month"] += 1
            if week_start <= d <= week_end:
                bucket["week"] += 1
            if d == day:
                bucket["day"] += 1

        for tid, giver, taker, created in rows:
            if tid in repeats:
                continue
            d = timezone.localtime(created).date()
            if giver == taker:
                if giver in ids:
                    bump(self_made[giver], d)
                continue
            if giver in ids:
                bump(given[giver], d)
            if taker in ids:
                bump(received[taker], d)
            if is_admin and month_start <= d <= month_end and giver in ids and taker in ids:
                pairs[(giver, taker)] = pairs.get((giver, taker), 0) + 1

        name_of = {u.pk: (u.get_full_name() or u.username) for u in users}
        people = [{"id": u.pk, "name": name_of[u.pk], "role": u.get_role_display(),
                   "department": u.get_department_display(),
                   "given": given[u.pk], "received": received[u.pk], "self": self_made[u.pk]}
                  for u in users]
        people.sort(key=lambda r: (-r["given"]["month"], -r["given"]["all"], r["name"]))
        total = lambda k, w: sum(r[k][w] for r in people)   # noqa: E731
        return Response({
            "date": day, "week": [week_start, week_end], "month": [month_start, month_end],
            "everyone": is_admin,
            "totals": {w: {"given": total("given", w), "self": total("self", w)}
                       for w in ("day", "week", "month", "all")},
            "people": people,
            "pairs": [{"from": name_of[a], "to": name_of[b], "count": n}
                      for (a, b), n in sorted(pairs.items(), key=lambda kv: -kv[1])[:8]],
        })

    @action(detail=False, methods=["get"], url_path="delegation/person")
    def delegation_person(self, request):
        """One person's give/receive breakdown: WHO they gave tasks to and
        WHO gave tasks to them, with counts for the day (?date=), its week,
        its month and overall -- the same counting rules as delegation().
        ?user=<id>; admins may ask about anyone, everyone else only about
        themselves. Read-only."""
        from datetime import date as _date
        p = request.query_params
        try:
            day = _date.fromisoformat(p["date"]) if p.get("date") else timezone.localdate()
        except ValueError:
            raise ValidationError({"date": "Use YYYY-MM-DD."})
        me = request.user
        try:
            uid = int(p.get("user") or me.pk)
        except ValueError:
            raise ValidationError({"user": "Pass a user id."})
        if uid != me.pk and not is_top_admin(me.role):
            raise PermissionDenied("You can only see your own breakdown.")
        person = User.objects.filter(pk=uid).first()
        if not person:
            raise NotFound("No such person.")
        week_start = day - timedelta(days=day.weekday())
        week_end = week_start + timedelta(days=6)
        month_start = day.replace(day=1)
        month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)

        repeats = set(TaskActivity.objects.filter(text__startswith="Auto-created next")
                      .values_list("task_id", flat=True))
        rows = (Task.objects.filter(deleted_at__isnull=True, created_by__isnull=False)
                .filter(Q(created_by_id=uid) | Q(assigned_to_id=uid))
                .exclude(created_by_id=F("assigned_to_id"))
                .exclude(description__startswith="Auto-created from form")
                .values_list("id", "created_by_id", "assigned_to_id", "created_at"))
        gave_to, got_from = {}, {}
        for tid, giver, taker, created in rows:
            if tid in repeats:
                continue
            d = timezone.localtime(created).date()
            other, book = (taker, gave_to) if giver == uid else (giver, got_from)
            b = book.setdefault(other, {"day": 0, "week": 0, "month": 0, "all": 0})
            b["all"] += 1
            if month_start <= d <= month_end:
                b["month"] += 1
            if week_start <= d <= week_end:
                b["week"] += 1
            if d == day:
                b["day"] += 1

        names = {u.pk: (u.get_full_name() or u.username, u.get_role_display(), u.is_active)
                 for u in User.objects.filter(pk__in=set(gave_to) | set(got_from))}

        def listing(book):
            out = [{"id": k, "name": names.get(k, ("(removed)", "", False))[0],
                    "role": names.get(k, ("", "", False))[1],
                    "active": names.get(k, ("", "", False))[2], **v} for k, v in book.items()]
            return sorted(out, key=lambda r: (-r["all"], r["name"]))
        return Response({
            "person": {"id": person.pk, "name": person.get_full_name() or person.username,
                       "role": person.get_role_display()},
            "date": day, "week": [week_start, week_end], "month": [month_start, month_end],
            "gave_to": listing(gave_to),
            "received_from": listing(got_from),
        })

    @action(detail=False, methods=["get"])
    def delegated_summary(self, request):
        """Everyone I have given tasks to, with what is still OPEN (and how
        much of that is overdue) and what was COMPLETED ON TIME vs LATE.
        Same rows as the Delegated tab: created by me, assigned to someone
        else, not deleted. Read-only."""
        me = request.user
        now = timezone.now()
        per = {}
        for uid, status, due, done_at in (
                Task.objects.filter(created_by=me, deleted_at__isnull=True)
                .exclude(assigned_to=me)
                .values_list("assigned_to_id", "status", "due_at", "completed_at")):
            b = per.setdefault(uid, {"open": 0, "overdue": 0, "done_on_time": 0,
                                     "done_late": 0, "total": 0})
            b["total"] += 1
            if status != TaskStatus.DONE:
                b["open"] += 1
                if due and due < now:
                    b["overdue"] += 1
            elif due and done_at and done_at > due:
                b["done_late"] += 1
            else:
                b["done_on_time"] += 1
        users = {u.pk: u for u in User.objects.filter(pk__in=per)}
        rows = [{"id": uid, "name": users[uid].get_full_name() or users[uid].username,
                 "role": users[uid].get_role_display(), "active": users[uid].is_active, **b}
                for uid, b in per.items() if uid in users]
        rows.sort(key=lambda r: (-r["open"], -r["total"], r["name"]))
        totals = {k: sum(r[k] for r in rows)
                  for k in ("open", "overdue", "done_on_time", "done_late", "total")}
        return Response({"agents": rows, "totals": totals})

    @action(detail=False, methods=["get"])
    def effort_disputes(self, request):
        """D5: tasks where the assignee's estimate diverged from the
        assigner's effort value — review-meeting ammunition."""
        from django.db.models import F
        now = timezone.now()
        p = request.query_params
        start, end = self._report_bounds(p, now)
        users = self._report_users(request.user)
        qs = (Task.objects.filter(assigned_to__in=users, deleted_at__isnull=True,
                                  effort_minutes__isnull=False,
                                  assignee_estimate_minutes__isnull=False)
              .exclude(effort_minutes=F("assignee_estimate_minutes"))
              .select_related("assigned_to", "created_by"))
        rows = []
        for t in qs:
            anchor = timezone.localtime(t.due_at or t.created_at).date()
            if start and not (start <= anchor <= end):
                continue
            rows.append({
                "id": t.id, "code": t.code, "title": t.title,
                "assignee": t.assigned_to.get_full_name() or t.assigned_to.username,
                "assigner": (t.created_by.get_full_name() or t.created_by.username)
                if t.created_by else "—",
                "effort_minutes": t.effort_minutes,
                "estimate_minutes": t.assignee_estimate_minutes,
                "actual_minutes": t.actual_minutes,
                "status": t.status,
            })
        rows.sort(key=lambda r: -abs(r["estimate_minutes"] - r["effort_minutes"]) / r["effort_minutes"])
        return Response({"rows": rows})

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """B3: complete WITH evidence (remarks and/or a proof file), used when
        Task Settings demand it. Plain status PATCH still works when nothing
        is required."""
        task = self.get_object()
        if task.assigned_to_id != request.user.id and not has_capability(request.user, "tasks.view_all"):
            raise PermissionDenied("Only the assignee can complete this task.")
        if task.status == TaskStatus.DONE:
            raise ValidationError({"detail": "This task is already completed."})
        remarks = str(request.data.get("remarks", "")).strip()
        # proof can be several files -- one photo rarely proves a whole job
        proof = request.FILES.getlist("file")[:self.MAX_PROOF_FILES]
        for f in proof:
            if f.size > self.MAX_UPLOAD_BYTES:
                raise ValidationError(
                    {"file": f"{f.name} is larger than 10 MB — compress it or share a link."})
        self._enforce_completion_evidence(task, remarks=remarks, has_new_file=bool(proof))
        # P2: the actual TOTAL effort spent is mandatory at completion --
        # it powers the Time Spent report next to Time Earned.
        try:
            actual = int(request.data.get("actual_minutes"))
            if not 1 <= actual <= 60 * 24 * 90:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError({
                "actual_minutes": "Enter the total effort actually spent (in minutes).",
                "needs": "actual_minutes"})

        for f in proof:
            TaskAttachment.objects.create(task=task, file=f, filename=f.name[:255],
                                          uploaded_by=request.user)
        old_status = task.status
        task.status = TaskStatus.DONE
        task.completion_note = remarks[:500]
        task.actual_minutes = actual
        task.progress_percent = 100
        task.save(update_fields=["status", "completion_note", "actual_minutes", "progress_percent"])
        assigned_view = f"{task.effort_minutes}m" if task.effort_minutes else "not set"
        act(task, request.user,
            f"Completed — took {actual}m (assigned: {assigned_view}): {remarks[:180]}")
        for f in proof:
            act(task, request.user, f"Completion proof attached: {f.name[:120]}")
        self._after_status_change(task, request.user, old_status, task.assigned_to)
        self._raise_completion_review(task, request.user, remarks)
        return Response(TaskSerializer(task, context={"request": request}).data)

    def _raise_completion_review(self, task, submitter, note):
        """Ask the giver to accept the work. The task is already done -- an
        assignee must not be marked late because their manager was slow."""
        reviewer = _completion_reviewer(task, submitter)
        if not reviewer:
            return                       # own task: nobody to ask
        c = TaskCompletion.objects.create(
            task=task, submitted_by=submitter, approver=reviewer, note=note[:2000])
        notify(
            reviewer, "task_completion_review",
            f"Accept or send back: {task.code} {task.title}"[:200],
            _completion_body(c),
            # both decisions straight from the email: Accept lands on the
            # task with the review open, Send back opens the reason box
            link=f"/tasks/{task.id}?review=accept",
            link_label="Accept",
            extra_links=[(f"/tasks/{task.id}?review=reject", "Send back")],
            # WhatsApp reminder for non-admin reviewers only; admins work
            # through Tasks -> To accept and would be pinged all day
            want_whatsapp=not is_top_admin(reviewer.role),
            wa_template=("task_completion_review", [
                reviewer.get_full_name() or reviewer.username,
                task.code,
                task.title[:60],
                (submitter.get_full_name() or submitter.username),
            ]),
        )

    @action(detail=True, methods=["get", "post"])
    def request_change(self, request, pk=None):
        """B2: raise a Modification Request. GET lists this task's requests."""
        task = self.get_object()
        if request.method == "GET":
            return Response(TaskChangeRequestSerializer(
                task.change_requests.select_related("requested_by", "reviewed_by", "task"),
                many=True).data)
        if has_capability(request.user, "tasks.view_all"):
            # An admin normally edits directly, so a request would be a
            # pointless detour -- EXCEPT where the rules put something out of
            # their reach. Deleting work assigned to an admin is the one such
            # case today: they cannot do it, so they must be able to ask.
            wants_cancel = bool((request.data or {}).get("changes", {}).get("cancel"))
            blocked = wants_cancel and not can_delete_task(request.user, task)
            if not blocked:
                raise ValidationError({
                    "detail": "You're an admin — edit the task directly, no request needed."})
        if request.user.id not in (task.assigned_to_id, task.created_by_id):
            raise PermissionDenied("Only the assignee or the creator can request changes to this task.")
        if task.deleted_at:
            raise ValidationError({"detail": "This task is deleted."})
        ser = TaskChangeRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        req = ser.save(task=task, requested_by=request.user)
        approver_side = "the task creator" if request.user.id != task.created_by_id else "an admin"
        # the activity feed gets the same friendly labels, not raw field names
        fields = ", ".join(TaskChangeRequest.FIELD_LABELS.get(f, f).lower()
                           for f in req.changes)
        act(task, request.user, f"Change requested ({fields}) — awaiting {approver_side}")
        for approver in _approvers_for(req):
            wa = _change_request_wa(req, approver)
            notify(approver, "task_change_request",
                   f"Change request on {task.code}: {task.title}"[:200],
                   _change_request_body(req, approver),
                   link=f"/tasks/{task.id}",
                   wa_template=wa, want_whatsapp=wa is not None)
        return Response(TaskChangeRequestSerializer(req).data, status=http.HTTP_201_CREATED)

    MAX_UPLOAD_BYTES = 10 * 1024 * 1024
    MAX_PROOF_FILES = 5

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request, pk=None):
        """Attach a reference file to a task -- the invoice or photo the
        assignee needs in order to DO the work. (Completion proof goes up the
        same way through /complete/.)"""
        task = self.get_object()
        if not self._can_touch_detail(request.user, task):
            raise PermissionDenied(
                "Only the assignee, the person who gave the task, or an admin "
                "can add files here.")
        if task.deleted_at:
            raise ValidationError({"detail": "This task is deleted."})
        uploaded = request.FILES.getlist("file") or (
            [request.FILES["files"]] if "files" in request.FILES else [])
        if not uploaded:
            raise ValidationError({"file": "Pick a file to attach."})
        for f in uploaded[:5]:
            if f.size > self.MAX_UPLOAD_BYTES:
                raise ValidationError(
                    {"file": f"{f.name} is larger than 10 MB — compress it or share a link."})
        for f in uploaded[:5]:
            TaskAttachment.objects.create(task=task, file=f, filename=f.name[:255],
                                          uploaded_by=request.user)
            act(task, request.user, f"Attached: {f.name[:120]}")
        return Response(TaskAttachmentSerializer(
            task.attachments.select_related("uploaded_by"), many=True).data,
            status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def files(self, request, pk=None):
        task = self.get_object()
        return Response(TaskAttachmentSerializer(
            task.attachments.select_related("uploaded_by"), many=True).data)

    @action(detail=True, methods=["post"])
    def subscribe(self, request, pk=None):
        task = self.get_object()
        task.subscribers.add(request.user)
        return Response({"subscribed": True})

    @action(detail=True, methods=["post"])
    def unsubscribe(self, request, pk=None):
        task = self.get_object()
        task.subscribers.remove(request.user)
        return Response({"subscribed": False})

    @action(detail=False, methods=["get"])
    def categories(self, request):
        cats = (visible_tasks(request.user).exclude(category="")
                .values_list("category", flat=True).distinct())
        return Response(sorted(set(cats), key=str.lower))

    @action(detail=False, methods=["get"])
    def dashboard(self, request):
        """Task dashboard tiles + per-category table.
        Params: range (today|yesterday|this_week|...|all), scope (my|delegated|group),
        category, search. The range applies to a task's due date (falling back
        to its creation date when it has no due date)."""
        user = request.user
        now = timezone.now()
        p = request.query_params
        scope = p.get("scope", "my")

        qs = visible_tasks(user)
        if scope == "my":
            qs = qs.filter(assigned_to=user)
        elif scope == "delegated":
            qs = qs.filter(created_by=user).exclude(assigned_to=user)
        elif scope == "group":
            if not (has_capability(user, "tasks.view_all") or has_capability(user, "tasks.view_department")):
                raise PermissionDenied("Your role has no group report.")
        if p.get("category"):
            qs = qs.filter(category__iexact=p["category"])
        if p.get("search"):
            qs = qs.filter(title__icontains=p["search"])

        start, end = self._report_bounds(p, now) if p.get("range") == "custom" \
            else _range_bounds(p.get("range", "this_week"), now)
        rows = []
        for t in qs.values("category", "status", "due_at", "completed_at", "created_at"):
            anchor = timezone.localtime(t["due_at"] or t["created_at"]).date()
            if start and not (start <= anchor <= end):
                continue
            rows.append(t)

        def tally(subset):
            c = Counter()
            for t in subset:
                overdue = t["status"] != TaskStatus.DONE and t["due_at"] and t["due_at"] < now
                if overdue:
                    c["overdue"] += 1
                if t["status"] == TaskStatus.OPEN:
                    c["pending"] += 1
                elif t["status"] == TaskStatus.IN_PROGRESS:
                    c["in_progress"] += 1
                else:
                    c["completed"] += 1
                    if t["due_at"] and t["completed_at"] and t["completed_at"] > t["due_at"]:
                        c["delayed"] += 1
                    else:
                        c["in_time"] += 1
            return {k: c.get(k, 0) for k in
                    ("overdue", "pending", "in_progress", "completed", "in_time", "delayed")}

        by_category = {}
        for t in rows:
            by_category.setdefault(t["category"] or "Uncategorised", []).append(t)
        categories = [
            {"category": cat, "total": len(sub), **tally(sub)}
            for cat, sub in sorted(by_category.items(), key=lambda kv: kv[0].lower())
        ]
        # Say which dates were actually counted. "This week" often straddles
        # two months (a Monday in August, a Thursday in September), so a task
        # can sit in This Week and not in This Month -- correct, and baffling
        # until you can see the dates.
        return Response({
            "tiles": {**tally(rows), "total": len(rows)},
            "categories": categories,
            "range_from": start.isoformat() if start else None,
            "range_to": end.isoformat() if end else None,
        })


def _in_background(fn):
    """Run fn after the response, on its own thread. Tests patch this to run
    inline -- a thread cannot see a TestCase's uncommitted rows."""
    import threading

    def run():
        from django.db import connection
        try:
            fn()
        except Exception:  # noqa: BLE001 -- a failed ping must not crash the worker
            import logging
            logging.getLogger(__name__).exception("background notify failed")
        finally:
            connection.close()
    threading.Thread(target=run, daemon=True, name="bulk-accept-notify").start()


def _notify_bulk_accepted(reviewer_id, remarks, by_submitter):
    """ONE notification per person for a bulk accept -- not an email and a
    WhatsApp for every task, which for 30 tasks is spam and, sent inline,
    longer than the request may take."""
    reviewer = User.objects.get(pk=reviewer_id)
    who = reviewer.get_full_name() or reviewer.username
    for submitter_id, tasks in by_submitter.items():
        submitter = User.objects.filter(pk=submitter_id).first()
        if not submitter:
            continue
        if len(tasks) == 1:
            code, title, task_id = tasks[0]
            notify(submitter, "task_completion_accepted",
                   f"Accepted: {code} {title}"[:200],
                   NL_JOIN([f"{who} accepted your work on {code}.", remarks]).strip(),
                   link=f"/tasks/{task_id}")
            continue
        lines = [f"{who} accepted your work on {len(tasks)} tasks:", ""]
        lines += [f"• {code} - {title[:80]}" for code, title, _ in tasks]
        if remarks:
            lines += ["", remarks]
        notify(submitter, "task_completion_accepted",
               f"Accepted: {len(tasks)} of your tasks", NL_JOIN(lines),
               link="/tasks", link_label="Open my tasks")


class TaskCompletionViewSet(viewsets.ReadOnlyModelViewSet):
    """Work submitted as done, waiting for the giver to accept it.

      ?scope=inbox  -> waiting for ME to review (default)
      ?scope=mine   -> completions I submitted
      ?status=      -> pending | approved | rejected

    POST /{id}/review {decision: approved|rejected, remarks}
    Rejecting REOPENS the task: it was never actually finished.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = TaskCompletionSerializer

    def get_queryset(self):
        user = self.request.user
        qs = TaskCompletion.objects.select_related(
            "task", "task__assigned_to", "submitted_by", "approver", "reviewed_by"
        ).prefetch_related("task__attachments__uploaded_by")
        scope = self.request.query_params.get("scope", "inbox")
        if scope == "mine":
            qs = qs.filter(submitted_by=user)
        elif scope == "all":
            if not has_capability(user, "tasks.view_all"):
                raise PermissionDenied("Only an admin can see every completion.")
        else:
            qs = qs.filter(approver=user)
        if self.request.query_params.get("task"):
            qs = qs.filter(task_id=self.request.query_params["task"])
        state = self.request.query_params.get("status")
        if state:
            qs = qs.filter(status=state)
        elif scope not in ("mine", "all"):
            qs = qs.filter(status=CompletionReviewStatus.PENDING)
        return qs

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        # deliberately not get_object(): the inbox queryset hides anything
        # already decided, and "not found" is a poor answer to a second click
        # on the same email link. Look it up, then say plainly what happened.
        c = TaskCompletion.objects.filter(pk=pk).select_related("task", "submitted_by").first()
        if not c:
            raise NotFound("That review no longer exists.")
        if c.approver_id != request.user.id and not has_capability(request.user, "tasks.view_all"):
            raise PermissionDenied("This is not yours to decide.")
        if c.status != CompletionReviewStatus.PENDING:
            raise ValidationError({"detail": f"Already {c.get_status_display().lower()}."})

        decision = str(request.data.get("decision", "")).strip()
        if decision not in (CompletionReviewStatus.APPROVED, CompletionReviewStatus.REJECTED):
            raise ValidationError({"decision": "Send approved or rejected."})
        remarks = str(request.data.get("remarks", "")).strip()
        if decision == CompletionReviewStatus.REJECTED and len(remarks) < 10:
            # "redo it" with no reason wastes the next attempt too
            raise ValidationError(
                {"remarks": "Say what is wrong — they have to know what to fix."})

        task = c.task
        c.status = decision
        c.remarks = remarks[:500]
        c.reviewed_by = request.user
        c.reviewed_at = timezone.now()
        c.save(update_fields=["status", "remarks", "reviewed_by", "reviewed_at"])

        who = request.user.get_full_name() or request.user.username
        if decision == CompletionReviewStatus.APPROVED:
            act(task, request.user, f"Completion accepted by {who}"
                                    + (f": {remarks[:180]}" if remarks else ""))
            notify(c.submitted_by, "task_completion_accepted",
                   f"Accepted: {task.code} {task.title}"[:200],
                   NL_JOIN([f"{who} accepted your work on {task.code}.",
                            remarks or ""]).strip(),
                   link=f"/tasks/{task.id}")
        else:
            # it was never actually finished, so put it back
            task.status = TaskStatus.OPEN
            task.completed_at = None
            task.progress_percent = 0
            task.save(update_fields=["status", "completed_at", "progress_percent"])
            act(task, request.user, f"Completion sent back by {who}: {remarks[:180]}")
            notify(c.submitted_by, "task_completion_rejected",
                   f"Sent back: {task.code} {task.title}"[:200],
                   NL_JOIN([f"{who} sent your work back on {task.code}.",
                            "",
                            f"Reason: {remarks}",
                            "",
                            "The task is open again — fix it and complete it."]),
                   link=f"/tasks/{task.id}",
                   link_label="Open the task")
        return Response(TaskCompletionSerializer(c).data)

    BULK_ACCEPT_MAX = 500

    @action(detail=False, methods=["post"])
    def bulk_accept(self, request):
        """POST {ids: [...], remarks?} -- accept many at once from "To accept".

        Takes the exact ids the screen is showing, never "everything", so work
        submitted after the page loaded is not accepted unseen. Only reviews
        still pending in the caller's OWN inbox are touched; anything already
        decided, or someone else's, is skipped and counted, never an error --
        a second tab clicking the same button is harmless.
        """
        ids = request.data.get("ids")
        if (not isinstance(ids, list) or not ids
                or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids)):
            raise ValidationError({"ids": "Send the list of reviews to accept."})
        ids = set(ids)
        if len(ids) > self.BULK_ACCEPT_MAX:
            raise ValidationError(
                {"ids": f"At most {self.BULK_ACCEPT_MAX} at a time."})
        remarks = str(request.data.get("remarks", "")).strip()[:500]

        from django.db import transaction
        user, now = request.user, timezone.now()
        who = user.get_full_name() or user.username
        by_submitter = {}
        with transaction.atomic():
            rows = (TaskCompletion.objects
                    .filter(pk__in=ids, approver=user, status=CompletionReviewStatus.PENDING)
                    .select_related("task").order_by("created_at"))
            for c in rows:
                # conditional: if anything decided it a moment ago, leave it be
                if not TaskCompletion.objects.filter(
                        pk=c.pk, status=CompletionReviewStatus.PENDING).update(
                        status=CompletionReviewStatus.APPROVED, remarks=remarks,
                        reviewed_by=user, reviewed_at=now):
                    continue
                act(c.task, user, f"Completion accepted by {who}"
                                  + (f": {remarks[:180]}" if remarks else ""))
                by_submitter.setdefault(c.submitted_by_id, []).append(
                    (c.task.code, c.task.title, c.task_id))
        accepted = sum(len(t) for t in by_submitter.values())
        if by_submitter:
            _in_background(lambda: _notify_bulk_accepted(user.pk, remarks, by_submitter))
        return Response({"accepted": accepted, "skipped": len(ids) - accepted})


class TaskChangeRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """Modification Requests. Scopes:
      ?scope=inbox  -> requests waiting for ME to approve (default)
      ?scope=mine   -> requests I raised
      ?scope=all    -> everything (admin only)
    POST /{id}/review {decision: approved|rejected, remarks} applies it."""
    permission_classes = [IsAuthenticated]
    serializer_class = TaskChangeRequestSerializer

    def get_queryset(self):
        user = self.request.user
        qs = TaskChangeRequest.objects.select_related(
            "task", "task__assigned_to", "task__created_by", "requested_by", "reviewed_by")
        scope = self.request.query_params.get("scope", "inbox")
        if scope == "mine":
            qs = qs.filter(requested_by=user)
        elif scope == "all":
            if not has_capability(user, "tasks.view_all"):
                raise PermissionDenied("Only an admin can see all change requests.")
        else:  # inbox — only what THIS person is actually meant to decide
            creator_raised = Q(requested_by=F("task__created_by"))
            # a task I gave out, someone else is asking to change it
            i_gave_it = Q(task__created_by=user)
            # my own report asking to change a task they created themselves
            from_my_report = Q(requested_by__reporting_manager=user) & creator_raised
            if has_capability(user, "tasks.delete_admin_work"):
                # a super admin is the only one who can carry out a cancel on
                # work assigned to an admin, so those land here whoever asked
                admin_roles = [r for r, lvl in ROLE_LEVEL.items() if lvl >= 3]
                cancels_on_admin_work = (Q(changes__cancel=True)
                                         & Q(task__assigned_to__role__in=admin_roles))
                qs = qs.filter(i_gave_it | from_my_report | Q(escalated=True)
                               | cancels_on_admin_work)
            elif has_capability(user, "tasks.view_all"):
                # admins are the LAST resort, not the default inbox: only
                # escalations and people with no manager on file land here
                no_manager = (Q(requested_by__reporting_manager__isnull=True)
                              | Q(requested_by__reporting_manager__is_active=False))
                qs = qs.filter(i_gave_it | from_my_report | Q(escalated=True)
                               | (creator_raised & no_manager))
            else:
                qs = qs.filter(i_gave_it | from_my_report).filter(escalated=False)
            qs = qs.exclude(requested_by=user).filter(status=ChangeRequestStatus.PENDING)
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        req = TaskChangeRequest.objects.select_related("task", "requested_by").filter(pk=pk).first()
        if not req:
            raise ValidationError({"detail": "Unknown request."})
        if not can_review_request(request.user, req):
            raise PermissionDenied(
                "You cannot review this request"
                + (" — never your own." if req.requested_by_id == request.user.id else "."))
        if req.status != ChangeRequestStatus.PENDING:
            raise ValidationError({"detail": "This request has already been reviewed."})
        decision = request.data.get("decision")
        if decision not in ("approved", "rejected", "escalated"):
            raise ValidationError({"decision": "Use 'approved', 'rejected' or 'escalated'."})

        # B9: the creator can hand the decision up to admin instead of deciding
        if decision == "escalated":
            if has_capability(request.user, "tasks.view_all"):
                raise ValidationError({"decision": "You're the final approver — approve or reject."})
            req.escalated = True
            req.remarks = str(request.data.get("remarks", ""))[:300]
            req.save(update_fields=["escalated", "remarks"])
            act(req.task, request.user,
                f"Change request escalated to admin by {request.user.get_full_name() or request.user.username}")
            for admin in _admins().exclude(pk=req.requested_by_id):
                notify(admin, "task_change_request",
                       f"Escalated to you - change request on {req.task.code}: {req.task.title}"[:200],
                       _change_request_body(req, admin)
                       + f"\nEscalated by: {request.user.get_full_name() or request.user.username}"
                       + (f"\nTheir remarks: {req.remarks}" if req.remarks else ""),
                       link=f"/tasks/{req.task.id}")
            notify(req.requested_by, "task_change_reviewed",
                   f"Sent to admin - your change request on {req.task.code}: {req.task.title}"[:200],
                   "\n".join([
                       f"Task: {req.task.code} - {req.task.title}",
                       f"Passed up by: {request.user.get_full_name() or request.user.username}",
                       "", "You asked to change:",
                   ] + [f"  - {line}" for line in req.describe()]
                     + ([f"\nTheir remarks: {req.remarks}"] if req.remarks else [])
                     + ["", "An admin will decide this now - nothing to do until then."]),
                   link=f"/tasks/{req.task.id}")
            return Response(TaskChangeRequestSerializer(req).data)

        req.status = decision
        req.reviewed_by = request.user
        req.remarks = str(request.data.get("remarks", ""))[:300]
        req.reviewed_at = timezone.now()
        req.save()

        task = req.task
        if decision == "approved":
            applied = self._apply(task, req.changes, request.user)
            act(task, request.user,
                f"Change request approved ({', '.join(applied)}) — requested by "
                f"{req.requested_by.get_full_name() or req.requested_by.username}")
        else:
            act(task, request.user, "Change request rejected"
                + (f": {req.remarks}" if req.remarks else ""))

        verdict = "approved" if decision == "approved" else "rejected"
        notify(req.requested_by, "task_change_reviewed",
               f"Change request {verdict} - {task.code}: {task.title}"[:200],
               "\n".join([
                   f"Task: {task.code} - {task.title}",
                   f"Reviewed by: {request.user.get_full_name() or request.user.username}",
                   "",
                   ("These changes are now live on the task:" if decision == "approved"
                    else "These changes were NOT applied - the task is unchanged:"),
               ] + [f"  - {line}" for line in req.describe()]
                 + ([f"\nRemarks: {req.remarks}"] if req.remarks else [])
                 + ["", ("Nothing to do - carry on with the task."
                         if decision == "approved"
                         else "Talk to the reviewer if you still need this change.")]),
               link=f"/tasks/{task.id}")
        # keep Admin in the loop on creator-approved requests too
        if not has_capability(request.user, "tasks.view_all"):
            for admin in _admins().exclude(pk__in=[request.user.pk, req.requested_by_id]):
                notify(admin, "task_change_log",
                       f"FYI - {task.code} changed via request ({verdict}): {task.title}"[:200],
                       "\n".join([
                           f"Task: {task.code} - {task.title}",
                           f"Assigned to: {task.assigned_to.get_full_name() or task.assigned_to.username}"
                           if task.assigned_to else "Assigned to: -",
                           f"Requested by: {req.requested_by.get_full_name() or req.requested_by.username}",
                           f"{verdict.title()} by: {request.user.get_full_name() or request.user.username}",
                           "", "Changes:",
                       ] + [f"  - {line}" for line in req.describe()]
                         + ["", "Log only - no action needed."]),
                       link=f"/tasks/{task.id}")
        return Response(TaskChangeRequestSerializer(req).data)

    def _apply(self, task, changes, actor):
        """Apply an approved request's changes to the task, safely."""
        from datetime import datetime
        applied = []
        if changes.get("cancel"):
            # the same rule as the direct delete: approving a cancel must not
            # become a way around it
            if not can_delete_task(actor, task):
                raise PermissionDenied(delete_refusal(actor, task))
            task.deleted_at = timezone.now()
            task.save(update_fields=["deleted_at"])
            return ["cancelled (moved to Deleted Tasks)"]
        for field in ("title", "description", "category", "priority", "frequency"):
            if field in changes and changes[field] is not None:
                setattr(task, field, str(changes[field])[:200 if field == "title" else 2000])
                applied.append(field)
        if "effort_minutes" in changes:
            value = changes["effort_minutes"]
            task.effort_minutes = int(value) if value is not None else None
            applied.append("effort_minutes")
        if "due_at" in changes:
            value = changes["due_at"]
            if value:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                if timezone.is_naive(parsed):
                    parsed = timezone.make_aware(parsed)
                task.due_at = parsed
                # a moved deadline deserves a fresh reminder
                task.reminded_at = None
            else:
                task.due_at = None
            applied.append("due_at")
        if "repeat_until" in changes:
            value = changes["repeat_until"]
            task.repeat_until = (datetime.fromisoformat(str(value)).date() if value else None)
            applied.append("repeat_until")
        if "assigned_to" in changes:
            target = User.objects.filter(pk=changes["assigned_to"], is_active=True).first()
            if target:
                task.assigned_to = target
                applied.append(f"assigned_to -> {target.username}")
                _notify_task_assigned(task, actor)
        task.save()
        return applied


class TaskCategoryViewSet(viewsets.ModelViewSet):
    """Managed categories: everyone reads (filtered by ?department=),
    managers/admin create and deactivate."""
    serializer_class = None  # set below via get_serializer_class
    pagination_class = None

    def get_serializer_class(self):
        from .serializers import TaskCategorySerializer
        return TaskCategorySerializer

    def get_permissions(self):
        # NOTE: this override replaces the @action permission_classes, so the
        # approve/reject actions must be listed here explicitly.
        if getattr(self, "action", None) in ("approve", "reject"):
            return [HasCapability.of("tasks.assign")()]
        # POST is otherwise open to everyone: managers/admin add outright, an
        # employee's POST becomes a request instead (handled in create()).
        if self.request.method in ("GET", "HEAD", "OPTIONS", "POST"):
            return [IsAuthenticated()]
        return [HasCapability.of("tasks.assign")()]

    def get_queryset(self):
        from django.db.models import Q as _Q
        if self.request.query_params.get("pending") == "true":
            if not has_capability(self.request.user, "tasks.assign"):
                return TaskCategory.objects.none()
            return TaskCategory.objects.filter(pending=True).select_related("requested_by")
        qs = TaskCategory.objects.filter(active=True, pending=False)
        department = self.request.query_params.get("department")
        if department is not None:
            qs = qs.filter(_Q(department="") | _Q(department=department))
        return qs

    @action(detail=True, methods=["post"],
            permission_classes=[HasCapability.of("tasks.assign")])
    def approve(self, request, pk=None):
        """Turn an employee's request into a real category."""
        cat = TaskCategory.objects.filter(pk=pk, pending=True).first()
        if not cat:
            raise ValidationError({"detail": "No pending request with that id."})
        cat.pending, cat.active = False, True
        cat.created_by = request.user
        cat.save(update_fields=["pending", "active", "created_by"])
        if cat.requested_by and cat.requested_by.is_active:
            notify(cat.requested_by, "category_request",
                   f"Category approved: {cat.name}"[:200],
                   NL_JOIN([
                       f"Category: {cat.name}",
                       f"Approved by: {request.user.get_full_name() or request.user.username}",
                       "",
                       "It is now in the category dropdown — you can pick it on any task.",
                   ]), link="/tasks")
        return Response(self.get_serializer(cat).data)

    @action(detail=True, methods=["post"],
            permission_classes=[HasCapability.of("tasks.assign")])
    def reject(self, request, pk=None):
        cat = TaskCategory.objects.filter(pk=pk, pending=True).first()
        if not cat:
            raise ValidationError({"detail": "No pending request with that id."})
        name, asker = cat.name, cat.requested_by
        remarks = str(request.data.get("remarks", "")).strip()
        cat.delete()
        if asker and asker.is_active:
            notify(asker, "category_request",
                   f"Category not added: {name}"[:200],
                   NL_JOIN([
                       f"Category: {name}",
                       f"Reviewed by: {request.user.get_full_name() or request.user.username}",
                       "",
                       "This was not added to the list."
                   ] + ([f"Reason: {remarks}"] if remarks else [])
                     + ["", "Pick the closest existing category, or ask your manager."]),
                   link="/tasks")
        return Response({"detail": "Request rejected."})

    def list(self, request, *args, **kwargs):
        """F1: ?counts=true adds live task counts per category (admin list)."""
        res = super().list(request, *args, **kwargs)
        if request.query_params.get("counts") == "true":
            counts = Counter(c.lower() for c in Task.objects
                             .filter(deleted_at__isnull=True).exclude(category="")
                             .values_list("category", flat=True))
            for row in res.data:
                row["task_count"] = counts.get(row["name"].lower(), 0)
        return res

    def create(self, request, *args, **kwargs):
        # re-adding a deactivated category reactivates it instead of
        # tripping the (department, name) unique constraint
        name = (request.data.get("name") or "").strip()
        department = request.data.get("department") or ""
        existing = TaskCategory.objects.filter(
            name__iexact=name, department=department).first()
        if existing and not existing.active:
            if not has_capability(request.user, "tasks.assign"):
                # an employee cannot silently revive a category a manager hid
                if existing.pending:
                    raise ValidationError(
                        {"name": "This category has already been requested — "
                                 "your manager still has to approve it."})
                raise ValidationError(
                    {"name": "That category was removed. Ask your manager to bring it back."})
            existing.active, existing.pending = True, False
            existing.save(update_fields=["active", "pending"])
            return Response(self.get_serializer(existing).data, status=http.HTTP_201_CREATED)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Managers and admin add straight away; anyone else raises a request
        that lands in Settings for a manager to approve."""
        user = self.request.user
        if has_capability(user, "tasks.assign"):
            serializer.save(created_by=user, active=True, pending=False)
            return
        cat = serializer.save(requested_by=user, active=False, pending=True)
        for approver in _category_approvers(user):
            notify(approver, "category_request",
                   f"Category requested by {user.get_full_name() or user.username}: {cat.name}"[:200],
                   NL_JOIN([
                       f"Requested category: {cat.name}",
                       f"For department: {cat.get_department_display() or 'All departments'}",
                       f"Asked by: {user.get_full_name() or user.username}",
                       "",
                       "They could not find a category that fits their task.",
                       "Approve or reject it in Settings -> Task categories.",
                   ]), link="/settings", link_label="Review the request")

    def perform_destroy(self, instance):
        instance.active = False              # never lose reporting history
        instance.pending = False
        instance.save(update_fields=["active", "pending"])


class TaskSettingsView(viewsets.ViewSet):
    """GET: anyone (the UI needs to know if evidence is required).
    PUT: admin only."""
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(TaskSettingsSerializer(TaskSettings.get()).data)

    def create(self, request):   # POST /api/task-settings/
        if not has_capability(request.user, "settings.manage"):
            raise PermissionDenied("Only an admin can change task policies.")
        cfg = TaskSettings.get()
        ser = TaskSettingsSerializer(cfg, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        return Response(ser.data)


class TaskTemplateViewSet(viewsets.ModelViewSet):
    """Templates: everyone reads/uses, only assigners (admin/managers) manage."""
    serializer_class = TaskTemplateSerializer
    queryset = TaskTemplate.objects.select_related("created_by").all()
    pagination_class = None

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        return [HasCapability.of("tasks.assign")()]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class TaskActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """The Activities feed, scoped to tasks the user can see."""
    permission_classes = [IsAuthenticated]
    serializer_class = TaskActivitySerializer

    def get_queryset(self):
        qs = TaskActivity.objects.select_related("actor", "task", "task__assigned_to").filter(
            task__in=visible_tasks(self.request.user))
        p = self.request.query_params
        if p.get("actor"):
            qs = qs.filter(actor_id=p["actor"])
        if p.get("assigned_to"):
            # whose TASK the activity belongs to (vs. who performed it)
            qs = qs.filter(task__assigned_to_id=p["assigned_to"])
        if p.get("department"):
            qs = qs.filter(task__assigned_to__department=p["department"])
        if p.get("task"):
            qs = qs.filter(task_id=p["task"])
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if p.get("search"):
            from django.db.models import Q as _Q
            term = p["search"].strip()
            clause = _Q(text__icontains=term) | _Q(task__title__icontains=term)
            digits = term.lstrip("Tt-").lstrip("0")   # T-00042 -> task pk
            if digits.isdigit():
                clause |= _Q(task_id=int(digits))
            qs = qs.filter(clause)
        if p.get("days"):
            try:
                qs = qs.filter(created_at__gte=timezone.now() - timedelta(days=int(p["days"])))
            except ValueError:
                pass
        return qs


    @action(detail=False, methods=["get"])
    def counts(self, request):
        """Who has been active, and how much — the chips above the feed.
        Uses exactly the same filters as the list, so the numbers always
        match what the feed below is showing."""
        rows = (self.filter_queryset(self.get_queryset())
                .values("actor_id", "actor__first_name", "actor__last_name",
                        "actor__username")
                .annotate(n=Count("id")).order_by("-n")[:25])
        return Response([{
            "user": r["actor_id"],
            "name": (f"{r['actor__first_name'] or ''} {r['actor__last_name'] or ''}".strip()
                     or r["actor__username"] or "System"),
            "count": r["n"],
        } for r in rows if r["actor_id"]])


class HolidayViewSet(viewsets.ModelViewSet):
    """Company holiday calendar: everyone reads, admin manages."""
    serializer_class = HolidaySerializer
    queryset = Holiday.objects.all()
    pagination_class = None

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        return [HasCapability.of("settings.manage")()]
