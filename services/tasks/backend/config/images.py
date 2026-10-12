"""Smaller photos (PLAN.md §19.20).

Every image a person uploads is stored re-encoded: turned upright from its EXIF orientation, shrunk so its longest side
fits a preset, saved as a progressive JPEG, with all metadata (GPS included) dropped. Anything that is not a photo
(PDF, XLSX, GIF, SVG, HEIC, a broken file) is stored exactly as it came, and so is a photo the re-encode would not make
smaller. The web app already shrinks before uploading; this is the safety net for any other client.
"""
import io
import os

from django.core.files.base import ContentFile

# (longest side in px, JPEG quality)
SELFIE = (720, 65)       # punch photos
PHOTO = (1600, 72)       # photos of things
DOCUMENT = (2000, 80)    # images attached as documents: text stays readable

# Formats re-encoded. GIF can be animated and is left alone; Pillow cannot open SVG or (without a plugin) HEIC.
_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "BMP", "TIFF"}
# Magic numbers of those formats: everything else is never even opened.
_MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"BM", b"II*\x00", b"MM\x00*")
_MAX_PIXELS = 120_000_000  # a bigger "photo" is left alone instead of filling the server's memory
# A photo that already fits is only re-encoded when that saves at least this share: re-encoding an already small JPEG
# costs a little quality for a few bytes.
_MIN_SAVING = 0.10


def _looks_like_image(head: bytes) -> bool:
    return head.startswith(_MAGIC) or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")


def compress_image(raw: bytes, max_side: int = DOCUMENT[0], quality: int = DOCUMENT[1], always: bool = False):
    """(bytes, ext): the re-encoded JPEG and "jpg", or (raw, None) when `raw` is kept as it is.

    `always` returns the JPEG even when it is not smaller (for callers that must store a JPEG); a file that is not a
    photo is still returned as it is.
    """
    if not raw or not _looks_like_image(raw[:16]):
        return raw, None
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in _FORMATS or img.width * img.height > _MAX_PIXELS:
                return raw, None
            if img.format in ("JPEG", "MPO"):
                img.draft("RGB", (max_side, max_side))  # decode a big JPEG at a fraction of its size: faster, less memory
            upright = ImageOps.exif_transpose(img)
            if upright.mode in ("RGBA", "LA", "PA") or (upright.mode == "P" and "transparency" in upright.info):
                rgba = upright.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (255, 255, 255))  # transparent parts become white, as on paper
                flat.paste(rgba, mask=rgba.getchannel("A"))
                upright = flat
            elif upright.mode != "RGB":
                upright = upright.convert("RGB")
            too_big = max(upright.size) > max_side
            upright.thumbnail((max_side, max_side), Image.LANCZOS)
            out = io.BytesIO()
            # No exif=… : the metadata (camera, GPS, orientation) is not copied. The colour profile is kept.
            upright.save(out, "JPEG", quality=quality, optimize=True, progressive=True,
                         icc_profile=img.info.get("icc_profile"))
    except Exception:  # noqa: BLE001 — a file Pillow cannot read is simply stored as it came
        return raw, None
    data = out.getvalue()
    limit = len(raw) if too_big else len(raw) * (1 - _MIN_SAVING)
    if len(data) >= limit and not always:
        return raw, None
    return data, "jpg"


def compress_upload(f, preset=DOCUMENT):
    """An uploaded file to store: a smaller JPEG copy when it is a photo, else the same file object."""
    if not f:
        return f
    try:
        f.seek(0)
        head = f.read(16)
        if not _looks_like_image(head):
            f.seek(0)
            return f
        f.seek(0)
        raw = f.read()
        f.seek(0)
    except (AttributeError, OSError, ValueError):
        return f
    data, ext = compress_image(raw, *preset)
    if not ext:
        return f
    base = os.path.splitext(os.path.basename(getattr(f, "name", "") or ""))[0] or "photo"
    return ContentFile(data, name=f"{base}.{ext}")
