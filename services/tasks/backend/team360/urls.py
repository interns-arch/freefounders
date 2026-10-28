from django.urls import path

from . import views

urlpatterns = [
    path("team360/", views.tiles),
    path("team360/<int:pk>/", views.person),
    path("team360/<int:pk>/attendance/", views.person_attendance),
    path("team360/<int:pk>/tasks/", views.person_tasks),
    path("team360/<int:pk>/visitors/", views.person_visitors),
]
