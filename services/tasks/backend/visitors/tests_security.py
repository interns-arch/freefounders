"""Security audit 2026-10-29: signed-out visitor pages refuse oversized bodies unread, photos claiming a huge canvas are
refused before decoding, and the paid AI ID-card reader is rate limited."""
import base64
import io

from django.test import SimpleTestCase, TestCase
from PIL import Image
from rest_framework.exceptions import ValidationError

from config.throttles import AIThrottle

from . import services as sv
from .views_v3 import id_scan_view


def png(width, height) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (width, height)).save(buf, "PNG")
    return buf.getvalue()


class PublicBodyLimitTests(TestCase):
    def test_oversized_public_body_is_refused_before_parsing(self):
        res = self.client.generic("POST", "/api/visitors/public/ACME/sometoken/", b"{}", content_type="application/json",
                                  CONTENT_LENGTH=str(3 * 1024 * 1024))
        self.assertEqual(res.status_code, 413)
        res = self.client.generic("POST", "/api/visitors/pass/ACME/sometoken/", b"{}", content_type="application/json",
                                  CONTENT_LENGTH=str(3 * 1024 * 1024))
        self.assertEqual(res.status_code, 413)

    def test_normal_public_body_reaches_the_view(self):
        res = self.client.post("/api/visitors/public/ACME/sometoken/", {"name": "x"}, content_type="application/json")
        self.assertNotEqual(res.status_code, 413)


class PhotoPixelLimitTests(SimpleTestCase):
    def test_huge_canvas_in_a_small_file_is_refused(self):
        raw = png(5000, 5000)  # 25 million pixels, a few KB
        self.assertLess(len(raw), sv.PUBLIC_PHOTO_MAX)
        with self.assertRaises(ValidationError):
            sv.decode_photo(base64.b64encode(raw).decode(), sv.PUBLIC_PHOTO_MAX)

    def test_phone_sized_photo_passes(self):
        raw = png(1200, 1600)
        self.assertEqual(sv.decode_photo("data:image/png;base64," + base64.b64encode(raw).decode()), raw)


class IdScanThrottleTests(SimpleTestCase):
    def test_id_scan_uses_the_ai_throttle(self):
        self.assertIn(AIThrottle, id_scan_view.cls.throttle_classes)
