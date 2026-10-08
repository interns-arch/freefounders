"""Events for the FreeFounders Platform (PLAN.md section 17.4)."""
from datetime import timedelta

from django.utils import timezone


def emit(type_: str, payload: dict) -> None:
    from accounts import platform_auth

    if not platform_auth.enabled():
        return
    from .models import OutboxEvent
    OutboxEvent.objects.create(type=type_, payload=payload)


def after(after_id: int, limit: int = 200) -> list[dict]:
    """Events after `after_id`, oldest first. Events older than 30 days are cleared on the way."""
    from .models import OutboxEvent

    OutboxEvent.objects.filter(created_at__lt=timezone.now() - timedelta(days=30)).delete()
    return [{"id": e.id, "type": e.type, "payload": e.payload, "createdAt": e.created_at.isoformat()}
            for e in OutboxEvent.objects.filter(id__gt=after_id).order_by("id")[:limit]]
