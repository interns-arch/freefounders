"""Uploaded files are served only by signed, expiring links.

Task attachments, lead documents, leave documents, form uploads and notice attachments used to be served by plain
`/media/<path>` URLs: anyone who knew or guessed a path (`task_files/<task id>/<file name>`) could fetch the file
without signing in, from any company. Now:

- the API hands out `file_url(f)`: on the local disk `/media/<path>?s=<signature>`, signed with SECRET_KEY and valid
  for MEDIA_LINK_SECONDS (on S3 the storage already returns a presigned, expiring link, AWS_QUERYSTRING_AUTH);
- `/media/<path>` answers 404 unless the signature matches that exact path and has not expired. Only the endpoints
  that may show a file (task detail, lead detail, leave list, form submissions, notices) hand out its link, so a link
  is as private as the record it came with.

Responses never run as a page of the app: only images and PDFs are shown inline; anything else (HTML, SVG, scripts…)
is a download, with `nosniff` and a sandboxing CSP, so an uploaded file cannot act as the signed-in user.
"""
from django.conf import settings
from django.core import signing
from django.core.files.storage import FileSystemStorage

SALT = "ff.media.v1"
INLINE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"}


def _seconds() -> int:
    return int(getattr(settings, "MEDIA_LINK_SECONDS", 3600))


def _name(name: str) -> str:
    return str(name or "").replace("\\", "/").lstrip("/")


def sign(name: str) -> str:
    """The `s` query value for a stored file name (timestamp:signature)."""
    clean = _name(name)
    return signing.TimestampSigner(salt=SALT).sign(clean)[len(clean) + 1:]


def valid(name: str, token: str | None) -> bool:
    if not token:
        return False
    try:
        signing.TimestampSigner(salt=SALT).unsign(f"{_name(name)}:{token}", max_age=_seconds())
        return True
    except signing.BadSignature:  # includes SignatureExpired
        return False


def file_url(f) -> str | None:
    """The link the API returns for a FileField value (None when empty)."""
    if not f:
        return None
    url = f.url
    if isinstance(f.storage, FileSystemStorage):
        url = f"{url}{'&' if '?' in url else '?'}s={sign(f.name)}"
    return url


def harden(response, content_type: str | None):
    """Headers for a served upload: never sniffed, never a live page of the app, never in a shared cache."""
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "no-referrer"
    response["Cache-Control"] = "private, max-age=600"
    base = (content_type or "").split(";")[0].strip().lower()
    if base not in INLINE_TYPES:
        response["Content-Disposition"] = "attachment"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response
