"""Production log: ships ERROR records, unhandled 500s and a worker heartbeat to the Platform's log sink.

OFF unless PLATFORM_LOG_URL is set (standalone installs and tests are unchanged). It never blocks or fails
a request or job: entries go into a bounded in-memory queue and a daemon thread POSTs them in batches
(20 entries or 2 s after the first; HTTP timeout 3 s; every error swallowed). At most 60 entries a minute
per process; identical entries (level + message + path) within 60 s are folded into one with a `count`.
Everything is redacted before it is queued: no query strings, bodies, headers, cookies, tokens or secrets.

Env: PLATFORM_LOG_URL, LOG_SINK_TOKEN (optional header x-log-sink-token), APP_VERSION.
"""
import json
import logging
import os
import queue
import re
import threading
import time
import traceback
import urllib.request
from datetime import datetime, timezone

MAX_MESSAGE = 500
MAX_STACK = 4000
MAX_BATCH = 50
FLUSH_AT = 20
FLUSH_AFTER = 2.0
HTTP_TIMEOUT = 3.0
RATE_PER_MINUTE = 60
FOLD_SECONDS = 60.0

_service = "tasks"
_queue: "queue.Queue" = queue.Queue(maxsize=200)
_lock = threading.Lock()
_thread: threading.Thread | None = None
_guard = threading.local()
# fold key -> {"until": t, "entry": dict, "sent": bool, "extra": int}
_seen: dict[tuple, dict] = {}
_rate = {"minute": 0, "count": 0}


def enabled() -> bool:
    return bool(os.environ.get("PLATFORM_LOG_URL", "").strip())


def set_service(name: str) -> None:
    global _service
    _service = name


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------- redaction ----------
_REDACTIONS = [
    (re.compile(r"Bearer\s+[^\s\"',]+", re.I), "Bearer [hidden]"),
    (re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "[jwt]"),
    (re.compile(r"(password|passwd|pwd|secret|token|otp|code|authkey|api[_-]?key|signature)\s*[\"']?\s*[:=]\s*[\"']?[^\s\"',&}]+",
                re.I), r"\1=[hidden]"),
    (re.compile(r"params:.*"), "params: [hidden]"),
    (re.compile(r"\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"), r"\1***@\2"),
    (re.compile(r"\b\d{6,}\b"), "[digits]"),
]


def redact(text: str | None) -> str:
    if not text:
        return ""
    for pattern, repl in _REDACTIONS:
        text = pattern.sub(repl, text)
    return text


def clean_path(path: str | None) -> str | None:
    if not path:
        return None
    return redact(str(path).split("?", 1)[0].split("#", 1)[0])[:300]


# ---------- queueing ----------
def _ensure_thread() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_run, name="ff-log-sink", daemon=True)
            _thread.start()


def _put(item) -> bool:
    try:
        _queue.put_nowait(item)
    except queue.Full:
        return False
    _ensure_thread()
    return True


