"""Payslips as PDF (PLAN.md §19.31).

One A4 page per payslip: company name and logo, employee details, pay period, attendance, earnings, deductions
(incl. advance recovery) and net pay in figures and words, in Indian format (₹, lakh grouping). Drawn with
reportlab's standard Helvetica; ₹ is not in its character set, so the sign is drawn as a small vector glyph.

`payslip_pdf([slip, …])` makes one PDF (one page each), `payslips_zip(slips)` a ZIP with one PDF per person.
"""
import io
import logging
import threading
import time
import zipfile
from calendar import monthrange
from decimal import ROUND_HALF_UP, Decimal

log = logging.getLogger(__name__)

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
RUPEE = "₹"

# ----------------------------------------------------------------- Indian money


def _dec(v) -> Decimal:
    return Decimal(str(v if v is not None else 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def indian(v) -> str:
    """1234567.5 → '12,34,567.50' (lakh grouping)."""
    d = _dec(v)
    sign = "-" if d < 0 else ""
    whole, frac = f"{abs(d):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}{whole}.{frac}"


def inr(v) -> str:
    return f"{RUPEE}{indian(v)}"


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
         "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return _TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else "")


def _three(n: int) -> str:
    h, rest = divmod(n, 100)
    parts = []
    if h:
        parts.append(f"{_ONES[h]} Hundred")
    if rest:
        parts.append(_two(rest))
    return " ".join(parts)


def _words(n: int) -> str:
    """Whole number in the Indian system: crore, lakh, thousand, hundred."""
    if n == 0:
        return "Zero"
    parts = []
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    if crore:
        parts.append(f"{_words(crore)} Crore")
    if lakh:
        parts.append(f"{_two(lakh)} Lakh")
    if thousand:
        parts.append(f"{_two(thousand)} Thousand")
    if n:
        parts.append(_three(n))
    return " ".join(parts)


def amount_in_words(v) -> str:
    """₹1,23,456.50 → 'Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only'."""
    d = abs(_dec(v))
    rupees = int(d)
    paise = int((d - rupees) * 100)
    text = f"Rupees {_words(rupees)}"
    if paise:
        text += f" and {_two(paise)} Paise"
    return ("Minus " if _dec(v) < 0 else "") + text + " Only"


def _num(v) -> str:
    """Days: 22.0 → '22', 21.5 → '21.5'."""
    d = Decimal(str(v if v is not None else 0))
    return f"{d.normalize():f}" if d == d.to_integral() else f"{d:f}".rstrip("0")


# ----------------------------------------------------------------- company logo

_logo_lock = threading.Lock()
_logo_cache: dict[str, tuple[float, bytes | None]] = {}


def _logo_bytes(logo_url: str | None) -> bytes | None:
    """The logo the Platform serves (public, same as the app header); cached 10 minutes; never fails the PDF."""
    from django.conf import settings
    from urllib.parse import urlsplit

    jwks = getattr(settings, "PLATFORM_JWKS_URL", "") or ""
    if not logo_url or not logo_url.startswith("/") or not jwks:
        return None
    parts = urlsplit(jwks)
    url = f"{parts.scheme}://{parts.netloc}{logo_url}"
    now = time.monotonic()
    with _logo_lock:
        hit = _logo_cache.get(url)
        if hit and now - hit[0] < 600:
            return hit[1]
    data = None
    try:
        import requests
        res = requests.get(url, timeout=3)
        if res.ok and len(res.content) < 2_000_000:
            data = res.content
    except Exception:   # noqa: BLE001 -- a missing logo never stops a payslip
        log.info("payslip logo not loaded from %s", url)
    with _logo_lock:
        _logo_cache[url] = (now, data)
    return data


def _company():
    """(name, logo ImageReader or None)."""
    from tenancy.profile import brand
    b = brand() or {}
    # a standalone install has no company profile: the app's own name
    from tenancy.profile import app_name
    name = b.get("name") or app_name()
    logo = None
    raw = _logo_bytes(b.get("logo_url"))
    if raw:
        try:
            from PIL import Image
            from reportlab.lib.utils import ImageReader
            img = Image.open(io.BytesIO(raw))
            img.load()
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA")
            logo = ImageReader(img)
        except Exception:   # noqa: BLE001
            logo = None
    return name, logo


# ----------------------------------------------------------------- drawing

INK = (0.13, 0.15, 0.20)
MUTED = (0.40, 0.43, 0.50)
LINE = (0.82, 0.84, 0.88)
TINT = (0.95, 0.96, 0.98)


def _rupee(c, x, y, size, bold=False):
    """Draws ₹ with its baseline at y; returns its width."""
    w = size * 0.56
    c.saveState()
    c.setLineWidth(size * (0.095 if bold else 0.075))
    c.setLineCap(0)
    top, mid = y + size * 0.70, y + size * 0.50
    c.line(x, top, x + w, top)
    c.line(x, mid, x + w * 0.92, mid)
    p = c.beginPath()
    p.moveTo(x + w * 0.10, top)
    p.curveTo(x + w * 0.95, top, x + w * 0.95, y + size * 0.30, x + w * 0.10, y + size * 0.30)
    c.drawPath(p, stroke=1, fill=0)
    c.line(x + w * 0.10, y + size * 0.30, x + w * 0.80, y)
    c.restoreState()
    return w + size * 0.08


def _width(c, text, font, size):
    w = 0.0
    for i, seg in enumerate(str(text).split(RUPEE)):
        if i:
            w += size * 0.64
        w += c.stringWidth(seg, font, size)
    return w


def _text(c, x, y, text, font="Helvetica", size=9, align="left", color=INK):
    """Text that may contain ₹; align left/right/center at x."""
    text = str(text)
    total = _width(c, text, font, size)
    if align == "right":
        x -= total
    elif align == "center":
        x -= total / 2
    c.setFillColorRGB(*color)
    c.setStrokeColorRGB(*color)
    c.setFont(font, size)
    for i, seg in enumerate(text.split(RUPEE)):
        if i:
            x += _rupee(c, x, y, size, bold=font.endswith("Bold"))
        c.drawString(x, y, seg)
        x += c.stringWidth(seg, font, size)


def _wrap(c, text, font, size, width):
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if _width(c, trial, font, size) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _clip(c, text, font, size, width):
    text = str(text or "—")
    while _width(c, text, font, size) > width and len(text) > 2:
        text = text[:-2] + "…" if not text.endswith("…") else text[:-3] + "…"
    return text


def _draw_slip(c, slip, company, logo, dept_names):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm

    W, H = A4
    L, R = 18 * mm, W - 18 * mm
    run, user = slip.run, slip.user
    period_first = f"01 {MONTHS[run.month - 1][:3]} {run.year}"
    period_last = f"{monthrange(run.year, run.month)[1]:02d} {MONTHS[run.month - 1][:3]} {run.year}"
    b = slip.breakdown or {}

    # header: logo + company, title on the right
    y = H - 20 * mm
    x = L
    if logo is not None:
        iw, ih = logo.getSize()
        h = 14 * mm
        w = min(40 * mm, h * iw / ih if ih else h)
        h = w * ih / iw if iw else h
        c.drawImage(logo, L, y - h + 4 * mm, width=w, height=h, mask="auto")
        x = L + w + 4 * mm
    _text(c, x, y - 1 * mm, _clip(c, company, "Helvetica-Bold", 15, R - x - 62 * mm), "Helvetica-Bold", 15)
    _text(c, x, y - 6.5 * mm, "Payslip", "Helvetica", 9, color=MUTED)
    _text(c, R, y - 1 * mm, f"Payslip for {MONTHS[run.month - 1]} {run.year}", "Helvetica-Bold", 11, "right")
    _text(c, R, y - 6.5 * mm, f"Pay period {period_first} to {period_last}", "Helvetica", 8.5, "right", MUTED)
    if run.status != "finalised":
        _text(c, R, y - 11.5 * mm, "DRAFT: not final", "Helvetica-Bold", 8.5, "right", (0.75, 0.25, 0.10))
    y -= 16 * mm
    c.setStrokeColorRGB(*LINE)
    c.setLineWidth(0.8)
    c.line(L, y, R, y)

    # employee details: two columns of label / value
    y -= 8 * mm
    manager = user.reporting_manager
    left = [
        ("Employee name", user.get_full_name() or user.username),
        ("Employee ID", user.employee_code or "—"),
        ("Username", user.username),
        ("Designation", user.designation or "—"),
    ]
    right = [
        ("Department", dept_names.get(user.department, (user.department or "").title()) or "—"),
        ("Reports to", (manager.get_full_name() or manager.username) if manager else "—"),
        ("Pay period", f"{period_first} – {period_last}"),
        ("Status", "Finalised" + (f" on {run.finalised_at:%d %b %Y}" if run.finalised_at else "") if run.status == "finalised" else "Draft"),
    ]
    col = (R - L) / 2
    for i, ((l1, v1), (l2, v2)) in enumerate(zip(left, right)):
        yy = y - i * 6 * mm
        _text(c, L, yy, l1, "Helvetica", 8.5, color=MUTED)
        _text(c, L + 30 * mm, yy, _clip(c, v1, "Helvetica-Bold", 9, col - 32 * mm), "Helvetica-Bold", 9)
        _text(c, L + col, yy, l2, "Helvetica", 8.5, color=MUTED)
        _text(c, L + col + 26 * mm, yy, _clip(c, v2, "Helvetica-Bold", 9, col - 28 * mm), "Helvetica-Bold", 9)
    y -= len(left) * 6 * mm + 2 * mm

    # attendance strip
    cells = [
        ("Working days", _num(slip.working_days)),
        ("Paid days", _num(slip.payable_days)),
        ("Present", _num(b.get("present", 0))),
        ("Half days", _num(b.get("half_day", 0))),
        ("Paid leave", _num(b.get("paid_leave", 0))),
        ("LWP days", _num(slip.lwp_days)),
    ]
    box_h = 13 * mm
    c.setFillColorRGB(*TINT)
    c.setStrokeColorRGB(*LINE)
    c.roundRect(L, y - box_h, R - L, box_h, 2 * mm, stroke=1, fill=1)
    cw = (R - L) / len(cells)
    for i, (label, value) in enumerate(cells):
        cx = L + cw * i + cw / 2
        _text(c, cx, y - 5 * mm, label, "Helvetica", 7.5, "center", MUTED)
        _text(c, cx, y - 10.5 * mm, value, "Helvetica-Bold", 11, "center")
    y -= box_h + 8 * mm

    # earnings | deductions
    earnings = [
        ("Monthly gross (full month)", slip.monthly_gross, True),
        (f"Per-day rate ({_num(slip.working_days)} working days)", b.get("per_day", 0), True),
        (f"Earned for {_num(slip.payable_days)} paid days", slip.earned_gross, False),
    ]
    deductions = [
        ("Provident fund (PF)", slip.pf),
        ("Professional tax", slip.professional_tax),
        ("Advance recovery", slip.advance_deduction),
        ("Other deduction", slip.other_deduction),
    ]
    half = (R - L - 6 * mm) / 2
    for side, (title, x0) in enumerate((("Earnings", L), ("Deductions", L + half + 6 * mm))):
        c.setFillColorRGB(*TINT)
        c.setStrokeColorRGB(*LINE)
        c.rect(x0, y - 7 * mm, half, 7 * mm, stroke=1, fill=1)
        _text(c, x0 + 3 * mm, y - 4.8 * mm, title, "Helvetica-Bold", 9)
        _text(c, x0 + half - 3 * mm, y - 4.8 * mm, f"Amount ({RUPEE})", "Helvetica-Bold", 9, "right")
    rows = max(len(earnings), len(deductions))
    for i in range(rows):
        yy = y - 7 * mm - (i + 1) * 6.5 * mm + 2 * mm
        if i < len(earnings):
            label, amount, info = earnings[i]
            _text(c, L + 3 * mm, yy, label, "Helvetica", 8.5, color=MUTED if info else INK)
            _text(c, L + half - 3 * mm, yy, indian(amount), "Helvetica", 9, "right", MUTED if info else INK)
        if i < len(deductions):
            label, amount = deductions[i]
            x0 = L + half + 6 * mm
            _text(c, x0 + 3 * mm, yy, label, "Helvetica", 8.5)
            _text(c, x0 + half - 3 * mm, yy, indian(amount), "Helvetica", 9, "right")
    table_bottom = y - 7 * mm - rows * 6.5 * mm - 2 * mm
    c.setStrokeColorRGB(*LINE)
    for x0 in (L, L + half + 6 * mm):
        c.rect(x0, table_bottom - 7 * mm, half, y - table_bottom, stroke=1, fill=0)
        c.line(x0, table_bottom, x0 + half, table_bottom)
    _text(c, L + 3 * mm, table_bottom - 4.8 * mm, "Total earnings", "Helvetica-Bold", 9)
    _text(c, L + half - 3 * mm, table_bottom - 4.8 * mm, inr(slip.earned_gross), "Helvetica-Bold", 9.5, "right")
    x0 = L + half + 6 * mm
    _text(c, x0 + 3 * mm, table_bottom - 4.8 * mm, "Total deductions", "Helvetica-Bold", 9)
    _text(c, x0 + half - 3 * mm, table_bottom - 4.8 * mm, inr(slip.total_deductions), "Helvetica-Bold", 9.5, "right")
    y = table_bottom - 7 * mm - 8 * mm

    # net pay
    words = _wrap(c, amount_in_words(slip.net_payable), "Helvetica", 8.5, R - L - 10 * mm)
    box_h = (14 + 4.5 * len(words)) * mm
    c.setFillColorRGB(0.93, 0.97, 0.94)
    c.setStrokeColorRGB(0.55, 0.75, 0.60)
    c.roundRect(L, y - box_h, R - L, box_h, 2 * mm, stroke=1, fill=1)
    _text(c, L + 5 * mm, y - 8 * mm, "Net pay", "Helvetica-Bold", 12)
    _text(c, R - 5 * mm, y - 8 * mm, inr(slip.net_payable), "Helvetica-Bold", 15, "right")
    for i, line in enumerate(words):
        _text(c, L + 5 * mm, y - 14 * mm - i * 4.5 * mm, line, "Helvetica-Oblique", 8.5, color=MUTED)
    y -= box_h + 6 * mm

    outstanding = _dec(b.get("advance_outstanding", 0)) - _dec(slip.advance_deduction)
    notes = []
    if outstanding > 0:
        notes.append(f"Advance still to be recovered after this payslip: {inr(outstanding)}.")
    if slip.note:
        notes.append(slip.note)
    for n in notes:
        for line in _wrap(c, n, "Helvetica", 8.5, R - L):
            _text(c, L, y, line, "Helvetica", 8.5, color=MUTED)
            y -= 4.5 * mm

    from django.utils import timezone
    c.setStrokeColorRGB(*LINE)
    c.line(L, 18 * mm, R, 18 * mm)
    _text(c, L, 13 * mm, "This is a computer-generated payslip and needs no signature.", "Helvetica", 7.5, color=MUTED)
    _text(c, R, 13 * mm, f"Generated {timezone.localtime():%d %b %Y %H:%M}", "Helvetica", 7.5, "right", MUTED)


def _dept_names():
    from accounts.models import DepartmentOption
    return {d.code: d.name for d in DepartmentOption.objects.all()}


def payslip_pdf(slips) -> bytes:
    """One PDF, one page per payslip."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    company, logo = _company()
    depts = _dept_names()
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=A4, pageCompression=1)
    slips = list(slips)
    first = slips[0] if slips else None
    c.setTitle(f"Payslip {MONTHS[first.run.month - 1]} {first.run.year}" if first else "Payslips")
    c.setAuthor(company)
    c.setCreator("Kaampilot")
    for s in slips:
        _draw_slip(c, s, company, logo, depts)
        c.showPage()
    if not slips:
        c.showPage()
    c.save()
    return out.getvalue()


def slip_filename(slip) -> str:
    import re
    who = re.sub(r"[^a-z0-9]+", "-", (slip.user.get_full_name() or slip.user.username).lower()).strip("-") or str(slip.user_id)
    return f"payslip-{slip.run.year}-{slip.run.month:02d}-{who}.pdf"


def payslips_zip(slips) -> bytes:
    """A ZIP with one PDF per payslip."""
    out = io.BytesIO()
    seen = set()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for s in slips:
            name = slip_filename(s)
            if name in seen:
                name = name.replace(".pdf", f"-{s.user_id}.pdf")
            seen.add(name)
            z.writestr(name, payslip_pdf([s]))
    return out.getvalue()
