"""POST /api/internal/companies -- the Platform sets up a company in Tasks.
GET / DELETE /api/internal/companies/<id> -- what Tasks holds for it / remove it (`company -- delete`).

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
    if created:
        from .company_settings import set_value

        with schemas.use(schema):
            set_value("ATTENDANCE_PHOTO", "required")
    return Response(
        {"companyId": company_id, "schema": schema, "created": created},
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["GET", "DELETE"])
@authentication_classes([ServiceTokenAuthentication])
@permission_classes([IsPlatformService])
def company_detail(request, company_id):
    """GET / DELETE /api/internal/companies/<id> -- `company -- delete` on the Platform (PLAN.md §14).

    GET says what Tasks holds for the company (schema, tables, rows, files); DELETE removes it permanently: its files
    under MEDIA_ROOT/c/<schema>/, then the schema (CASCADE) and its registry row. Only the schema the registry maps
    to this id is touched, never a name from the request, and only a co_<code> schema. Files go first and the
    registry row last, so a repeat after a failure finishes the job; a repeat after success answers deleted=false.
    """
    from .storage import company_files, remove_company_files

    if not schemas.enabled():
        return Response({"detail": "Multi-company mode is off (TENANCY=schemas)"}, status=status.HTTP_409_CONFLICT)
    try:
        company_id = str(uuid.UUID(str(company_id)))
    except ValueError:
        return Response({"detail": "companyId must be a UUID"}, status=status.HTTP_400_BAD_REQUEST)
    if request.auth.get("cid") not in (None, company_id):
        return Response({"detail": "Token is for another company"}, status=status.HTTP_403_FORBIDDEN)
    schemas.ensure_registry()
    schema = schemas.registered_schema(company_id)
    if schema is None:
        return Response({"registered": False, "schema": None, "deleted": False})
    if not schemas.deletable(schema):
        return Response({"detail": f"Refusing: {schema!r} is not a company schema"}, status=status.HTTP_409_CONFLICT)
    try:
        if request.method == "GET":
            return Response({"registered": True, "schema": schema, **schemas.schema_stats(schema), "files": company_files(schema)})
        stats = schemas.schema_stats(schema)
        files = remove_company_files(schema)
        schemas.drop_company(company_id, schema)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    return Response({"registered": False, "schema": schema, "deleted": True, **stats, "files": files})
