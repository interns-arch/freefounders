"""Smaller photos (PLAN.md §19.20): the server re-encodes every uploaded photo, punch photos included."""
import base64
import io
import shutil
import tempfile
from datetime import timedelta

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import Role, User
from config.images import DOCUMENT, PHOTO, SELFIE, compress_image, compress_upload
from hr.models import Attendance
from tenancy.company_settings import forget


def noisy_jpeg(w=3000, h=2000, quality=92, exif=None, sigma=40) -> bytes:
    """A phone-like photo: detail everywhere, so it does not compress to nothing."""
    noise = Image.effect_noise((w, h), sigma)
    img = Image.merge("RGB", (noise, noise.transpose(Image.FLIP_LEFT_RIGHT), noise.transpose(Image.FLIP_TOP_BOTTOM)))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=quality, **({"exif": exif} if exif is not None else {}))
    return out.getvalue()


def with_orientation_and_gps(orientation=6):
    exif = Image.Exif()
    exif[0x0112] = orientation                      # Orientation
    exif[0x8825] = {1: "N", 2: (12.0, 58.0, 1.0)}   # GPSInfo
    return exif


def size_of(data: bytes):
    with Image.open(io.BytesIO(data)) as img:
        return img.size, img.format, dict(img.getexif())


class CompressImageTests(SimpleTestCase):
    def test_a_big_photo_shrinks_to_the_preset(self):
        raw = noisy_jpeg()
        for preset in (DOCUMENT, PHOTO, SELFIE):
            with self.subTest(preset=preset):
                data, ext = compress_image(raw, *preset)
                (w, h), fmt, _ = size_of(data)
                self.assertEqual(ext, "jpg")
                self.assertEqual(fmt, "JPEG")
                self.assertEqual(max(w, h), preset[0])
                self.assertLess(len(data), len(raw) / 2)

    def test_exif_orientation_is_applied_and_metadata_dropped(self):
        raw = noisy_jpeg(exif=with_orientation_and_gps(6))
        self.assertIn(0x8825, size_of(raw)[2], "the test photo carries GPS")
        data, ext = compress_image(raw, *PHOTO)
        (w, h), _, exif = size_of(data)
        self.assertEqual((w, h), (1067, 1600), "turned upright: the phone was held upright")
        self.assertEqual(exif, {}, "no orientation, no GPS left")

    def test_files_that_are_not_photos_are_untouched(self):
        gif = io.BytesIO()
        Image.new("P", (3000, 2000)).save(gif, "GIF")
        for raw in (b"%PDF-1.7 a document", b"PK\x03\x04 spreadsheet", gif.getvalue(),
                    b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"\xff\xd8\xff broken jpeg", b""):
            with self.subTest(raw=raw[:12]):
                self.assertEqual(compress_image(raw, *DOCUMENT), (raw, None))

    def test_never_bigger(self):
        tiny = io.BytesIO()
        Image.new("RGB", (64, 64), (200, 10, 10)).save(tiny, "PNG")  # ~200 bytes; any JPEG is bigger
        self.assertEqual(compress_image(tiny.getvalue(), *DOCUMENT), (tiny.getvalue(), None))
        # …unless the caller needs a JPEG whatever the size.
        data, ext = compress_image(self._png(8, 8), *SELFIE, always=True)
        self.assertEqual((ext, size_of(data)[1]), ("jpg", "JPEG"))

    def test_a_transparent_png_becomes_a_jpeg_on_white(self):
        data, ext = compress_image(self._png(2400, 1200, alpha=True), *DOCUMENT)
        self.assertEqual(ext, "jpg")
        with Image.open(io.BytesIO(data)) as img:
            self.assertEqual(img.size, (2000, 1000))
            r, g, b = img.getpixel((5, 5))
            self.assertTrue(min(r, g, b) > 240, "transparent corner is white")

    def test_compress_upload_renames_photos_and_passes_other_files_through(self):
        pdf = SimpleUploadedFile("quote.pdf", b"%PDF-1.7 fake", content_type="application/pdf")
        self.assertIs(compress_upload(pdf), pdf)
        photo = SimpleUploadedFile("IMG_2041.PNG", self._png(3000, 2000), content_type="image/png")
        out = compress_upload(photo)
        self.assertEqual(out.name, "IMG_2041.jpg")
        self.assertLess(out.size, photo.size)
        self.assertIsNone(compress_upload(None))

    @staticmethod
    def _png(w, h, alpha=False):
        noise = Image.effect_noise((w, h), 30)
        bands = [noise, noise, noise] + ([Image.linear_gradient("L").resize((w, h))] if alpha else [])
        out = io.BytesIO()
        Image.merge("RGBA" if alpha else "RGB", bands).save(out, "PNG")
        return out.getvalue()


