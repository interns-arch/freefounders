from django.apps import AppConfig
from django.db.backends.signals import connection_created


class TenancyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tenancy"

    def ready(self):
        from .schemas import on_connect

        connection_created.connect(on_connect, dispatch_uid="tenancy-search-path")

        # Production log to the Platform (no-op unless PLATFORM_LOG_URL is set).
        from .log_sink import install

        install()
