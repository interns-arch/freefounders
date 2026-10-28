"""Team 360 endpoints (PLAN.md §25). Every one checks the viewer's scope (service.people) on the server."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import service


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def tiles(request):
    return Response(service.tiles(request.user))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def person(request, pk):
    target = service.person_or_403(request.user, pk)
    return Response(service.summary(request.user, target, request.query_params))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def person_attendance(request, pk):
    target = service.person_or_403(request.user, pk)
    service.need_area("attendance")
    return Response(service.attendance_month(request.user, target, request.query_params))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def person_tasks(request, pk):
    target = service.person_or_403(request.user, pk)
    service.need_area("tasks")
    return Response(service.task_lists(request.user, target, request.query_params))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def person_visitors(request, pk):
    from rest_framework.exceptions import PermissionDenied
    target = service.person_or_403(request.user, pk)
    if not service.areas()["visitors"]:
        raise PermissionDenied("Visitors is switched off for this company.")
    return Response(service.visits(request.user, target, request.query_params))
