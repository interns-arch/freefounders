"""Internal API the FreeFounders Platform calls; not for browsers.

POST /api/internal/provision -- the Platform gives a person access to Tasks.
Finds that person's user here (already linked, else same email, else same
username) or creates one, links it, and returns its id. Authenticated by a
60-second Platform service token with audience "tasks-internal".
"""
import re
import uuid

from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from rest_framework import status
from rest_framework.authentication import BaseAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from . import platform_auth
from .models import ROLE_DEFAULT_DEPARTMENT, Department, Role, User

SERVICE_AUDIENCE = "tasks-internal"


class ServiceTokenAuthentication(BaseAuthentication):
    """Accepts only a Platform service token (audience tasks-internal); request.auth holds its claims."""

    def authenticate(self, request):
        if not platform_auth.enabled():
            raise AuthenticationFailed("Platform sign-in is not configured")
        token = platform_auth.bearer(request)
        if not token:
            raise AuthenticationFailed("Service token required")
        claims = platform_auth.verify(token, SERVICE_AUDIENCE)
        if claims.get("sub") != "platform":
            raise AuthenticationFailed("Invalid service token")
        return AnonymousUser(), claims

    def authenticate_header(self, request):
        return 'Bearer realm="internal"'


class IsPlatformService(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.auth, dict) and request.auth.get("sub") == "platform"


def _clean(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _free_username(*candidates: str) -> str:
    for raw in candidates:
        base = re.sub(r"[^\w.@+-]", "", raw)[:140]
        if not base:
            continue
        name, n = base, 2
        while User.objects.filter(username__iexact=name).exists():
            name, n = f"{base}-{n}", n + 1
        return name
    return f"user-{uuid.uuid4().hex[:8]}"


@api_view(["POST"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def provision(request):
    data = request.data
    try:
        person_id = uuid.UUID(str(data.get("personId")))
    except ValueError:
        return Response({"detail": "personId must be a UUID"}, status=status.HTTP_400_BAD_REQUEST)
    full_name = _clean(data.get("fullName"))
    email = _clean(data.get("email")).lower()
    username = _clean(data.get("username"))
    code = _clean(data.get("employeeCode"))
    if not full_name:
        return Response({"detail": "fullName is required"}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        user = User.objects.select_for_update().filter(platform_person_id=person_id).first()
        created = False
        if user is None:
            match = None
            if email:
                match = User.objects.select_for_update().filter(email__iexact=email).order_by("id").first()
            if match is None and username:
                match = User.objects.select_for_update().filter(username__iexact=username).first()
            if match is not None and match.platform_person_id not in (None, person_id):
                return Response(
                    {"detail": f"The Tasks login '{match.username}' already belongs to another person"},
                    status=status.HTTP_409_CONFLICT,
                )
            user = match
        if user is None:
            role = data.get("appRole") if data.get("appRole") in Role.values else Role.SALES_EXECUTIVE
            first, _, last = full_name.partition(" ")
            user = User(
                username=_free_username(username, email.split("@")[0] if email else "", code, full_name.replace(" ", ".").lower()),
                first_name=first[:150],
                last_name=last[:150],
                email=email,
                whatsapp_phone=re.sub(r"[^\d+]", "", _clean(data.get("mobile")))[:20],
                role=role,
                department=ROLE_DEFAULT_DEPARTMENT.get(role, Department.SALES),
            )
            # Signs in through the Platform only; no local password.
            user.set_unusable_password()
            created = True
        user.platform_person_id = person_id
        user.save()
    return Response(
        {"userId": user.pk, "username": user.username, "created": created, "active": user.is_active},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )
