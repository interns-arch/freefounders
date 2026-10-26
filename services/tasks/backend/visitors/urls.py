from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("visitors/visits", views.VisitViewSet, basename="visitor-visits")
router.register("visitors/vehicles", views.VehicleViewSet, basename="visitor-vehicles")
router.register("visitors/activity", views.ActivityViewSet, basename="visitor-activity")
router.register("visitors/deliveries", views.DeliveryViewSet, basename="visitor-deliveries")
router.register("visitors/watchlist", views.WatchViewSet, basename="visitor-watchlist")

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
] + router.urls
