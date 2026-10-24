"""Sub-tasks and the Task chain (ported from the original app, 1dabd35; PLAN.md §19.41).

Whoever holds a task can give parts of it to other people ("sub-tasks").
They can give parts of THEIR part on, up to MAX_DEPTH levels, so one job
becomes a tree:  A -> B (main task) -> C, D (parts) -> E (part of C's part).

Rules kept here so every path (create, complete, cancel, due change,
reports) asks the same place:
  * a part is due no later than the task it comes from, and its effort is
    carved OUT of that task: the holder keeps only what they did not give
    away ("own effort"), so the same work is never earned twice;
  * a task cannot be completed while any of its parts is open or still
    waiting for its giver to accept it;
  * cancelling / deleting a task cancels its open parts too.
Here (not in the original): passing on a part of a task someone else gave you needs no Assign permission, splitting
a task you made yourself does (TaskViewSet._may_pass_part_on). Notifications link to the task (PLAN.md §19.37);
their types fall under "tasks" in notifications/categories.py.
"""
from django.db.models import Sum
from django.utils import timezone

from notifications.service import notify

from .models import CompletionReviewStatus, Task, TaskStatus

MAX_DEPTH = 5           # main task = level 0; parts may go 5 levels below it


def _name(u):
    return (u.get_full_name() or u.username) if u else ""


def alive_parts(task):
    return task.subtasks.filter(deleted_at__isnull=True)


def depth_of(task):
    """0 for a main task, 1 for its part, 2 for a part of a part ..."""
    d, cur = 0, task
    while cur.parent_id and d <= MAX_DEPTH + 1:
        cur = Task.objects.only("id", "parent_id").get(pk=cur.parent_id)
        d += 1
    return d


def root_of(task):
    cur = task
    for _ in range(MAX_DEPTH + 2):
        if not cur.parent_id:
            return cur
        cur = Task.objects.select_related("assigned_to", "created_by").get(pk=cur.parent_id)
    return cur


def given_effort(task):
    """Effort already handed to parts (alive ones)."""
    return alive_parts(task).aggregate(s=Sum("effort_minutes"))["s"] or 0


def own_effort_map(task_ids):
    """{task id: effort the holder keeps} for tasks that have parts. Tasks
    without parts are not in the map -- their effort is all theirs."""
    ids = list(task_ids)
    if not ids:
        return {}
    given = dict(Task.objects.filter(parent_id__in=ids, deleted_at__isnull=True)
                 .values("parent_id").annotate(s=Sum("effort_minutes"))
                 .values_list("parent_id", "s"))
    if not given:
        return {}
    effort = dict(Task.objects.filter(pk__in=given).values_list("id", "effort_minutes"))
    return {tid: max(0, (effort.get(tid) or 0) - (s or 0)) for tid, s in given.items()}


def own_effort(task):
    return max(0, (task.effort_minutes or 0) - given_effort(task)) \
        if task.effort_minutes is not None else None


def _latest_review(task):
    return task.completions.order_by("-created_at").first()


def blocking_parts(task):
    """(open parts, parts done but not yet accepted) -- either blocks the
    task from being completed."""
    open_, waiting = [], []
    for p in alive_parts(task).select_related("assigned_to"):
        if p.status != TaskStatus.DONE:
            open_.append(p)
            continue
        r = _latest_review(p)
        if r and r.status == CompletionReviewStatus.PENDING:
            waiting.append(p)
    return open_, waiting


def completion_block_message(task):
    """None when the task may be completed, else a sentence saying why."""
    open_, waiting = blocking_parts(task)
    if not open_ and not waiting:
        return None
    bits = []
    if open_:
        bits.append(f"{len(open_)} sub-task{'' if len(open_) == 1 else 's'} still open: "
                    + ", ".join(f"{p.code} ({_name(p.assigned_to)})" for p in open_[:4])
                    + ("…" if len(open_) > 4 else ""))
    if waiting:
        bits.append(f"{len(waiting)} done but waiting for you to accept: "
                    + ", ".join(f"{p.code} ({_name(p.assigned_to)})" for p in waiting[:4])
                    + ("…" if len(waiting) > 4 else ""))
    return "This task can't be completed yet — " + "; ".join(bits) + "."


def descendants(task, alive_only=True):
    """Every part below this task, breadth first."""
    out, frontier = [], [task.pk]
    for _ in range(MAX_DEPTH + 1):
        qs = Task.objects.filter(parent_id__in=frontier).select_related("assigned_to")
        if alive_only:
            qs = qs.filter(deleted_at__isnull=True)
        level = list(qs)
        if not level:
            break
        out += level
        frontier = [t.pk for t in level]
    return out


def cancel_open_parts(task, actor, act):
    """The task above was cancelled / deleted: its unfinished parts go with
    it (to the Deleted bin, restorable), and their people are told."""
    when = task.deleted_at or timezone.now()
    gone = [p for p in descendants(task) if p.status != TaskStatus.DONE]
    for p in gone:
        p.deleted_at = when
        p.save(update_fields=["deleted_at"])
        act(p, actor, f"Cancelled because {task.code} it was part of was cancelled")
        notify(p.assigned_to, "task_cancelled",
               f"Cancelled: {p.code} {p.title}"[:200],
               f"{p.code} was a sub-task of {task.code} {task.title}, which was "
               f"cancelled by {_name(actor)}. Nothing more to do on it.",
               link=f"/tasks/{p.id}", want_whatsapp=False)
    return gone


