from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = 'accounts'

    def ready(self):
        from django.db.models.signals import post_delete, post_save

        from .access import forget
        from .models import AccessGrant, AccessRole, UserAccessRole

        # A role or grant changed in this process: the next check reads the database again.
        for model in (AccessRole, AccessGrant, UserAccessRole):
            post_save.connect(lambda **kw: forget(), sender=model, weak=False, dispatch_uid=f"access-forget-save-{model.__name__}")
            post_delete.connect(lambda **kw: forget(), sender=model, weak=False, dispatch_uid=f"access-forget-delete-{model.__name__}")
