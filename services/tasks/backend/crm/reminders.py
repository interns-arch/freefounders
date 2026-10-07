"""Follow-up reminders: every open lead whose follow_up_at has passed gets
ONE notification per follow-up (reminded_at tracks the last ping, so a
rescheduled follow-up triggers again, but the same one never repeats).
Called by the in-process ticker (notifications.apps) and by
`manage.py send_reminders` for cron/manual use.

Also home to the attachment-retention sweep: files on finished tasks are
kept TASK_ATTACHMENT_RETENTION_DAYS (default 7) after completion, then
deleted from disk and DB (reviewer's storage rule, 19 Aug demo).
"""
import os

from django.db.models import F, Q
from django.utils import timezone

from notifications.service import notify, notify_follow_up_due

from .models import Lead, OPEN_STATUSES, Task, TaskAttachment, TaskStatus


def purge_expired_attachments() -> int:
    """Delete attachments on tasks completed more than the retention window
    ago. Only DONE tasks with a completed_at qualify — open/deleted-but-open
    tasks keep their files."""
    days = int(os.environ.get("TASK_ATTACHMENT_RETENTION_DAYS", "7"))
    if days <= 0:  # 0 or negative disables the sweep entirely
        return 0
    cutoff = timezone.now() - timezone.timedelta(days=days)
    expired = TaskAttachment.objects.filter(
        task__status=TaskStatus.DONE,
        task__completed_at__isnull=False,
        task__completed_at__lt=cutoff,
    )
    removed = 0
    for att in expired:
        if att.file:
            att.file.delete(save=False)  # remove from storage first
        att.delete()
        removed += 1
    return removed


REMIND_EVERY_HOURS = 2      # WhatsApp automation C: re-ping while overdue


