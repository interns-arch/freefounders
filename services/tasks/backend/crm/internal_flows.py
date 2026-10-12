"""What the FreeFounders Platform's cross-app rules need from Tasks (PLAN.md §17.4). Platform service token only.

GET  /api/internal/events?after=<id>   the outbox (tenancy/outbox.py)
POST /api/internal/tasks               a task for a person, linked to something in another app (an Assets ticket)
POST /api/internal/exit-tasks          the company's exit checklist for someone leaving
"""
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from accounts.internal import IsPlatformService, ServiceTokenAuthentication
from accounts.models import User
from notifications.service import notify
from tenancy.company_settings import company_env

from .models import Task, TaskChecklistItem

DEFAULT_EXIT_CHECKLIST = [
    "Hand over open tasks and documents",
    "Collect company assets, ID card and keys",
    "Switch off system and email access",
    "Full and final settlement",
    "Exit interview",
]
PRIORITIES = {"LOW": "low", "MEDIUM": "normal", "HIGH": "high", "URGENT": "urgent", "CRITICAL": "urgent"}


def _user(person_id):
    return User.objects.filter(platform_person_id=person_id, is_active=True).first() if person_id else None


def _due(days: int):
    from hr.services import _parse_hhmm, cfg
    end = _parse_hhmm(cfg()["work_end"], time(18, 30))
    return timezone.make_aware(datetime.combine(timezone.localdate() + timedelta(days=days), end))


@api_view(["GET"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def events(request):
    from tenancy.outbox import after
    try:
        after_id = max(0, int(request.query_params.get("after") or 0))
    except ValueError:
        after_id = 0
    return Response(after(after_id))


@api_view(["POST"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def create_task(request):
    """{assigneePersonId, title, description?, priority?, externalRef, externalUrl?, dueInDays?} -> the task.
    The same externalRef twice returns the first task (the Platform may retry)."""
    d = request.data
    ref = str(d.get("externalRef") or "")[:80]
    title = str(d.get("title") or "").strip()[:200]
    if not ref or not title:
        return Response({"detail": "title and externalRef are required"}, status=status.HTTP_400_BAD_REQUEST)
    existing = Task.objects.filter(external_ref=ref).first()
    if existing:
        return Response({"taskId": existing.pk, "code": existing.code, "url": f"/tasks/tasks/{existing.pk}", "created": False})
    user = _user(d.get("assigneePersonId"))
    if user is None:
        return Response({"detail": "That person has no active Tasks user"}, status=status.HTTP_404_NOT_FOUND)
    url = str(d.get("externalUrl") or "")
    task = Task.objects.create(
        title=title, description=str(d.get("description") or "")[:5000], assigned_to=user, created_by=None,
        priority=PRIORITIES.get(str(d.get("priority") or "").upper(), "normal"),
        due_at=_due(max(0, min(60, int(d.get("dueInDays") or 2)))), department=user.department,
        external_ref=ref, external_url=url if url.startswith("/") else "",
    )
    notify(user, "task_assigned", f"New task: {task.code} {title}"[:200], task.description[:500],
           link=f"/tasks/{task.pk}", link_label="Open the task")
    return Response({"taskId": task.pk, "code": task.code, "url": f"/tasks/tasks/{task.pk}", "created": True},
                    status=status.HTTP_201_CREATED)


def exit_checklist() -> list[str]:
    raw = company_env("EXIT_CHECKLIST", "")
    items = [line.strip() for line in raw.splitlines() if line.strip()] if raw else []
    return items or DEFAULT_EXIT_CHECKLIST


@api_view(["POST"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def exit_tasks(request):
    """{personId, lastWorkingDate, reason?}: one task with the company's exit checklist as its steps, for the
    person's manager (else the HR administrators' first), due on the last working day. Once per person."""
    from accounts.access import users_with

    d = request.data
    leaver = User.objects.filter(platform_person_id=d.get("personId")).first()
    if leaver is None:
        return Response({"detail": "That person has no Tasks user"}, status=status.HTTP_404_NOT_FOUND)
    try:
        last_day = datetime.strptime(str(d.get("lastWorkingDate")), "%Y-%m-%d").date()
    except ValueError:
        return Response({"lastWorkingDate": "Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)
    ref = f"exit:{leaver.platform_person_id}"
    existing = Task.objects.filter(external_ref=ref).exclude(status="done").first()
    if existing:
        return Response({"taskId": existing.pk, "code": existing.code, "created": False})
    manager = leaver.reporting_manager if leaver.reporting_manager_id and leaver.reporting_manager.is_active else None
    owner = manager or users_with("hr.settings").exclude(pk=leaver.pk).order_by("pk").first()
    if owner is None:
        return Response({"detail": "Nobody to give the exit checklist to (no manager, no HR administrator)"},
                        status=status.HTTP_409_CONFLICT)
    from hr.services import _parse_hhmm, cfg
    end = _parse_hhmm(cfg()["work_end"], time(18, 30))
    name = leaver.get_full_name() or leaver.username
    reason = str(d.get("reason") or "").strip()
    with transaction.atomic():
        task = Task.objects.create(
            title=f"Exit checklist: {name} (last day {last_day:%d %b %Y})"[:200],
            description=f"{name} is leaving. Last working day: {last_day:%d %b %Y}." + (f"\nReason: {reason}" if reason else ""),
            assigned_to=owner, created_by=None, priority="high", department=leaver.department,
            due_at=timezone.make_aware(datetime.combine(last_day, end)), external_ref=ref,
        )
        TaskChecklistItem.objects.bulk_create([TaskChecklistItem(task=task, text=t[:200], order=i)
                                               for i, t in enumerate(exit_checklist())])
    notify(owner, "task_assigned", f"Exit checklist for {name}", task.description, link=f"/tasks/{task.pk}",
           link_label="Open the checklist")
    return Response({"taskId": task.pk, "code": task.code, "created": True}, status=status.HTTP_201_CREATED)
