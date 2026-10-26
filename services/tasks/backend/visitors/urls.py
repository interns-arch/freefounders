from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views, views_v3

router = DefaultRouter()
router.register("visitors/visits", views.VisitViewSet, basename="visitor-visits")
router.register("visitors/vehicles", views.VehicleViewSet, basename="visitor-vehicles")
router.register("visitors/activity", views.ActivityViewSet, basename="visitor-activity")
router.register("visitors/deliveries", views.DeliveryViewSet, basename="visitor-deliveries")
router.register("visitors/watchlist", views.WatchViewSet, basename="visitor-watchlist")
router.register("visitors/contractors", views_v3.ContractorViewSet, basename="visitor-contractors")
router.register("visitors/material", views_v3.MaterialViewSet, basename="visitor-material")
router.register("visitors/checkpoints", views_v3.CheckpointViewSet, basename="visitor-checkpoints")
router.register("visitors/incidents", views_v3.IncidentViewSet, basename="visitor-incidents")

urlpatterns = [
    path("visitors/config/", views.config_view),
    path("visitors/settings/", views.settings_view),
    path("visitors/link/", views.link_view),
    path("visitors/hosts/", views.hosts_view),
    path("visitors/lookup/", views.lookup_view),
    path("visitors/inside/", views.inside_view),
    path("visitors/guards/", views.guards_view),
    path("visitors/people/<int:pk>/photo/", views.visitor_photo_view),
    path("visitors/public/<str:code>/<str:token>/", views.public_view),
    path("visitors/pass/<str:code>/<str:token>/", views.public_pass_view),
    path("visitors/invites/", views.invites_view),
    path("visitors/scan/", views_v3.scan_view),
    path("visitors/id-scan/", views_v3.id_scan_view),
    path("visitors/task-options/", views_v3.task_options_view),
    path("visitors/reports/", views_v3.reports_view),
] + router.urls
