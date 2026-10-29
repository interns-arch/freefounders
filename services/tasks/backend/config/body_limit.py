"""Signed-out visitor pages (PLAN.md §22) read JSON bodies through DRF, which is not bound by Django's
DATA_UPLOAD_MAX_MEMORY_SIZE. A body bigger than PUBLIC_BODY_MAX_BYTES (default 2 MB: a 600 KB selfie as base64 plus
the form) is refused before anything is parsed (security audit 2026-10-29). Django reads only CONTENT_LENGTH bytes of a
body, so a body without a length is read as empty."""
import os

from django.http import JsonResponse

PUBLIC_PREFIXES = ("/api/visitors/public/", "/api/visitors/pass/")


def _limit() -> int:
    raw = os.environ.get("PUBLIC_BODY_MAX_BYTES", "").strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else 2 * 1024 * 1024


class PublicBodyLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(PUBLIC_PREFIXES):
            try:
                length = int(request.META.get("CONTENT_LENGTH") or 0)
            except ValueError:
                length = 0
            if length > _limit():
                return JsonResponse({"detail": "This request is too large."}, status=413)
        return self.get_response(request)