def report(level: str, kind: str, message: str, *, stack: str | None = None, event: str | None = None,
           method: str | None = None, path: str | None = None, status: int | None = None,
           company_id: str | None = None, user_id: str | None = None) -> bool:
    """Queues one entry (redacted, rate limited, folded). Never raises. Returns True when queued or folded."""
    if not enabled():
        return False
    try:
        message = redact(str(message or "").strip().splitlines()[0] if str(message or "").strip() else "")[:MAX_MESSAGE]
        path = clean_path(path)
        entry = {"at": _now_iso(), "level": level, "kind": kind, "message": message, "count": 1}
        if stack:
            stack = redact(stack)
            entry["stack"] = stack[-MAX_STACK:] if len(stack) > MAX_STACK else stack
        for key, value in (("event", event), ("method", method), ("path", path), ("status", status),
                           ("companyId", company_id), ("userId", user_id)):
            if value not in (None, ""):
                entry[key] = value
        key = (level, message, path)
        now = time.monotonic()
        with _lock:
            seen = _seen.get(key)
            if seen and now < seen["until"]:
                if not seen["sent"]:
                    seen["entry"]["count"] += 1
                else:
                    seen["extra"] += 1
                return True
            minute = int(now // 60)
            if _rate["minute"] != minute:
                _rate["minute"], _rate["count"] = minute, 0
            if _rate["count"] >= RATE_PER_MINUTE:
                return False
            _rate["count"] += 1
            if len(_seen) > 500:
                for k in [k for k, v in _seen.items() if now >= v["until"]]:
                    _seen.pop(k, None)
            _seen[key] = {"until": now + FOLD_SECONDS, "entry": entry, "sent": False, "extra": 0}
        return _put(("entry", key, entry))
    except Exception:  # noqa: BLE001 -- the reporter must never fail its caller
        return False


def heartbeat(data: dict) -> None:
    if enabled():
        _put(("heartbeat", None, {"at": _now_iso(), "data": data}))


def flush(timeout: float = 5.0) -> bool:
    """Sends everything queued now and waits up to `timeout` seconds (worker, before it sleeps)."""
    if not enabled():
        return True
    done = threading.Event()
    if not _put(("flush", None, done)):
        return False
    return done.wait(timeout)


# ---------- sending ----------
def _sweep_folded(batch: list) -> None:
    """Entries folded after their first copy was sent come out as one entry with the folded count."""
    now = time.monotonic()
    with _lock:
        for key, seen in list(_seen.items()):
            if now >= seen["until"]:
                if seen["extra"] and len(batch) < MAX_BATCH:
                    batch.append(dict(seen["entry"], at=_now_iso(), count=seen["extra"]))
                _seen.pop(key, None)


def _post(entries: list, beat: dict | None) -> None:
    url = os.environ.get("PLATFORM_LOG_URL", "").strip()
    if not url or (not entries and not beat):
        return
    body = {"service": _service, "version": os.environ.get("APP_VERSION") or None, "entries": entries[:MAX_BATCH]}
    if beat:
        body["heartbeat"] = beat
    headers = {"content-type": "application/json"}
    if os.environ.get("LOG_SINK_TOKEN"):
        headers["x-log-sink-token"] = os.environ["LOG_SINK_TOKEN"]
    try:
        req = urllib.request.Request(url, data=json.dumps(body, default=str).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:  # noqa: S310 -- URL from our own env
            res.read()
    except Exception:  # noqa: BLE001 -- sink down: drop silently
        pass


def _send(items: list) -> None:
    entries, beat = [], None
    with _lock:
        for kind, key, payload in items:
            if kind == "entry":
                seen = _seen.get(key)
                if seen and seen["entry"] is payload:
                    seen["sent"] = True
                entries.append(dict(payload))
            elif kind == "heartbeat":
                beat = payload
    _sweep_folded(entries)
    for i in range(0, max(len(entries), 1), MAX_BATCH):
        _post(entries[i:i + MAX_BATCH], beat if i == 0 else None)


def _run() -> None:
    _guard.active = True  # nothing logged from this thread is reported
    while True:
        try:
            try:
                first = _queue.get(timeout=5)
            except queue.Empty:
                extra: list = []
                _sweep_folded(extra)
                if extra:
                    _post(extra, None)
                continue
            items, waiters = [], []
            deadline = time.monotonic() + FLUSH_AFTER
            item = first
            while True:
                if item[0] == "flush":
                    waiters.append(item[2])
                    break
                items.append(item)
                if sum(1 for i in items if i[0] == "entry") >= FLUSH_AT:
                    break
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                try:
                    item = _queue.get(timeout=left)
                except queue.Empty:
                    break
            if items:
                _send(items)
            for done in waiters:
                done.set()
        except Exception:  # noqa: BLE001 -- keep the sender alive whatever happens
            time.sleep(1)


# ---------- logging handler ----------
def _user_id(request) -> str | None:
    """The user id only when it is already resolved (never triggers a lazy DB lookup)."""
    try:
        from django.utils.functional import SimpleLazyObject, empty

        user = request.__dict__.get("user")
        if user is None:
            return None
        if isinstance(user, SimpleLazyObject):
            user = user._wrapped
            if user is empty:
                return None
        if getattr(user, "is_authenticated", False) and getattr(user, "pk", None) is not None:
            return str(user.pk)
    except Exception:  # noqa: BLE001
        pass
    return None


class LogSinkHandler(logging.Handler):
    """ERROR records (incl. django.request 500s) to the Platform log sink. No-op while the sink is off."""

    def __init__(self):
        super().__init__(level=logging.ERROR)

    def emit(self, record: logging.LogRecord) -> None:
        if not enabled() or getattr(_guard, "active", False) or record.name.startswith("ff.log_sink"):
            return
        _guard.active = True
        try:
            request = getattr(record, "request", None)
            status = getattr(record, "status_code", None)
            if request is not None and isinstance(status, int) and status < 500:
                return  # 4xx are not errors
            stack = None
            if record.exc_info and record.exc_info[1] is not None:
                exc_type, exc, tb = record.exc_info
                message = "".join(traceback.format_exception_only(exc_type, exc)).strip().splitlines()[-1]
                stack = "".join(traceback.format_exception(exc_type, exc, tb))
                kind = "exception"
            else:
                message = record.getMessage()
                kind = "exception" if request is not None else "event"
            event = getattr(record, "event", None)
            if not event:
                if record.name == "django.request":
                    event = "request.failed"
                elif record.name.startswith("tenancy.worker"):
                    event = "worker.failed"
            company_id = getattr(record, "company_id", None)
            method = path = user_id = None
            if request is not None:
                method = getattr(request, "method", None)
                path = getattr(request, "path", None)
                company_id = company_id or getattr(request, "company_id", None)
                user_id = _user_id(request)
            level = "error" if record.levelno >= logging.ERROR else "warn"
            report(level, kind, message, stack=stack, event=event, method=method, path=path,
                   status=status if isinstance(status, int) else None, company_id=company_id, user_id=user_id)
        except Exception:  # noqa: BLE001
            pass
        finally:
            _guard.active = False


_handler: LogSinkHandler | None = None


def install() -> None:
    """Adds the handler to the root logger once (Django's own console logging is left as it is)."""
    global _handler
    if _handler is None:
        _handler = LogSinkHandler()
        logging.getLogger().addHandler(_handler)


def _reset_for_tests() -> None:
    with _lock:
        _seen.clear()
        _rate["minute"], _rate["count"] = 0, 0
    while True:
        try:
            _queue.get_nowait()
        except queue.Empty:
            break
