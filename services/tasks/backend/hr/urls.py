from django.urls import path
from rest_framework.routers import DefaultRouter

from . import roster_views, views

router = DefaultRouter()
router.register("attendance", views.AttendanceViewSet, basename="attendance")
router.register("attendance-corrections", views.CorrectionViewSet, basename="attendance-corrections")
router.register("leave-types", views.LeaveTypeViewSet, basename="leave-types")
router.register("leaves", views.LeaveRequestViewSet, basename="leaves")
router.register("office-locations", views.OfficeLocationViewSet, basename="office-locations")

urlpatterns = [
    path("hr/config/", views.hr_config),
    path("hr/settings/", views.hr_settings),
    path("hr/face/<int:user_id>/", views.face_enrolment),
    # Roster management (PLAN.md §28.6)
    path("hr/shifts/", roster_views.shifts),
    path("hr/shifts/<int:pk>/", roster_views.shift_detail),
    path("hr/roster/", roster_views.roster_view),
    path("hr/roster/mine/", roster_views.my_roster),
    path("hr/roster/import/", roster_views.roster_import),
] + router.urls