class _MediaBase(TestCase):
    def setUp(self):
        forget()
        self.media = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.hr = User.objects.create_user("hr", "hr@x.com", "pass@12345", role=Role.HR_MANAGER, department="hr")
        self.member = User.objects.create_user("mem", "mem@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, department="sales")

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media, ignore_errors=True)
        forget()

    def as_(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c


class PunchPhotoSizeTests(_MediaBase):
    def test_a_large_punch_photo_is_stored_as_a_720px_jpeg_without_gps(self):
        self.as_(self.hr).put("/api/hr/settings/", {"photo": "required"}, format="json")
        raw = noisy_jpeg(1920, 1440, quality=70, exif=with_orientation_and_gps(1), sigma=10)
        self.assertLess(len(raw), 400 * 1024, "within the punch photo limit")
        photo = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
        res = self.as_(self.member).post("/api/attendance/check_in/", {"photo": photo}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        rec = Attendance.objects.get(user=self.member)
        with rec.check_in_photo.open("rb") as fh:
            stored = fh.read()
        (w, h), fmt, exif = size_of(stored)
        self.assertEqual((fmt, max(w, h)), ("JPEG", 720))
        self.assertEqual(exif, {})
        self.assertLess(len(stored), len(raw) / 3)

    def test_a_png_punch_photo_is_stored_as_jpeg(self):
        self.as_(self.hr).put("/api/hr/settings/", {"photo": "optional"}, format="json")
        png = io.BytesIO()
        Image.new("RGB", (64, 48), (10, 120, 200)).save(png, "PNG")
        photo = "data:image/png;base64," + base64.b64encode(png.getvalue()).decode()
        self.assertEqual(self.as_(self.member).post("/api/attendance/check_in/", {"photo": photo}, format="json").status_code, 201)
        with Attendance.objects.get(user=self.member).check_in_photo.open("rb") as fh:
            self.assertEqual(size_of(fh.read())[1], "JPEG", "served as image/jpeg, so stored as one")


class CompressMediaCommandTests(_MediaBase):
    def test_dry_run_reports_and_apply_replaces(self):
        big = noisy_jpeg(2400, 1800, quality=90)
        rec = Attendance.objects.create(user=self.member, date=timezone.localdate() - timedelta(days=1))
        rec.check_in_photo.save("p.jpg", ContentFile(big))
        pdf_rec = Attendance.objects.create(user=self.hr, date=timezone.localdate() - timedelta(days=1))
        pdf_rec.check_in_photo.save("p.jpg", ContentFile(b"%PDF-1.7 not a photo"))
        old_name = rec.check_in_photo.name

        out = io.StringIO()
        call_command("compress_media", stdout=out)
        self.assertIn("Dry run: 2 file(s) checked, 1 photo(s) would shrink", out.getvalue())
        rec.refresh_from_db()
        self.assertEqual(rec.check_in_photo.name, old_name, "a dry run changes nothing")

        out = io.StringIO()
        call_command("compress_media", "--apply", stdout=out)
        self.assertIn("Done: 2 file(s) checked, 1 photo(s) shrunk", out.getvalue())
        rec.refresh_from_db()
        with rec.check_in_photo.open("rb") as fh:
            self.assertEqual(max(size_of(fh.read())[0]), 720)
        self.assertFalse(rec.check_in_photo.storage.exists(old_name), "the old file is removed")
        pdf_rec.refresh_from_db()
        with pdf_rec.check_in_photo.open("rb") as fh:
            self.assertEqual(fh.read(), b"%PDF-1.7 not a photo")
