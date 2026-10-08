"""POST /api/internal/companies -- the Platform sets up a company in Tasks.

Creates the company's schema (or brings it up to date) and registers it.
Idempotent. Platform service token (audience tasks-internal) only.
"""
import uuid

from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from accounts.internal import IsPlatformService, ServiceTokenAuthentication

from . import schemas


@api_view(["POST"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def create_company(request):
    if not schemas.enabled():
        return Response({"detail": "Multi-company mode is off (TENANCY=schemas)"}, status=status.HTTP_409_CONFLICT)
    data = request.data
    try:
        company_id = str(uuid.UUID(str(data.get("companyId"))))
        schema = schemas.schema_for_code(str(data.get("code") or ""))
    except ValueError as exc:
        return Response({"detail": str(exc) or "companyId must be a UUID"}, status=status.HTTP_400_BAD_REQUEST)
    name = str(data.get("name") or "").strip() or schema
    if request.auth.get("cid") not in (None, company_id):
        return Response({"detail": "Token is for another company"}, status=status.HTTP_403_FORBIDDEN)
    schemas.ensure_registry()
    existing = schemas.schema_for(company_id)
    if existing and existing != schema:
        return Response({"detail": f"Company already set up as {existing}"}, status=status.HTTP_409_CONFLICT)
    for row in (schemas.companies() if existing is None else []):
        if row["schema"] == schema:
            return Response({"detail": f"Code already used by {row['name']}"}, status=status.HTTP_409_CONFLICT)
    created = schemas.create_company(company_id, schema, name)
    return Response(
        {"companyId": company_id, "schema": schema, "created": created},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )
