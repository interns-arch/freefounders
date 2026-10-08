"""Role duties (PLAN.md §17.3): what a role is responsible for, created as tasks for everyone holding it.

The duties come from the FreeFounders role builder with the roles (PUT /api/internal/access). The worker
calls create_duty_tasks() on working days. Each duty makes at most one task per person per period
(DutyRun remembers), so running it again never creates a second one.

  daily    -- every working day
  weekly   -- once a week, from the chosen weekday on (0 = Monday)
  monthly  -- once a month, from the chosen date on (1-28)
  once     -- when someone gets the role (a joining checklist); people who already
              held the role when the duty was added do not get it
"""
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

FREQUENCIES = ("daily", "weekly", "monthly", "once")


def period_for(duty, today) -> str | None:
    """The period a duty's task belongs to today, or None when it is not due yet."""
    from .reminders import is_working_day

    if duty.frequency == "daily":
        return today.isoformat() if is_working_day(today) else None
    if duty.frequency == "weekly":
        year, week, _ = today.isocalendar()
        return f"{year}-W{week:02d}" if today.weekday() >= (duty.weekday or 0) else None
    if duty.frequency == "monthly":
        return f"{today:%Y-%m}" if today.day >= (duty.month_day or 1) else None
    if duty.frequency == "once":
        return "once"
    return None


def _due(duty, today):
    from hr.services import _parse_hhmm, cfg

    end = _parse_hhmm(cfg()["work_end"], time(18, 30))
    day = today + timedelta(days=7) if duty.frequency == "once" else today
    return timezone.make_aware(datetime.combine(day, end))


def create_duty_tasks(today=None) -> int:
    """Creates the tasks that are due. Returns how many were created."""
    from accounts.models import UserAccessRole
    from notifications.service import notify

    from .models import DutyRun, RoleDuty, Task, TaskChecklistItem

    today = today or timezone.localdate()
    created = 0
    for duty in RoleDuty.objects.filter(active=True, role__archived=False).select_related("role"):
        key = period_for(duty, today)
        if key is None:
            continue
        holders = UserAccessRole.objects.filter(role=duty.role, user__is_active=True).select_related("user")
        if duty.frequency == "once":
            # A joining checklist: only for people who got the role after the duty existed.
            holders = holders.filter(created_at__gte=duty.created_at)
        done = set(DutyRun.objects.filter(duty=duty, period=key).values_list("user_id", flat=True))
        for link in holders:
            user = link.user
            if user.pk in done:
                continue
            with transaction.atomic():
                task = Task.objects.create(
                    title=duty.title[:200], description=duty.description, assigned_to=user, created_by=None,
                    due_at=_due(duty, today), department=user.department,
                )
                TaskChecklistItem.objects.bulk_create([
                    TaskChecklistItem(task=task, text=str(step)[:200], order=i) for i, step in enumerate(duty.steps or [])
                ])
                DutyRun.objects.create(duty=duty, user=user, period=key, task=task)
            created += 1
            if duty.frequency == "once":
                notify(user, "task_assigned", f"New for your role ({duty.role.name}): {duty.title}",
                       duty.description or "", link=f"/tasks/{task.pk}", link_label="Open the task")
    return created


def sync_role_duties(role, duties) -> list[str]:
    """Applies the duties the Platform sent for one role. Duties no longer sent stop (their tasks stay)."""
    from .models import RoleDuty

    problems, seen = [], []
    for d in duties or []:
        frequency = str(d.get("frequency") or "")
        title = str(d.get("title") or "").strip()
        if frequency not in FREQUENCIES or not title or not d.get("id"):
            problems.append(f"{role.name}: a duty is incomplete")
            continue
        weekday = d.get("weekday")
        month_day = d.get("monthDay")
        RoleDuty.objects.update_or_create(duty_id=d["id"], defaults={
            "role": role, "title": title[:200], "description": str(d.get("description") or "")[:1000],
            "steps": [str(s)[:200] for s in (d.get("steps") or [])][:20], "frequency": frequency,
            "weekday": int(weekday) if frequency == "weekly" and weekday is not None else None,
            "month_day": int(month_day) if frequency == "monthly" and month_day is not None else None,
            "active": True,
        })
        seen.append(str(d["id"]))
    RoleDuty.objects.filter(role=role, active=True).exclude(duty_id__in=seen).update(active=False)
    return problems
