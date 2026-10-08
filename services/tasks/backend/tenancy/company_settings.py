"""Per-company settings with the environment variable as fallback.

`company_env("HR_WORK_START", "09:30")` returns the current company's value
when one is set, else exactly os.environ.get(name, default). Outside
multi-company mode it IS os.environ.get, so a standalone install and the
test suite behave as before.
"""
import base64
import hashlib
import os
import threading
import time

from django.conf import settings

from . import schemas

SECRET_KEYS = {
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN",
    "AI_API_KEY", "NVIDIA_API_KEY", "ANTHROPIC_API_KEY",
}
_TTL_SECONDS = 30
_cache: dict[str, tuple[float, dict[str, str]]] = {}
_lock = threading.Lock()


def _fernet():
    from cryptography.fernet import Fernet

    secret = getattr(settings, "SETTINGS_KEY", "") or settings.SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


def _company_values(schema: str) -> dict[str, str]:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(schema)
        if hit and now - hit[0] < _TTL_SECONDS:
            return hit[1]
    from .models import CompanySetting

    values = {}
    for row in CompanySetting.objects.all():
        if not row.value:
            continue
        try:
            values[row.key] = decrypt(row.value) if row.secret else row.value
        except Exception:  # noqa: BLE001 -- wrong SETTINGS_KEY: treat as unset rather than crash
            continue
    with _lock:
        _cache[schema] = (now, values)
    return values


def forget(schema: str | None = None) -> None:
    with _lock:
        if schema:
            _cache.pop(schema, None)
        else:
            _cache.clear()


def company_env(name: str, default: str = "") -> str:
    schema = schemas.current() if schemas.enabled() else None
    if schema:
        value = _company_values(schema).get(name, "").strip()
        if value:
            return value
    return os.environ.get(name, default)


def set_value(name: str, value: str) -> None:
    from .models import CompanySetting

    secret = name in SECRET_KEYS
    CompanySetting.objects.update_or_create(
        key=name, defaults={"value": encrypt(value) if secret and value else value, "secret": secret}
    )
    forget(schemas.current())
