from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import NotificationViewSet, notification_rules, whatsapp_hours

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notifications")

urlpatterns = [path("notification-rules/", notification_rules),
               path("whatsapp-hours/", whatsapp_hours)] + router.urls
