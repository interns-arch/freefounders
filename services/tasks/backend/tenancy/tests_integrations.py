"""Settings → Integrations (PLAN.md §19.40): Owner / Admin enter the company's WhatsApp, Gmail and AI values; secrets are
write-only (never returned, only masked), stored encrypted, and every change is recorded without the value."""
import json
import os
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role, User

from .company_settings import company_env, forget
from .models import CompanySetting, SettingChange

TOKEN = "EAAG-very-secret-token-1234abcd"


def make(username, role):
    return User.objects.create_user(username, f"{username}@x.com", "pass@12345", role=role, first_name=username.title())


class IntegrationsTests(TestCase):
    def setUp(self):
        forget()
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN)
        self.rahul = make("rahul", Role.SALES_EXECUTIVE)

    def tearDown(self):
        forget()

    def as_(self, user):
        res = self.client.post("/api/auth/login", {"username": user.username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def field(self, data, key):
        return next(f for g in data["groups"] for f in g["fields"] if f["key"] == key)

    def test_only_admins(self):
        self.as_(self.rahul)
        self.assertEqual(self.client.get("/api/integrations/").status_code, 403)
        self.assertEqual(self.client.put("/api/integrations/", {"values": {"AI_MODEL": "x"}}, format="json").status_code, 403)

    def test_secret_is_write_only_masked_encrypted_and_audited(self):
        self.as_(self.admin)
        res = self.client.put("/api/integrations/", {"values": {
            "WHATSAPP_ACCESS_TOKEN": TOKEN, "WHATSAPP_PHONE_NUMBER_ID": "1234567", "WHATSAPP_ENABLED": "TRUE"}}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertNotIn(TOKEN, json.dumps(res.data))
        tok = self.field(res.data, "WHATSAPP_ACCESS_TOKEN")
        self.assertEqual((tok["set"], tok["masked"], tok["source"]), (True, "••••abcd", "company"))
        self.assertNotIn("value", tok)
        self.assertEqual(self.field(res.data, "WHATSAPP_PHONE_NUMBER_ID")["value"], "1234567")
        self.assertEqual(self.field(res.data, "WHATSAPP_ENABLED")["value"], "true")
        self.assertEqual(company_env("WHATSAPP_ACCESS_TOKEN"), TOKEN, "the app uses it")
        row = CompanySetting.objects.get(key="WHATSAPP_ACCESS_TOKEN")
        self.assertTrue(row.secret)
        self.assertNotIn(TOKEN, row.value, "stored encrypted")
        change = SettingChange.objects.filter(key="WHATSAPP_ACCESS_TOKEN").first()
        self.assertEqual((change.action, change.actor_id, change.actor_name), ("set", self.admin.id, "Boss"))
        self.assertEqual(tok["changed"]["by"], "Boss")
        self.assertNotIn(TOKEN, json.dumps(list(SettingChange.objects.values()), default=str))
        # GET never shows it either.
        self.assertNotIn(TOKEN, json.dumps(self.client.get("/api/integrations/").data))

    def test_remove_falls_back_to_the_server_value(self):
        self.as_(self.admin)
        self.client.put("/api/integrations/", {"values": {"AI_API_KEY": "sk-company-key-0000"}}, format="json")
        with mock.patch.dict(os.environ, {"AI_API_KEY": "sk-server-key-9999"}):
            res = self.client.put("/api/integrations/", {"values": {"AI_API_KEY": None}}, format="json")
            key = self.field(res.data, "AI_API_KEY")
            self.assertEqual((key["set"], key["source"], key["masked"]), (True, "server", "Set on the server"))
            self.assertEqual(company_env("AI_API_KEY"), "sk-server-key-9999")
        self.assertFalse(CompanySetting.objects.filter(key="AI_API_KEY").exists())
        self.assertEqual(SettingChange.objects.filter(key="AI_API_KEY").first().action, "removed")

    def test_unknown_and_bad_values(self):
        self.as_(self.admin)
        self.assertEqual(self.client.put("/api/integrations/", {"values": {"SECRET_KEY": "x"}}, format="json").status_code, 400)
        self.assertEqual(self.client.put("/api/integrations/", {"values": {"AI_ENABLED": "maybe"}}, format="json").status_code, 400)
        self.assertEqual(self.client.put("/api/integrations/", {"values": {}}, format="json").status_code, 400)