def restore_parts(task, deleted_at, actor, act):
    """Undo cancel_open_parts: parts removed at the same moment come back."""
    back = [p for p in descendants(task, alive_only=False) if p.deleted_at == deleted_at]
    for p in back:
        p.deleted_at = None
        p.save(update_fields=["deleted_at"])
        act(p, actor, f"Restored together with {task.code}")
    return back


def flag_late_parts(task, actor, act):
    """The task's due date moved earlier: any open part now due AFTER it is
    flagged to the person who gave that part. Nothing is moved silently."""
    if not task.due_at:
        return []
    late = [p for p in alive_parts(task).select_related("assigned_to", "created_by")
            if p.status != TaskStatus.DONE and p.due_at and p.due_at > task.due_at]
    for p in late:
        act(p, actor, f"Now due after {task.code} ({timezone.localtime(task.due_at):%d %b %I:%M %p})")
        giver = p.created_by or task.assigned_to
        if giver:
            notify(giver, "subtask_due_after_parent",
                   f"Check the date: {p.code} is due after {task.code}"[:200],
                   f"{task.code} {task.title} is now due "
                   f"{timezone.localtime(task.due_at):%d %b %Y, %I:%M %p}, but the sub-task "
                   f"{p.code} you gave {_name(p.assigned_to)} is due "
                   f"{timezone.localtime(p.due_at):%d %b %Y, %I:%M %p}. "
                   "Ask them to finish earlier (Request change on it).",
                   link=f"/tasks/{p.id}", want_whatsapp=False)
    return late


def notify_if_all_parts_done(part):
    """A part was accepted: if that was the last one, tell the holder of
    the task above that they can complete it now."""
    if not part.parent_id:
        return
    parent = Task.objects.select_related("assigned_to").get(pk=part.parent_id)
    if parent.deleted_at or parent.status == TaskStatus.DONE:
        return
    if completion_block_message(parent) is None:
        n = alive_parts(parent).count()
        notify(parent.assigned_to, "subtasks_all_done",
               f"All sub-tasks done: {parent.code} {parent.title}"[:200],
               f"All {n} sub-task{'' if n == 1 else 's'} of {parent.code} are finished "
               "and accepted. You can complete the task now.",
               link=f"/tasks/{parent.id}", want_whatsapp=False)


# ---- the tree ------------------------------------------------------------
def node(t, now, review=None):
    from .person_export import task_result
    result, days_late = task_result(t, now)
    return {
        "id": t.id, "code": t.code, "title": t.title,
        "assigned_to": t.assigned_to_id, "assignee": _name(t.assigned_to),
        "given_by": _name(t.created_by),
        "status": t.status, "status_display": t.get_status_display(),
        "result": result, "days_late": days_late,
        "due_at": t.due_at, "completed_at": t.completed_at,
        "effort_minutes": t.effort_minutes, "actual_minutes": t.actual_minutes,
        "approval": review.get_status_display() if review else None,
        "deleted": bool(t.deleted_at),
    }


def tree(root, now=None):
    """The whole chain under `root`, nested, for the admin view."""
    now = now or timezone.now()
    everyone = [root] + descendants(root)
    ids = [t.pk for t in everyone]
    full = {t.pk: t for t in Task.objects.filter(pk__in=ids)
            .select_related("assigned_to", "created_by")}
    reviews = {}
    from .models import TaskCompletion
    for c in TaskCompletion.objects.filter(task_id__in=ids).order_by("created_at"):
        reviews[c.task_id] = c
    own = own_effort_map(ids)
    kids = {}
    for t in full.values():
        if t.parent_id in full and t.pk != root.pk:
            kids.setdefault(t.parent_id, []).append(t)

    def build(t, level):
        n = node(t, now, reviews.get(t.pk))
        n["level"] = level
        n["own_effort_minutes"] = own.get(t.pk, t.effort_minutes)
        n["parts"] = [build(k, level + 1)
                      for k in sorted(kids.get(t.pk, []), key=lambda k: (k.due_at or now, k.pk))]
        return n
    return build(full[root.pk], 0)


def summarize(root_tree):
    """Counts over every part of a tree (not the main task itself)."""
    s = {"parts": 0, "done": 0, "overdue": 0, "on_time": 0, "delayed": 0,
         "people": set(), "levels": 0}

    def walk(n):
        for p in n["parts"]:
            s["parts"] += 1
            s["people"].add(p["assigned_to"])
            s["levels"] = max(s["levels"], p["level"])
            if p["status"] == TaskStatus.DONE:
                s["done"] += 1
            if p["result"] == "Overdue":
                s["overdue"] += 1
            elif p["result"] == "On time":
                s["on_time"] += 1
            elif p["result"] == "Delayed":
                s["delayed"] += 1
            walk(p)
    walk(root_tree)
    s["people"].add(root_tree["assigned_to"])
    s["people"] = len(s["people"])
    return s
