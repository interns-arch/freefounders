"""Count badges (PLAN.md §19.42): what waits for the signed-in person, in one cheap call.

GET /api/badges/ ->
  {"tasks": {"my_tasks", "to_accept", "requests", "total"},
   "hr": {"leave", "corrections", "approvals"}}

Every number is a COUNT over the same rows the matching tab lists (My Tasks open / in progress, To accept, Requests,
Attendance → Approvals), never another person's work. Runs in the request's company schema like every other view.
The web app polls it once a minute (and after a change), so it must stay a handful of indexed COUNT queries.
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import CompletionReviewStatus, Task, TaskCompletion, TaskStatus


def task_badges(user) -> dict:
    from .task_views import change_request_inbox
    my_tasks = Task.objects.filter(assigned_to=user, deleted_at__isnull=True,
                                   status__in=(TaskStatus.OPEN, TaskStatus.IN_PROGRESS)).count()
    # sub-task parts go through the same completion review, so they are counted here too
    to_accept = TaskCompletion.objects.filter(approver=user, status=CompletionReviewStatus.PENDING).count()
    requests = change_request_inbox(user).count()
    return {"my_tasks": my_tasks, "to_accept": to_accept, "requests": requests,
            "total": my_tasks + to_accept + requests}


def hr_badges(user) -> dict:
    """Leave and attendance regularizations this person may decide (never their own). Leave follows the approval
    rule (approvers); regularization also goes to the reporting manager (PLAN.md §19.38), same as the Approvals tab."""
    from hr import approvals, regularization
    from hr.models import AttendanceCorrection, LeaveRequest
    leave = corrections = 0
    if approvals.is_approver(user):
        people = approvals.reviewable_users(user).exclude(pk=user.pk).values("pk")
        leave = LeaveRequest.objects.filter(user__in=people, status="pending").count()
    if regularization.is_reviewer(user):
        people = regularization.reviewable_users(user).exclude(pk=user.pk).values("pk")
        corrections = AttendanceCorrection.objects.filter(user__in=people, status="pending").count()
    return {"leave": leave, "corrections": corrections, "approvals": leave + corrections}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def badges(request):
    return Response({"tasks": task_badges(request.user), "hr": hr_badges(request.user)})
