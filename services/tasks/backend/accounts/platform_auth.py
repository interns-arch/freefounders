"""FreeFounders Platform sign-in.

The Platform issues EdDSA (Ed25519) access tokens and publishes its public
keys as JWKS. This class accepts those tokens alongside SimpleJWT: a token
that is not EdDSA is left to SimpleJWT untouched, so the existing login,
refresh and every existing test behave exactly as before.

Off unless PLATFORM_JWKS_URL (or PLATFORM_JWKS, the key set inline) is set.
"""
import json

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

from .models import User

ISSUER = "freefounders-platform"
ACCESS_AUDIENCE = "freefounders"
APP = "tasks"
LEEWAY_SECONDS = 30

_clients: dict[str, jwt.PyJWKClient] = {}


def enabled() -> bool:
    return bool(getattr(settings, "PLATFORM_JWKS", "") or getattr(settings, "PLATFORM_JWKS_URL", ""))


def _is_platform_token(token: str) -> bool:
    try:
        return jwt.get_unverified_header(token).get("alg") == "EdDSA"
    except jwt.PyJWTError:
        return False


def _signing_key(token: str):
    inline = getattr(settings, "PLATFORM_JWKS", "")
    if inline:
        kid = jwt.get_unverified_header(token).get("kid")
        keys = jwt.PyJWKSet.from_dict(json.loads(inline) if isinstance(inline, str) else inline).keys
        for key in keys:
            if key.key_id == kid:
                return key.key
        raise jwt.PyJWKClientError(f"Unknown signing key {kid}")
    url = settings.PLATFORM_JWKS_URL
    client = _clients.get(url)
    if client is None:
        # Keys are cached; an unknown kid (after a key rotation) triggers one refetch.
        client = _clients[url] = jwt.PyJWKClient(url, cache_keys=True, lifespan=600, timeout=5)
    return client.get_signing_key_from_jwt(token).key


def verify(token: str, audience: str) -> dict:
    """Verified claims of a Platform token, or AuthenticationFailed."""
    try:
        return jwt.decode(
            token,
            _signing_key(token),
            algorithms=["EdDSA"],
            audience=audience,
            issuer=ISSUER,
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise exceptions.AuthenticationFailed("Session expired", code="token_expired")
    except jwt.PyJWKClientConnectionError:
        raise exceptions.AuthenticationFailed("Sign-in service unavailable", code="platform_unavailable")
    except (jwt.PyJWTError, ValueError):
        raise exceptions.AuthenticationFailed("Invalid sign-in token", code="token_invalid")


def bearer(request) -> str | None:
    header = authentication.get_authorization_header(request).split()
    if len(header) != 2 or header[0].lower() != b"bearer":
        return None
    try:
        return header[1].decode()
    except UnicodeError:
        return None


class PlatformJWTAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):
        if not enabled():
            return None
        token = bearer(request)
        if not token or not _is_platform_token(token):
            return None  # not ours: SimpleJWT handles it
        claims = verify(token, ACCESS_AUDIENCE)

        local_id = (claims.get("apps") or {}).get(APP)
        if not local_id:
            raise exceptions.AuthenticationFailed("You do not have access to Tasks", code="no_app_access")
        try:
            user = User.objects.get(pk=int(local_id))
        except (User.DoesNotExist, ValueError, TypeError):
            raise exceptions.AuthenticationFailed("Invalid sign-in token", code="token_invalid")
        # The token must name the person this user was provisioned for.
        if str(user.platform_person_id or "") != str(claims["sub"]):
            raise exceptions.AuthenticationFailed("Invalid sign-in token", code="token_invalid")
        if not user.is_active:
            raise exceptions.AuthenticationFailed("User is inactive", code="user_inactive")
        return user, claims

    def authenticate_header(self, request):
        return 'Bearer realm="api"'
