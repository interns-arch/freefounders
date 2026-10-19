from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from tenancy.views import create_company

from crm import internal_flows

from . import internal, views
from .serializers import FlexibleLoginSerializer

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="users")

urlpatterns = [
    path("auth/login", TokenObtainPairView.as_view(serializer_class=FlexibleLoginSerializer)),
    path("auth/refresh", TokenRefreshView.as_view()),
    path("auth/logout", views.logout),
    path("auth/me", views.me),
    path("auth/change-password", views.change_password),
    path("internal/provision", internal.provision),
    path("internal/roles", internal.roles),
    path("internal/permissions", internal.permissions),
    path("internal/access", internal.access),
    path("internal/modules", internal.modules),
    path("internal/company", internal.company),
    path("internal/people", internal.people),
    path("internal/unlinked-people", internal.delete_unlinked_people),
    path("internal/people/<str:person_id>", internal.delete_person),
    path("internal/events", internal_flows.events),
    path("internal/tasks", internal_flows.create_task),
    path("internal/exit-tasks", internal_flows.exit_tasks),
    path("internal/companies", create_company),
    path("team/", views.team_directory),
    path("roles/", views.roles),
    path("departments/", views.departments),
    path("departments/<slug:code>/", views.department_detail),
    path("", include(router.urls)),
]
