from django.db.models import Count
from django.utils import timezone
from config.exports import ExportMixin
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.serializers import ModelSerializer

from .categories import CATEGORIES
from .models import Notification


class NotificationSerializer(ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "category", "title", "body", "link", "channels", "read_at", "created_at"]


class NotificationViewSet(ExportMixin, mixins.DestroyModelMixin,
                          viewsets.ReadOnlyModelViewSet):
    """Own notifications only -- there is deliberately no way to query, or
    clear, someone else's feed. Clearing really deletes the row: a
    notification is a delivered message, not a record anyone audits, and
    people asked to be able to empty the list for good."""
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer
    export_name = "notifications"
    export_columns = [("When", "created_at"), ("Area", "category"), ("Type", "type"), ("Title", "title"), ("Message", "body"),
                      ("Read", "read_at"), ("Link", "link")]

    def get_permissions(self):
        # Reading the list is the Notifications permission (PLAN.md §19.19); marking read or clearing your own
        # rows stays open, so a "mark all read" never fails for someone without it.
        if getattr(self, "action", None) in ("list", "retrieve", "unread_count"):
            from accounts.permissions import HasPermission
            return [HasPermission.of("notifications.view")()]
        return super().get_permissions()

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    def _in_area(self, qs, request):
        """?category=attendance (or several, comma-separated): one area of the bell (PLAN.md §19.37)."""
        wanted = request.query_params.get("category") or request.data.get("category") if request.method == "POST" \
            else request.query_params.get("category")
        names = [c for c in str(wanted or "").split(",") if c in CATEGORIES]
        return qs.filter(category__in=names) if names else qs

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        return self._in_area(qs, self.request) if getattr(self, "action", None) == "list" else qs

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        """The unread total and the unread per area (every area listed, 0 included)."""
        rows = (self.get_queryset().filter(read_at__isnull=True)
                .values("category").annotate(n=Count("id")))
        by = {c: 0 for c in CATEGORIES}
        for r in rows:
            by[r["category"] if r["category"] in by else "tasks"] += r["n"]
        return Response({"count": sum(by.values()), "by_category": by})

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        n = self.get_object()
        if not n.read_at:
            n.read_at = timezone.now()
            n.save(update_fields=["read_at"])
        return Response(NotificationSerializer(n).data)

    @action(detail=False, methods=["post"])
    def read_all(self, request):
        # ?category= (or {"category": ...}) marks one area only: "Mark all read" on a tab of the bell.
        updated = self._in_area(self.get_queryset().filter(read_at__isnull=True), request).update(read_at=timezone.now())
        return Response({"marked": updated})

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """Empty this person's notification list for good.

        ?only=read clears just the ones they have already seen, so an unread
        alert is never swept away by a tap meant to tidy up. The rows are
        deleted, not hidden -- nothing is left behind in the database.
        """
        qs = self.get_queryset()
        if request.query_params.get("only") == "read" or request.data.get("only") == "read":
            qs = qs.filter(read_at__isnull=False)
        deleted, _ = qs.delete()
        return Response({"deleted": deleted})


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def notification_rules(request):
    """Which kinds of event also go out by email / WhatsApp (PLAN.md §16.5). Admins (settings.manage)."""
    from accounts.permissions import has_capability

    from . import rules

    if not has_capability(request.user, "tasks.settings"):
        raise PermissionDenied("Your role does not include Task settings.")
    if request.method == "PUT":
        try:
            return Response(rules.update(request.data))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
    return Response(rules.table())


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def whatsapp_hours(request):
    """The company's WhatsApp sending hours (original app d40034c): {start, end} in local hours, default 10-19.
    Outside them a WhatsApp is held until the next opening (repeating overdue pings are skipped). Task settings."""
    from accounts.permissions import has_capability
    from tenancy.company_settings import set_value

    from .service import HOURS_SETTING, whatsapp_hours as current

    if not has_capability(request.user, "tasks.settings"):
        raise PermissionDenied("Your role does not include Task settings.")
    if request.method == "PUT":
        try:
            start, end = int(request.data.get("start")), int(request.data.get("end"))
        except (TypeError, ValueError):
            return Response({"detail": "Send start and end as whole hours (0-24)."}, status=400)
        if not (0 <= start < end <= 24):
            return Response({"detail": "The start must be before the end, both between 0 and 24."}, status=400)
        set_value(HOURS_SETTING, f"{start}-{end}")
    start, end = current()
    return Response({"start": start, "end": end})
