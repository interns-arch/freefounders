"""Rate limits for the calls that cost money or CPU (REST_FRAMEWORK DEFAULT_THROTTLE_RATES)."""
from rest_framework.throttling import UserRateThrottle


class AIThrottle(UserRateThrottle):
    """AI drafting, proofreading, voice notes, summaries and mistake suggestions: each call is a paid AI request.
    Keyed per company and person (user ids repeat across company schemas)."""
    scope = "ai"

    def get_cache_key(self, request, view):
        from tenancy.schemas import current

        key = super().get_cache_key(request, view)
        return f"{key}:{current() or '-'}" if key else key
