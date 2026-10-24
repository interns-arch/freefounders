"""Production log reporter (tenancy/log_sink.py): off without PLATFORM_LOG_URL, never blocks, redacts, folds."""
import json
import logging
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from django.http import JsonResponse
from django.test import Client, TestCase, override_settings
from django.urls import path
from django.utils import timezone

from . import log_sink
from .management.commands import run_worker

SECRET_MESSAGE = ("bad thing password=hunter2 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl "
                  "auth Bearer abc123 mail ravi.kumar@example.com phone 9876543210 line 42")


def boom(request):
    request.company_id = "11111111-2222-3333-4444-555555555555"
    raise ValueError(SECRET_MESSAGE)


def fine(_request):
    return JsonResponse({"ok": True})


urlpatterns = [path("boom", boom), path("fine", fine)]


class _Capture(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        self.server.posts.append({"headers": {k.lower(): v for k, v in self.headers.items()}, "body": json.loads(body)})
        self.send_response(202)
        self.end_headers()

    def log_message(self, *_args):
        pass


def _closed_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@override_settings(ROOT_URLCONF=__name__)
class LogSinkTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = HTTPServer(("127.0.0.1", 0), _Capture)
        cls.server.posts = []
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}/internal/logs"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def setUp(self):
        self.server.posts.clear()
        log_sink._reset_for_tests()
        log_sink.set_service("tasks")
        self.client = Client(raise_request_exception=False)
        self._quiet = mock.patch.object(logging.getLogger("django.request"), "handlers", [])
        self._quiet.start()

    def tearDown(self):
        self._quiet.stop()
        log_sink.set_service("tasks")
        log_sink._reset_for_tests()

    def env(self, **values):
        base = {"PLATFORM_LOG_URL": self.url, "LOG_SINK_TOKEN": "", "APP_VERSION": ""}
        base.update(values)
        return mock.patch.dict(os.environ, base)

    def entries(self):
        return [e for p in self.server.posts for e in p["body"]["entries"]]

    def test_off_without_url(self):
        with mock.patch.dict(os.environ, {"PLATFORM_LOG_URL": ""}):
            res = self.client.get("/boom")
            self.assertEqual(res.status_code, 500)
            self.assertFalse(log_sink.report("error", "event", "x"))
            self.assertTrue(log_sink.flush(1))
        self.assertTrue(log_sink._queue.empty())
        self.assertEqual(self.server.posts, [])

    def test_500_is_reported_with_context_and_redacted(self):
        with self.env(LOG_SINK_TOKEN="sink-secret", APP_VERSION="1.2.3"):
            res = self.client.get("/boom?token=abc&x=1")
            self.assertEqual(res.status_code, 500)
            self.assertTrue(log_sink.flush(5))
        self.assertEqual(len(self.server.posts), 1)
        post = self.server.posts[0]
        self.assertEqual(post["headers"].get("x-log-sink-token"), "sink-secret")
        body = post["body"]
        self.assertEqual((body["service"], body["version"]), ("tasks", "1.2.3"))
        [entry] = body["entries"]
        self.assertEqual(entry["level"], "error")
        self.assertEqual(entry["kind"], "exception")
        self.assertEqual(entry["event"], "request.failed")
        self.assertEqual((entry["method"], entry["path"], entry["status"]), ("GET", "/boom", 500))
        self.assertEqual(entry["companyId"], "11111111-2222-3333-4444-555555555555")
        self.assertNotIn("userId", entry)
        self.assertEqual(entry["count"], 1)
        msg = entry["message"]
        self.assertTrue(msg.startswith("ValueError: bad thing"))
        for leaked in ("hunter2", "eyJhbGci", "abc123", "ravi.kumar", "9876543210"):
            self.assertNotIn(leaked, msg)
            self.assertNotIn(leaked, entry["stack"])
        for kept in ("password=[hidden]", "[jwt]", "Bearer [hidden]", "r***@example.com", "[digits]", "line 42"):
            self.assertIn(kept, msg)
        self.assertIn("Traceback", entry["stack"])
        self.assertLessEqual(len(entry["stack"]), log_sink.MAX_STACK)

    def test_4xx_and_ok_are_not_reported(self):
        with self.env():
            self.assertEqual(self.client.get("/fine").status_code, 200)
            self.assertEqual(self.client.get("/missing").status_code, 404)
            log_sink.flush(5)
        self.assertEqual(self.entries(), [])

    def test_sink_down_never_slows_the_request(self):
        with self.env(PLATFORM_LOG_URL=f"http://127.0.0.1:{_closed_port()}/internal/logs"):
            started = time.monotonic()
            res = self.client.get("/boom")
            self.assertEqual(res.status_code, 500)
            self.assertLess(time.monotonic() - started, 1.0)
            log_sink.flush(6)  # the send fails silently
            self.assertEqual(self.client.get("/fine").status_code, 200)

    def test_rate_limit_and_folding(self):
        with self.env():
            for _ in range(5):
                log_sink.report("error", "event", "same thing", path="/x?secret=1")
            for i in range(70):
                log_sink.report("error", "event", f"distinct {i}")
            self.assertTrue(log_sink.flush(5))
        entries = self.entries()
        self.assertEqual(len(entries), 60)  # 1 folded + 59 distinct
        folded = [e for e in entries if e["message"] == "same thing"]
        self.assertEqual(len(folded), 1)
        self.assertEqual((folded[0]["count"], folded[0]["path"]), (5, "/x"))
        self.assertTrue(all(len(p["body"]["entries"]) <= 50 for p in self.server.posts))

    def test_redaction_rules(self):
        r = log_sink.redact
        self.assertEqual(r('api_key: "sk-123"'), 'api_key=[hidden]"')
        self.assertEqual(r("OTP=4821"), "OTP=[hidden]")
        self.assertEqual(r("failed query\nparams: 'a', 'b'\nnext"), "failed query\nparams: [hidden]\nnext")
        self.assertEqual(r("x 1234567 y 12345"), "x [digits] y 12345")
        self.assertEqual(log_sink.clean_path("/api/x?code=123456"), "/api/x")

    def test_worker_failure_and_heartbeat(self):
        from accounts.models import User
        from hr.models import Attendance

        user = User.objects.create(username="punch-tester")
        Attendance.objects.create(user=user, date=timezone.localdate(), check_in=timezone.now())
        log_sink.set_service("tasks-worker")
        quiet = mock.patch.object(logging.getLogger("tenancy.worker"), "propagate", True)
        with self.env(), quiet, mock.patch.object(run_worker, "run_jobs", side_effect=RuntimeError("worker broke token=zzz")):
            punches = {}
            results = run_worker.run_pass(punches)
            run_worker.send_heartbeat(results, punches)
            self.assertTrue(log_sink.flush(5))
        self.assertEqual(results, {"default": "failed"})
        bodies = [p["body"] for p in self.server.posts]
        self.assertTrue(all(b["service"] == "tasks-worker" for b in bodies))
        [entry] = self.entries()
        self.assertEqual((entry["event"], entry["kind"], entry["level"]), ("worker.failed", "exception", "error"))
        self.assertEqual(entry["message"], "RuntimeError: worker broke token=[hidden]")
        beats = [b["heartbeat"] for b in bodies if "heartbeat" in b]
        self.assertEqual(len(beats), 1)
        self.assertEqual(beats[0]["data"], {"results": {"ok": 0, "failed": 1, "skipped": 0},
                                            "punchesToday": {"total": 1, "byCompany": {"default": 1}}})
        self.assertIn("at", beats[0])

    def test_worker_skips_punch_query_when_off(self):
        with mock.patch.dict(os.environ, {"PLATFORM_LOG_URL": ""}), \
                mock.patch.object(run_worker, "run_jobs"), \
                mock.patch.object(run_worker, "_punches_today") as counted:
            punches = {}
            self.assertEqual(run_worker.run_pass(punches), {"default": "ok"})
            run_worker.send_heartbeat({"default": "ok"}, punches)
        counted.assert_not_called()
        self.assertEqual(punches, {})
