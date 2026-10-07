"""FreeFounders Platform sign-in: Platform tokens work next to the app's own login."""
import json
import time
import uuid

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User

ISS, AUD = "freefounders-platform", "freefounders"


def make_key(kid):
    private = Ed25519PrivateKey.generate()
    public = json.loads(jwt.algorithms.OKPAlgorithm.to_jwk(private.public_key()))
    return private, {**public, "kid": kid, "alg": "EdDSA", "use": "sig"}


KEY, JWK = make_key("k1")
OTHER_KEY, _ = make_key("k1")  # same kid, different key: a forgery
JWKS = json.dumps({"keys": [JWK]})


def token(sub, apps, *, key=KEY, aud=AUD, iss=ISS, ttl=900, kid="k1"):
    now = int(time.time())
    claims = {"sub": str(sub), "cid": str(uuid.uuid4()), "apps": apps, "role": "member",
              "iss": iss, "aud": aud, "iat": now, "exp": now + ttl}
    return jwt.encode(claims, key, algorithm="EdDSA", headers={"kid": kid})


@override_settings(PLATFORM_JWKS=JWKS)
class PlatformTokenTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.person = uuid.uuid4()
        self.u = User.objects.create_user("mia", "mia@x.com", "pass@12345", role=Role.WAREHOUSE,
                                          department="warehouse", platform_person_id=self.person)

    def me(self, tok):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        return self.client.get("/api/auth/me")

    def test_valid_token_signs_in_as_the_linked_user(self):
        res = self.me(token(self.person, {"tasks": str(self.u.pk)}))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["username"], "mia")
        self.assertIn("capabilities", res.data)          # same "me" the web app reads today

    def test_rejected_tokens(self):
        cases = {
            "expired": token(self.person, {"tasks": str(self.u.pk)}, ttl=-120),
            "forged with another key": token(self.person, {"tasks": str(self.u.pk)}, key=OTHER_KEY),
            "unknown key id": token(self.person, {"tasks": str(self.u.pk)}, kid="nope"),
            "wrong audience": token(self.person, {"tasks": str(self.u.pk)}, aud="tasks-internal"),
            "wrong issuer": token(self.person, {"tasks": str(self.u.pk)}, iss="someone-else"),
            "no Tasks access": token(self.person, {"assets": "x"}),
            "points at another person's user": token(uuid.uuid4(), {"tasks": str(self.u.pk)}),
            "unknown user": token(self.person, {"tasks": "999999"}),
        }
        for name, tok in cases.items():
            with self.subTest(name):
                self.assertEqual(self.me(tok).status_code, 401)

    def test_inactive_user_is_refused(self):
        self.u.is_active = False
        self.u.save()
        self.assertEqual(self.me(token(self.person, {"tasks": str(self.u.pk)})).status_code, 401)

    def test_app_login_still_works_alongside(self):
        res = self.client.post("/api/auth/login", {"username": "mia", "password": "pass@12345"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.me(res.data["access"]).status_code, 200)


class PlatformOffTests(TestCase):
    """Without PLATFORM_JWKS(_URL) the app behaves exactly as before."""

    def test_platform_token_ignored_when_not_configured(self):
        person = uuid.uuid4()
        u = User.objects.create_user("x", "x@x.com", "pass@12345", platform_person_id=person)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token(person, {'tasks': str(u.pk)})}")
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        self.assertEqual(client.post("/api/internal/provision", {}, format="json").status_code, 401)


@override_settings(PLATFORM_JWKS=JWKS)
class ProvisionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.service_token()}")

    @staticmethod
    def service_token(aud="tasks-internal", sub="platform"):
        return token(sub, {}, aud=aud)

    def provision(self, **body):
        payload = {"personId": str(uuid.uuid4()), "fullName": "Nina New", "email": None,
                   "employeeCode": None, "mobile": None, "username": None, **body}
        return self.client.post("/api/internal/provision", payload, format="json")

    def test_needs_a_platform_service_token(self):
        for tok in (None, token(uuid.uuid4(), {"tasks": "1"}), self.service_token(sub="someone")):
            with self.subTest(tok=tok and tok[:12]):
                c = APIClient()
                if tok:
                    c.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
                self.assertEqual(c.post("/api/internal/provision", {}, format="json").status_code, 401)

    def test_creates_a_user_with_no_local_password(self):
        person = str(uuid.uuid4())
        res = self.provision(personId=person, fullName="Nina New", email="Nina@X.com", username="nina",
                             mobile="+91 98765 43210", appRole="warehouse_manager")
        self.assertEqual(res.status_code, 201)
        u = User.objects.get(pk=res.data["userId"])
        self.assertEqual((u.username, u.first_name, u.last_name, u.email), ("nina", "Nina", "New", "nina@x.com"))
        self.assertEqual((u.role, u.department), ("warehouse_manager", "warehouse"))
        self.assertEqual(u.whatsapp_phone, "+919876543210")
        self.assertEqual(str(u.platform_person_id), person)
        self.assertFalse(u.has_usable_password())

    def test_is_idempotent(self):
        person = str(uuid.uuid4())
        first = self.provision(personId=person, username="nina")
        second = self.provision(personId=person, username="nina")
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.data["userId"], second.data["userId"])

    def test_links_an_existing_user_by_email_then_username(self):
        by_email = User.objects.create_user("old1", "Old@X.com", "pass@12345")
        by_name = User.objects.create_user("old2", "", "pass@12345")
        r1 = self.provision(email="old@x.com", username="ignored")
        r2 = self.provision(username="OLD2")
        self.assertEqual((r1.status_code, r1.data["userId"]), (200, by_email.pk))
        self.assertEqual((r2.status_code, r2.data["userId"]), (200, by_name.pk))
        by_email.refresh_from_db()
        self.assertTrue(by_email.has_usable_password(), "existing local login keeps working")

    def test_never_steals_a_user_linked_to_someone_else(self):
        User.objects.create_user("taken", "taken@x.com", "pass@12345", platform_person_id=uuid.uuid4())
        self.assertEqual(self.provision(email="taken@x.com").status_code, 409)

    def test_unknown_role_falls_back_and_usernames_stay_unique(self):
        User.objects.create_user("nina", "", "pass@12345")
        res = self.provision(username=None, email="nina@elsewhere.com", appRole="emperor")
        u = User.objects.get(pk=res.data["userId"])
        self.assertEqual(u.username, "nina-2")
        self.assertEqual(u.role, Role.SALES_EXECUTIVE)

    def test_bad_input(self):
        self.assertEqual(self.provision(personId="not-a-uuid").status_code, 400)
        self.assertEqual(self.provision(fullName="  ").status_code, 400)
