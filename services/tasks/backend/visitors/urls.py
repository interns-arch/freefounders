from django.urls import path, re_path
from rest_framework.routers import DefaultRouter

from . import vehicle_api, views, views_v3

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
    # V4 (PLAN.md §22.11): before the check-in link's pattern, which would take "device" / "out" as a token.
    path("visitors/public/<str:code>/device/", views.public_device_view),
    path("visitors/public/<str:code>/out/<str:token>/", views.public_checkout_view),
    path("visitors/public/<str:code>/<str:token>/hosts/", views.public_hosts_view),
    path("visitors/public/<str:code>/<str:token>/", views.public_view),
    path("visitors/pass/<str:code>/<str:token>/", views.public_pass_view),
    path("visitors/invites/", views.invites_view),
    path("visitors/scan/", views_v3.scan_view),
    path("visitors/id-scan/", views_v3.id_scan_view),
    path("visitors/task-options/", views_v3.task_options_view),
    path("visitors/reports/", views_v3.reports_view),
    # The Vehicle API (PLAN.md §22.12): API key, not a sign-in. The slash is optional, nothing here redirects.
    path("visitors/api-keys/", vehicle_api.api_keys_view),
    path("visitors/api-keys/<int:pk>/revoke/", vehicle_api.api_key_revoke_view),
    re_path(r"^visitors/v1/vehicles/?$", vehicle_api.vehicles),
    re_path(r"^visitors/v1/vehicles/inside/?$", vehicle_api.vehicles_inside),
    re_path(r"^visitors/v1/vehicles/summary/?$", vehicle_api.vehicles_summary),
    re_path(r"^visitors/v1/vehicles/(?P<pk>\d{1,18})/?$", vehicle_api.vehicle_detail),
    re_path(r"^visitors/v1/vehicles/(?P<pk>\d{1,18})/photos/(?P<which>in|out)/?$", vehicle_api.vehicle_photo),
    re_path(r"^visitors/v1(?:/.*)?$", vehicle_api.not_found),
] + router.urls
