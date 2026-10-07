import hashlib
import hmac
import json
import os
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Role, User
from crm.models import AssignmentRule, Lead
from notifications.models import Notification

from .ai import classify
from .models import InboundMessage
from .pipeline import process_message


def make(username, role, department="sales"):
    return User.objects.create_user(username, f"{username}@x.com", "pass@12345",
                                    role=role, department=department)


def wa_payload(msg_id, sender, text, name="Test Customer"):
    return {
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": sender, "profile": {"name": name}}],
            "messages": [{"id": msg_id, "from": sender, "type": "text",
                          "text": {"body": text}}],
        }}]}],
    }


class AiOffMixin:
    """The suite must never call a live model: a real AI key in the
    developer's .env otherwise turns these into flaky network tests."""
    def setUp(self):
        super().setUp()
        patcher = mock.patch.dict("os.environ", {"AI_ENABLED": "false"})
        patcher.start()
        self.addCleanup(patcher.stop)


class RulesClassifierTests(AiOffMixin, TestCase):
    def test_spec_example_brake_pad_tata_407(self):
        # The exact example from the requirements document
        r = classify("Need brake pad and oil filter for Tata 407.", "Suresh")
        self.assertEqual(r["intent"], "purchase")
        self.assertEqual(r["vehicle"], "tata 407")
        names = [i["name"] for i in r["items"]]
        self.assertIn("brake pad", names)
        self.assertIn("oil filter", names)
        self.assertEqual(r["priority"], "normal")
        self.assertEqual(r["department"], "sales")
        self.assertEqual(r["provider"], "rules")

    def test_urgent_support_message(self):
        r = classify("My clutch plate is defective, urgent replacement needed", "")
        self.assertEqual(r["intent"], "support")
        self.assertEqual(r["department"], "support")
        self.assertEqual(r["priority"], "urgent")

    def test_accounts_message(self):
        r = classify("Please share the invoice for last month's payment", "")
        self.assertEqual(r["department"], "accounts")

    def test_spam(self):
        r = classify("OFFER!! click here to win a lottery", "")
        self.assertEqual(r["intent"], "spam")

    def test_quantity_extraction(self):
        r = classify("Need 4 pcs brake pad and 2 oil filter for Tata Ace", "")
        by_name = {i["name"]: i["quantity"] for i in r["items"]}
        self.assertEqual(by_name.get("brake pad"), 4)
        self.assertEqual(by_name.get("oil filter"), 2)


ANSWER = {
    "intent": "purchase", "customer_name": "Suresh Kumar",
    "vehicle": "Tata 407", "items": [{"name": "Brake Pad", "quantity": None}],
    "priority": "normal", "department": "sales", "summary": "Brake pads for Tata 407",
}


class AiProviderTests(TestCase):
    """The client is provider-agnostic now: an nvapi- key talks to NVIDIA in
    the OpenAI format, an sk-ant- key talks to Anthropic in its own."""

    @mock.patch.dict("os.environ", {"AI_ENABLED": "true", "AI_API_KEY": "nvapi-test",
                                    "AI_PROVIDER": "", "AI_MODEL": ""})
    @mock.patch("config.llm.requests.post")
    def test_nvidia_key_uses_the_openai_shape(self, post):
        post.return_value = mock.Mock(status_code=200, json=lambda: {
            "choices": [{"message": {"content": json.dumps(ANSWER)}}]})
        r = classify("Need brake pad for Tata 407", "Suresh")
        self.assertEqual(r["provider"], "nvidia")
        self.assertEqual(r["customer_name"], "Suresh Kumar")
        self.assertIn("integrate.api.nvidia.com", post.call_args.args[0])
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["messages"][0]["role"], "system")
        self.assertIn("classify", body["messages"][0]["content"].lower())

    @mock.patch.dict("os.environ", {"AI_ENABLED": "true", "AI_API_KEY": "sk-ant-test",
                                    "AI_PROVIDER": "", "AI_MODEL": ""})
    @mock.patch("config.llm.requests.post")
    def test_anthropic_key_uses_the_anthropic_shape(self, post):
        post.return_value = mock.Mock(status_code=200, json=lambda: {
            "content": [{"type": "text", "text": json.dumps(ANSWER)}]})
        r = classify("Need brake pad for Tata 407", "Suresh")
        self.assertEqual(r["provider"], "anthropic")
        self.assertIn("api.anthropic.com", post.call_args.args[0])
        self.assertIn("classify", post.call_args.kwargs["json"]["system"].lower())

    @mock.patch.dict("os.environ", {"AI_ENABLED": "true", "AI_API_KEY": "nvapi-test"})
    @mock.patch("config.llm.requests.post")
    def test_provider_failure_falls_back_to_rules(self, post):
        post.return_value = mock.Mock(status_code=500, text="boom")
        r = classify("Need brake pad for Tata 407", "")
        self.assertEqual(r["provider"], "rules")
        self.assertEqual(r["intent"], "purchase")

    @mock.patch.dict("os.environ", {"AI_ENABLED": "true", "AI_API_KEY": "nvapi-test"})
    @mock.patch("config.llm.requests.post")
    def test_prose_around_the_json_is_tolerated(self, post):
        """Small models like to think out loud before the JSON."""
        post.return_value = mock.Mock(status_code=200, json=lambda: {
            "choices": [{"message": {"content":
                "Let me think about this." + "\n"
                + json.dumps(ANSWER)}}]})
        r = classify("Need brake pad for Tata 407", "Suresh")
        self.assertEqual(r["customer_name"], "Suresh Kumar")