def send_task_reminders() -> int:
    """Due/overdue tasks ping the assignee — and KEEP pinging every
    REMIND_EVERY_HOURS until the task is done (or the due date moves)."""
    now = timezone.now()
    again_before = now - timezone.timedelta(hours=REMIND_EVERY_HOURS)
    due = (
        Task.objects.exclude(status=TaskStatus.DONE)
        .filter(deleted_at__isnull=True, due_at__isnull=False, due_at__lte=now)
        .filter(Q(reminded_at__isnull=True) | Q(reminded_at__lte=again_before))
        .select_related("assigned_to", "lead")
    )
    sent = 0
    for task in due:
        hours_over = int((now - task.due_at).total_seconds() // 3600)
        state = f"OVERDUE by {hours_over}h" if hours_over >= 1 else "due now"
        wa_template = None
        if hours_over >= 1:  # the approved template reads "OVERDUE by {{3}}"
            wa_template = ("task_overdue_reminde", [
                task.assigned_to.get_full_name() or task.assigned_to.username,
                f"{task.code} · {task.title}",
                f"{hours_over}h",
            ])
        notify(
            task.assigned_to, "task_due",
            (f"Overdue by {hours_over}h" if hours_over >= 1 else "Due now")
            + f" - {task.code}: {task.title}"[:200],
            "\n".join([
                f"Task: {task.code} - {task.title}",
                f"Status: {state} (due {timezone.localtime(task.due_at):%d %b %Y, %I:%M %p})",
                f"Assigned by: {task.created_by.get_full_name() or task.created_by.username}"
                if task.created_by else "Assigned by: -",
            ] + ([task.description[:300]] if task.description else [])
              + ([f"Lead: {task.lead.customer_name}"] if task.lead else [])
              + ["", "Finish it, or open Tasks to post a status update."]),
            link="/tasks",
            wa_template=wa_template,
        )
        task.reminded_at = now
        task.save(update_fields=["reminded_at"])
        sent += 1
    return sent


def is_working_day(day) -> bool:
    """Is anyone expected to be at work on this date?

    Reads the same settings attendance does -- HR_WEEK_OFF_DAYS and the
    Holiday calendar -- so the week-off is configured once, not twice.
    """
    from hr.services import is_holiday, is_week_off
    return not is_week_off(day) and not is_holiday(day)


def delegated_snapshot(user, now, since=None):
    """What happened to the work THIS person handed out.

    Counts only tasks they gave to somebody else -- their own tasks are the
    other half of the message and must not be counted twice.
    """
    rows = (Task.objects.filter(created_by=user, deleted_at__isnull=True)
            .exclude(assigned_to=user)
            .select_related("assigned_to"))
    open_rows = [t for t in rows if t.status != TaskStatus.DONE]
    overdue = sorted((t for t in open_rows if t.due_at and t.due_at < now),
                     key=lambda t: t.due_at)
    done_since = [t for t in rows
                  if t.status == TaskStatus.DONE and t.completed_at
                  and (since is None or timezone.localtime(t.completed_at).date() >= since)]
    return {"open": open_rows, "overdue": overdue, "done": done_since}


def delegated_lines(snap, closed_label):
    """The section as it appears in the message, or nothing at all when this
    person gave no work out -- an empty heading is noise."""
    if not snap["open"] and not snap["done"]:
        return []
    lines = ["", "--- Work you gave others ---",
             f"{closed_label}: {len(snap['done'])}",
             f"Still open: {len(snap['open'])} "
             f"(of which {len(snap['overdue'])} overdue)"]
    for t in snap["overdue"][:3]:
        who = t.assigned_to.get_full_name() or t.assigned_to.username
        lines.append(f"  ! {t.code} {t.title[:44]} - {who}")
    return lines


def send_daily_task_digest(force=False) -> int:
    """One morning message per person: due today / overdue / open counts
    with the top tasks — 'aaj ka plan' in a single ping, never spam."""
    now = timezone.localtime()
    if not force and now.hour < 9:
        return 0
    today = now.date()
    # nothing is due on a day off, so a "your tasks today" ping is only noise
    if not force and not is_working_day(today):
        return 0
    from notifications.models import Notification

    open_tasks = (Task.objects.exclude(status=TaskStatus.DONE)
                  .filter(deleted_at__isnull=True)
                  .select_related("assigned_to").order_by("due_at"))
    per = {}
    for t in open_tasks:
        per.setdefault(t.assigned_to, []).append(t)

    sent = 0
    for user, tasks in per.items():
        if not user.is_active:
            continue
        if Notification.objects.filter(user=user, type="task_daily",
                                       created_at__date=today).exists():
            continue    # once a day, no matter how often the ticker runs
        overdue = [t for t in tasks if t.due_at and t.due_at < now]
        due_today = [t for t in tasks if t.due_at
                     and timezone.localtime(t.due_at).date() == today
                     and t.due_at >= now]
        lines = [f"⚠ {t.code} {t.title[:60]}" for t in overdue[:4]]
        lines += [f"• {t.code} {t.title[:60]} ({timezone.localtime(t.due_at):%H:%M})"
                  for t in due_today[:4]]
        # the other half of the morning: what you are waiting on from others
        given = delegated_snapshot(user, now)
        lines += delegated_lines(given, "Closed so far")
        notify(
            user, "task_daily",
            f"Your tasks today - {len(due_today)} due, {len(overdue)} overdue, {len(tasks)} open"[:200],
            ("\n".join(lines) or "Nothing is due today.") + "\n\nOpen Tasks to work through them.",
            wa_template=("day_start_digest", [
                user.get_full_name() or user.username,
                str(len(due_today)), str(len(overdue)), str(len(tasks)),
                # one line only: Meta rejects newlines inside a parameter
                " · ".join(f"{t.code} {t.title[:40]}"
                           for t in (overdue[:2] + due_today[:2])) or "nothing due",
            ]),
            link="/tasks",
        )
        sent += 1
    return sent


DAY_END_HOUR = int(os.environ.get("DAY_END_DIGEST_HOUR", "19"))   # 7 PM local


def send_day_end_digest(force=False) -> int:
    """The evening counterpart of the morning digest: what you closed today,
    what is still open, and your score. Score comes from crm.scoring so this
    message and the Reports page can never disagree."""
    from notifications.models import Notification
    from .scoring import score_for

    now = timezone.localtime()
    if not force and now.hour < DAY_END_HOUR:
        return 0
    today = now.date()
    if not force and not is_working_day(today):
        return 0                          # no working day, nothing to close
    month_start = today.replace(day=1)
    next_month = (month_start + timezone.timedelta(days=32)).replace(day=1)
    month_end = next_month - timezone.timedelta(days=1)

    # everyone with a task that is still open, or that they closed today
    people = {}
    for t in (Task.objects.filter(deleted_at__isnull=True)
              .select_related("assigned_to")):
        closed_today = (t.status == TaskStatus.DONE and t.completed_at
                        and timezone.localtime(t.completed_at).date() == today)
        if t.status != TaskStatus.DONE or closed_today:
            people.setdefault(t.assigned_to, {"open": [], "done_today": 0})
            if closed_today:
                people[t.assigned_to]["done_today"] += 1
            elif t.status != TaskStatus.DONE:
                people[t.assigned_to]["open"].append(t)

    sent = 0
    for user, bucket in people.items():
        if not user or not user.is_active:
            continue
        if Notification.objects.filter(user=user, type="task_day_end",
                                       created_at__date=today).exists():
            continue                      # once a day, however often we tick
        open_tasks = bucket["open"]
        overdue = sorted((t for t in open_tasks if t.due_at and t.due_at < now),
                         key=lambda t: t.due_at)
        stats = score_for(user, month_start, month_end)
        score = "not scored yet" if stats["score"] is None else f"{stats['score']} / 100"
        notify(
            user, "task_day_end",
            f"Day closing - {bucket['done_today']} done, {len(open_tasks)} pending"[:200],
            "\n".join([
                f"Completed today: {bucket['done_today']}",
                f"Still pending: {len(open_tasks)} (of which {len(overdue)} overdue)",
                f"Score this month: {score}",
            ] + ([f"Oldest overdue: {overdue[0].code} - {overdue[0].title[:60]}"]
                 if overdue else [])
              + delegated_lines(delegated_snapshot(user, now, today), "Closed today")
              + ["", "Close what you can, or post a status update on the rest."]),
            link="/tasks",
            wa_template=("day_end_digest", [
                user.get_full_name() or user.username,
                str(bucket["done_today"]),
                str(len(open_tasks)),
                str(len(overdue)),
                score,
            ]),
        )
        sent += 1
    return sent


OVERDUE_EMAIL_HOUR = 10     # local time; the Monday mail goes out after this


def _first_working_day_of_week(day):
    """Monday, or -- when Monday is a week-off or a holiday -- the next day
    people are at work, so a holiday Monday delays the mail instead of
    skipping the whole week."""
    d = day - timezone.timedelta(days=day.weekday())
    while d <= day and not is_working_day(d):
        d += timezone.timedelta(days=1)
    return d


def _score_text(stats):
    return "not scored yet" if stats["score"] is None else f"{stats['score']} / 100"


def send_weekly_overdue_email(force=False) -> int:
    """Monday morning: one email to EVERY active person with an address.
    Anyone with work past its due date gets the full list and a plain warning
    that each one is dragging their score down; everyone else gets a short
    "your pipeline is clear" note. Both carry their performance for the month.
    Email only -- the 2-hourly re-pings already cover WhatsApp.

    Automatic runs try once per person per week. force=True (the "send now"
    button / `send_overdue_email` command) skips the Monday check and retries
    anyone whose mail has not gone out today, so a double click is harmless.
    Returns how many emails were actually delivered to Gmail.
    """
    from accounts.models import User
    from notifications.channels import gmail
    from notifications.models import Notification
    from .scoring import score_for

    now = timezone.localtime()
    today = now.date()
    week_start = today - timezone.timedelta(days=today.weekday())
    if not force and (now.hour < OVERDUE_EMAIL_HOUR
                      or _first_working_day_of_week(today) != today):
        return 0
    already_since = today if force else week_start

    per = {}
    for t in (Task.objects.exclude(status=TaskStatus.DONE)
              .filter(deleted_at__isnull=True, due_at__isnull=False, due_at__lt=now)
              .select_related("assigned_to", "created_by").order_by("due_at")):
        per.setdefault(t.assigned_to_id, []).append(t)

    month_start = today.replace(day=1)
    month_end = ((month_start + timezone.timedelta(days=32)).replace(day=1)
                 - timezone.timedelta(days=1))
    last_end = month_start - timezone.timedelta(days=1)
    last_start = last_end.replace(day=1)
    sent = 0
    for user in User.objects.filter(is_active=True).exclude(email="").order_by("pk"):
        earlier = list(Notification.objects.filter(user=user, type="task_overdue_weekly",
                                                   created_at__date__gte=already_since))
        # The automatic run tries once a week whatever happened -- no
        # 5-minutely retries against a broken mailbox. "Send now" retries
        # anyone whose mail did not actually go, replacing the failed row.
        if not force and earlier:
            continue
        if any(ch.get("status") == "sent" for n in earlier for ch in (n.channels or [])):
            continue
        for n in earlier:
            n.delete()
        tasks = per.get(user.pk, [])
        stats = score_for(user, month_start, month_end)
        last = score_for(user, last_start, last_end)
        lines = [f"Hi {user.get_full_name() or user.username},", ""]
        if tasks:
            lines += [f"You have {len(tasks)} overdue task(s):", ""]
            for t in tasks:
                days = (today - timezone.localtime(t.due_at).date()).days
                late = f"{days} day(s) overdue" if days >= 1 else "overdue today"
                by = ("self-assigned, not scored" if t.created_by_id == user.pk else
                      f"assigned by {t.created_by.get_full_name() or t.created_by.username}"
                      if t.created_by else "assigned by -")
                lines.append(f"• {t.code} - {t.title[:80]}")
                lines.append(f"    Due {timezone.localtime(t.due_at):%d %b %Y, %I:%M %p} "
                             f"· {late} · {by}")
            lines.append("")
        else:
            lines += ["Your pipeline is clear -- nothing is past its due date. "
                      "Great work, keep it up!", ""]
        lines += [f"--- Your performance ({month_start:%B %Y}) ---",
                  f"Score this month: {_score_text(stats)}",
                  f"Score last month: {_score_text(last)}",
                  f"Completed: {stats['completed']} · Open: {stats['pending']} "
                  f"· Overdue: {stats['overdue']}"]
        scored = [t for t in tasks if t.created_by_id != user.pk]
        if scored:
            lines.append(f"{len(scored)} overdue task(s) count as a MISSED deadline in your "
                         "on-time rate (60% of your score) for as long as they stay open.")
        if tasks:
            lines.append("Finish them, or post a status update / ask for a new date today.")
        lines.append("")
        body = "\n".join(lines)
        title = (f"Overdue reminder - {len(tasks)} task(s) past due" if tasks
                 else "Weekly update - your pipeline is clear")
        result = gmail.send_email(user.email, f"[Automation Task] {title}", body,
                                  link="/tasks", link_label="Open my tasks")
        Notification.objects.create(user=user, type="task_overdue_weekly",
                                    title=title, body=body, link="/tasks",
                                    channels=[result])
        sent += result.get("status") == "sent"
    return sent


def send_followup_reminders(force=False) -> int:
    """The ticker: everything automated goes out from here.

    On a non-working day it sends nothing -- no follow-ups, no overdue
    re-pings, no digests, no mistake escalations. People are not at work, and
    a reminder every two hours on a Sunday is not a reminder, it is a
    nuisance. Whatever is overdue is still overdue on Monday morning.
    """
    now = timezone.now()
    if not force and not is_working_day(timezone.localtime(now).date()):
        purge_expired_attachments()      # housekeeping bothers nobody
        return 0
    due = (
        Lead.objects.filter(
            status__in=OPEN_STATUSES,
            follow_up_at__isnull=False,
            follow_up_at__lte=now,
            assigned_to__isnull=False,
        )
        .filter(Q(reminded_at__isnull=True) | Q(reminded_at__lt=F("follow_up_at")))
        .select_related("assigned_to")
    )
    sent = 0
    for lead in due:
        notify_follow_up_due(lead)
        lead.reminded_at = now
        lead.save(update_fields=["reminded_at"])
        sent += 1
    sent += send_task_reminders()
    send_daily_task_digest()            # date-guarded: one per person per day
    send_day_end_digest()               # date-guarded: once a day after 7 PM
    send_weekly_overdue_email()         # week-guarded: Monday (1st working day) 10 AM
    purge_expired_attachments()
    from mistakes.sla import escalate_overdue_mistakes  # lazy: avoids app-load cycles
    from mistakes.digests import send_daily_manager_summaries, send_weekly_founder_digest
    escalate_overdue_mistakes()
    send_daily_manager_summaries()      # date-guarded: once a day after 09:00
    send_weekly_founder_digest()        # date-guarded: Mondays only
    return sent
