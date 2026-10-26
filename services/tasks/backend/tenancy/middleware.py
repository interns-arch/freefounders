"""Pins every request to its company's schema (multi-company mode only).

The company comes from the Kaampilot token: the access token (`cid`) for
the app's own API, the service token for /api/internal/*. Anything without a
company runs against the empty ff_none schema, and API calls without one are
refused up front with a clear 401 instead of a database error. That includes
the app's own username/password login: in multi-company mode people sign in
through the Platform only.
"""
import jwt
from django.http import JsonResponse

from accounts import platform_auth

from . import schemas

# Paths that never touch a company's data.
# The open QR visitor sign-in finds its company from the code in its URL (visitors/views.py public_view).
NO_COMPANY_PATHS = ("/health", "/api/internal/companies", "/api/visitors/public/")


def _company_id(request) -> str | None:
    token = platform_auth.bearer(request)
    if not token or not platform_auth.enabled():
        return None
    try:
        if jwt.get_unverified_header(token).get("alg") != "EdDSA":
            return None
    except jwt.PyJWTError:
        return None
    audience = "tasks-internal" if request.path.startswith("/api/internal/") else platform_auth.ACCESS_AUDIENCE
    try:
        claims = platform_auth.verify(token, audience)
    except Exception:  # noqa: BLE001 -- the auth class reports bad tokens properly
        return None
    return claims.get("cid") if isinstance(claims.get("cid"), str) else None


class CompanyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not schemas.enabled():
            return self.get_response(request)

        request.company_id = None
        schema = schemas.NO_COMPANY
        if not request.path.startswith(NO_COMPANY_PATHS):
            company_id = _company_id(request)
            found = schemas.schema_for(company_id) if company_id else None
            if found:
                request.company_id, schema = company_id, found
            elif request.path.startswith(("/api/", "/admin/")):
                detail = "This company is not set up in Tasks" if company_id else "Sign in through Kaampilot"
                return JsonResponse({"detail": detail, "code": "no_company"}, status=401)

        token = schemas.activate(schema)
        try:
            return self.get_response(request)
        finally:
            schemas.deactivate(token)