class PipelineTests(AiOffMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.rahul = make("rahul", Role.SALES_EXECUTIVE)
        self.amit = make("amit", Role.SALES_EXECUTIVE)
        AssignmentRule.objects.create(department="sales", strategy="round_robin",
                                      member_ids=[self.rahul.pk, self.amit.pk])

    def inbound(self, body, sender="919876543210", channel="whatsapp", **kw):
        n = InboundMessage.objects.count()
        return InboundMessage.objects.create(
            channel=channel, external_id=f"t-{n}", sender=sender,
            sender_name="Suresh", body=body, **kw)

    def test_new_whatsapp_message_creates_assigned_lead(self):
        msg = process_message(self.inbound("Need brake pad and oil filter for Tata 407."))
        self.assertEqual(msg.status, "processed")
        lead = msg.lead
        self.assertEqual(lead.source, "whatsapp")
        self.assertEqual(lead.phone, "919876543210")
        self.assertEqual(lead.assigned_to, self.rahul)       # round-robin #1
        self.assertIn("brake pad", lead.requirement)
        self.assertIn("tata 407", lead.requirement)
        self.assertEqual(lead.ai_meta["classification"]["intent"], "purchase")
        self.assertTrue(Notification.objects.filter(user=self.rahul, type="lead_assigned").exists())

    def test_followup_message_updates_existing_lead(self):
        first = process_message(self.inbound("Need brake pad for Tata 407"))
        lead = first.lead
        second = process_message(self.inbound("Also need wiper blades please"))
        self.assertEqual(second.lead, lead)                   # matched by phone
        self.assertEqual(Lead.objects.count(), 1)             # no duplicate lead
        events = lead.events.filter(type="wa_in")
        self.assertEqual(events.count(), 2)
        self.assertTrue(Notification.objects.filter(user=self.rahul, type="customer_message").exists())

    def test_gmail_message_matches_by_email(self):
        Lead.objects.create(customer_name="Sunita", email="sunita@x.com",
                            department="sales", assigned_to=self.amit)
        msg = process_message(self.inbound("Any update on my quotation?",
                                           sender="sunita@x.com", channel="gmail",
                                           subject="Quotation follow-up"))
        self.assertEqual(msg.lead.customer_name, "Sunita")
        self.assertEqual(msg.lead.events.filter(type="email_in").count(), 1)

    def test_spam_is_ignored_no_lead(self):
        msg = process_message(self.inbound("OFFER!! click here to win a lottery"))
        self.assertEqual(msg.status, "ignored")
        self.assertIsNone(msg.lead)
        self.assertEqual(Lead.objects.count(), 0)


@override_settings(ALLOWED_HOSTS=["testserver"])
class WebhookTests(AiOffMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.rahul = make("rahul", Role.SALES_EXECUTIVE)
        AssignmentRule.objects.create(department="sales", member_ids=[self.rahul.pk])
        # the suite must not depend on the developer's .env: a real
        # WHATSAPP_APP_SECRET there makes the webhook demand a signature
        patcher = mock.patch.dict("os.environ", {"WHATSAPP_APP_SECRET": ""})
        patcher.start()
        self.addCleanup(patcher.stop)
        # intake defaults OFF since 07 Sep; these tests are about what the
        # pipeline does once it is switched on. IntakeSwitchTests owns the
        # default.
        on = mock.patch.dict("os.environ", {"INTAKE_ENABLED": "true"})
        on.start()
        self.addCleanup(on.stop)


    def test_get_verify_handshake(self):
        with mock.patch.dict("os.environ", {"WHATSAPP_WEBHOOK_VERIFY_TOKEN": "tok123"}):
            res = self.client.get("/api/webhooks/whatsapp", {
                "hub.mode": "subscribe", "hub.verify_token": "tok123", "hub.challenge": "42",
            })
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.content, b"42")
            res = self.client.get("/api/webhooks/whatsapp", {
                "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42",
            })
            self.assertEqual(res.status_code, 403)

    def test_post_creates_lead_end_to_end(self):
        payload = wa_payload("wamid.1", "919876543210", "Need brake pad and oil filter for Tata 407.")
        res = self.client.post("/api/webhooks/whatsapp", json.dumps(payload),
                               content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["ingested"], 1)
        lead = Lead.objects.get()
        self.assertEqual(lead.assigned_to, self.rahul)
        self.assertEqual(lead.source, "whatsapp")

    def test_duplicate_delivery_is_idempotent(self):
        payload = wa_payload("wamid.dup", "919876543210", "Need brake pad")
        for _ in range(2):
            self.client.post("/api/webhooks/whatsapp", json.dumps(payload),
                             content_type="application/json")
        self.assertEqual(InboundMessage.objects.count(), 1)
        self.assertEqual(Lead.objects.count(), 1)

    def test_bad_signature_rejected_when_secret_set(self):
        payload = json.dumps(wa_payload("wamid.sig", "919876543210", "hi"))
        with mock.patch.dict("os.environ", {"WHATSAPP_APP_SECRET": "shh"}):
            res = self.client.post("/api/webhooks/whatsapp", payload,
                                   content_type="application/json",
                                   headers={"X-Hub-Signature-256": "sha256=wrong"})
            self.assertEqual(res.status_code, 403)
            good = hmac.new(b"shh", payload.encode(), hashlib.sha256).hexdigest()
            res = self.client.post("/api/webhooks/whatsapp", payload,
                                   content_type="application/json",
                                   headers={"X-Hub-Signature-256": f"sha256={good}"})
            self.assertEqual(res.status_code, 200)


class IntakeApiTests(AiOffMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN, "management")
        self.exec_ = make("neha", Role.SALES_EXECUTIVE)
        # intake defaults OFF since 07 Sep; these tests are about what the
        # pipeline does once it is switched on. IntakeSwitchTests owns the
        # default.
        on = mock.patch.dict("os.environ", {"INTAKE_ENABLED": "true"})
        on.start()
        self.addCleanup(on.stop)


    def as_(self, username):
        res = self.client.post("/api/auth/login", {"username": username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_intake_list_requires_capability(self):
        self.as_("neha")
        self.assertEqual(self.client.get("/api/intake/").status_code, 403)
        self.as_("boss")
        self.assertEqual(self.client.get("/api/intake/").status_code, 200)

    def test_simulate_runs_pipeline(self):
        self.as_("boss")
        res = self.client.post("/api/intake/simulate/", {
            "channel": "whatsapp", "sender": "919000000001",
            "sender_name": "Demo", "body": "Need clutch plate for Ashok Leyland Dost",
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "processed")
        self.assertIsNotNone(res.data["lead"])
        self.assertEqual(res.data["ai_result"]["vehicle"], "ashok leyland dost")

    def test_simulate_admin_only(self):
        self.as_("neha")
        res = self.client.post("/api/intake/simulate/", {
            "channel": "whatsapp", "sender": "1", "body": "x",
        })
        self.assertEqual(res.status_code, 403)


class IntakeSwitchTests(TestCase):
    """Inbound messages are not recorded unless somebody asks for them.

    The WhatsApp webhook was pointed back at this server on 07 Sep so that
    Meta's DELIVERY reports could be read. Within the hour the pipeline had
    turned staff chatter into ten leads. The two halves arrive on the same
    webhook, so the switch sits between them: statuses always, messages only
    on request.
    """

    URL = "/api/webhooks/whatsapp"

    def setUp(self):
        os.environ.pop("INTAKE_ENABLED", None)      # default: off
        os.environ["WHATSAPP_APP_SECRET"] = ""      # unsigned posts in tests
        self.client = APIClient()

    def tearDown(self):
        os.environ.pop("INTAKE_ENABLED", None)

    def a_message(self):
        return {"entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": "918800556388", "profile": {"name": "Yash"}}],
            "messages": [{"id": "wamid.IN99", "from": "918800556388",
                          "type": "text", "text": {"body": "hi"}}],
        }}]}]}

    def a_status(self, wamid="wamid.OUT1", status="delivered"):
        return {"entry": [{"changes": [{"value": {
            "statuses": [{"id": wamid, "status": status,
                          "recipient_id": "918800556388"}]}}]}]}

    # ---- the messages half -------------------------------------------------
    def test_an_inbound_message_is_not_recorded_by_default(self):
        from .models import InboundMessage
        res = self.client.post(self.URL, self.a_message(), format="json")
        self.assertEqual(res.status_code, 200)      # Meta must get a 200
        self.assertEqual(InboundMessage.objects.count(), 0)

    def test_no_lead_is_created_from_it(self):
        from crm.models import Lead
        self.client.post(self.URL, self.a_message(), format="json")
        self.assertEqual(Lead.objects.count(), 0)

    def test_switching_it_on_records_again(self):
        from .models import InboundMessage
        os.environ["INTAKE_ENABLED"] = "true"
        self.client.post(self.URL, self.a_message(), format="json")
        self.assertEqual(InboundMessage.objects.count(), 1)

    # ---- the statuses half must be untouched -------------------------------
    def test_delivery_reports_still_arrive_while_intake_is_off(self):
        """The reason the webhook exists at all now."""
        from notifications.delivery import WhatsAppDelivery
        row = WhatsAppDelivery.objects.create(wamid="wamid.OUT1", phone="918800556388",
                                              status="accepted")
        res = self.client.post(self.URL, self.a_status(), format="json")
        self.assertEqual(res.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.status, "delivered")

    def test_a_failure_report_still_arrives_too(self):
        from notifications.delivery import WhatsAppDelivery
        row = WhatsAppDelivery.objects.create(wamid="wamid.OUT2", phone="918800556388",
                                              status="accepted")
        body = {"entry": [{"changes": [{"value": {"statuses": [
            {"id": "wamid.OUT2", "status": "failed",
             "errors": [{"code": 131042, "title": "Business eligibility payment issue"}]}]}}]}]}
        self.client.post(self.URL, body, format="json")
        row.refresh_from_db()
        self.assertEqual(row.status, "failed")
        self.assertIn("131042", row.detail)

    def test_one_payload_carrying_both_keeps_the_status_and_drops_the_message(self):
        from .models import InboundMessage
        from notifications.delivery import WhatsAppDelivery
        row = WhatsAppDelivery.objects.create(wamid="wamid.OUT3", phone="918800556388",
                                              status="accepted")
        body = self.a_message()
        body["entry"][0]["changes"][0]["value"]["statuses"] = [
            {"id": "wamid.OUT3", "status": "read"}]
        self.client.post(self.URL, body, format="json")
        row.refresh_from_db()
        self.assertEqual(row.status, "read")            # kept
        self.assertEqual(InboundMessage.objects.count(), 0)   # dropped

    # ---- the other two doors ----------------------------------------------
    def test_the_simulator_says_why_it_will_not_run(self):
        from accounts.models import Role, User
        User.objects.create_user("sim.boss", "s@x.com", "pass@12345",
                                 role=Role.ADMIN, department="management")
        res = self.client.post("/api/auth/login",
                               {"username": "sim.boss", "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        out = self.client.post("/api/intake/simulate/", {
            "channel": "whatsapp", "sender": "919876543210",
            "sender_name": "Test", "subject": "", "body": "need brake pads"},
            format="json")
        self.assertEqual(out.status_code, 400)
        self.assertIn("INTAKE_ENABLED", str(out.data))

    def test_the_flag_is_read_fresh_every_time(self):
        """No import-time caching -- flipping the env var must take effect."""
        from .pipeline import intake_enabled
        self.assertFalse(intake_enabled())
        os.environ["INTAKE_ENABLED"] = "true"
        self.assertTrue(intake_enabled())
        os.environ["INTAKE_ENABLED"] = "false"
        self.assertFalse(intake_enabled())
