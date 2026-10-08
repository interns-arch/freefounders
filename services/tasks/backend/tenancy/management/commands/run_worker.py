"""Background jobs in their own process: `manage.py run_worker`.

Every 5 minutes it runs the same routine the in-process thread runs
(reminders, digests, escalations, attachment clean-up) and, where switched
on, the Gmail poll -- once per company in multi-company mode, once otherwise.

A Postgres advisory lock makes sure only one worker runs a pass at a time, so
starting a second worker (or the web server with many processes) never sends
reminders twice. One company failing is logged; the others still run.
Use with NOTIF_SCHEDULER=false on the web server.
"""
import logging
import time

from django.core.management.base import BaseCommand
from django.db import connection

from tenancy import schemas
from tenancy.company_settings import company_env

log = logging.getLogger("tenancy.worker")
LOCK_KEY = 0x46465752  # "FFWR"


def _try_lock() -> bool:
    if connection.vendor != "postgresql":
        return True
    with connection.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", [LOCK_KEY])
        return bool(cur.fetchone()[0])


def _unlock() -> None:
    if connection.vendor == "postgresql" and connection.connection is not None:
        with connection.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", [LOCK_KEY])


def run_jobs() -> None:
    """One company's (or the single install's) jobs."""
    from crm.reminders import send_followup_reminders

    send_followup_reminders()
    if company_env("GMAIL_ENABLED", "false").lower() == "true" and company_env("GMAIL_POLL_ENABLED", "false").lower() == "true":
        from intake.gmail_poll import poll_inbox

        poll_inbox()


def run_pass() -> dict:
    """Runs one pass for every company. Returns {schema-or-'default': 'ok'|'failed'|'skipped'}."""
    if not _try_lock():
        return {"*": "skipped"}
    results = {}
    try:
        if schemas.enabled():
            schemas.ensure_registry()
            for company in schemas.companies():
                try:
                    with schemas.use(company["schema"]):
                        run_jobs()
                    results[company["schema"]] = "ok"
                except Exception:  # noqa: BLE001 -- one company must not stop the others
                    log.exception("worker pass failed for %s", company["schema"])
                    results[company["schema"]] = "failed"
        else:
            try:
                run_jobs()
                results["default"] = "ok"
            except Exception:  # noqa: BLE001
                log.exception("worker pass failed")
                results["default"] = "failed"
    finally:
        _unlock()
    return results


class Command(BaseCommand):
    help = "Run background jobs (reminders, digests, Gmail poll) for every company, every 5 minutes."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run one pass and exit (cron, tests).")
        parser.add_argument("--interval", type=int, default=300, help="Seconds between passes (default 300).")

    def handle(self, once=False, interval=300, **opts):
        while True:
            started = time.monotonic()
            results = run_pass()
            self.stdout.write(f"worker pass: {results}")
            if once:
                return
            time.sleep(max(5, interval - (time.monotonic() - started)))
