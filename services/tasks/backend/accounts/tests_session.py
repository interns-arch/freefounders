"""Stay signed in for a year, but deactivating someone still cuts them off."""
from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role, User


class LongSessionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.u = User.objects.create_user("phone", "p@x.com", "pass@12345",
                                          role=Role.SALES_EXECUTIVE, department="sales")
        res = self.client.post("/api/auth/login", {"username": "phone", "password": "pass@12345"})
        self.access, self.refresh = res.data["access"], res.data["refresh"]

    def test_refresh_lasts_a_year_and_rotates(self):
        self.assertGreaterEqual(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"], timedelta(days=365))
        res = self.client.post("/api/auth/refresh", {"refresh": self.refresh})
        self.assertEqual(res.status_code, 200)
        self.assertNotEqual(res.data["refresh"], self.refresh)      # rotated: a fresh year

    def test_deactivated_user_is_cut_off(self):
        self.u.is_active = False
        self.u.save()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.access}")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/auth/refresh", {"refresh": self.refresh}).status_code, 401)
