from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import NotificationViewSet, notification_rules

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notifications")

urlpatterns = [path("notification-rules/", notification_rules)] + router.urls
