from django.apps import AppConfig
from django.db.backends.signals import connection_created


class TenancyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tenancy"

    def ready(self):
        from .schemas import on_connect

        connection_created.connect(on_connect, dispatch_uid="tenancy-search-path")
