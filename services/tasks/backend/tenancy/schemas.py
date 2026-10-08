"""Which company's schema the current code runs in.

Every company has its own Postgres schema (co_<code>) holding the full set of
Tasks tables. A request, worker run or command picks one with `use(schema)`;
the connection's search_path then holds ONLY that schema, so a query cannot
see another company's tables. Without a company the search path is the empty
`ff_none` schema, so a query fails instead of reading anyone's data.

The registry of companies lives outside the company schemas, in
public.ff_companies, and is only ever addressed by its qualified name.
"""
import contextvars
import re
import sys
import threading
from contextlib import contextmanager

from django.conf import settings
from django.db import connection

NO_COMPANY = "ff_none"
PUBLIC = "public"
REGISTRY = "public.ff_companies"
_SCHEMA_RE = re.compile(r"^co_[a-z0-9_]{1,50}$")

_current: contextvars.ContextVar[str | None] = contextvars.ContextVar("ff_company_schema", default=None)
_cache: dict[str, str] = {}
_cache_lock = threading.Lock()


def enabled() -> bool:
    return getattr(settings, "TENANCY", "") == "schemas" and connection.vendor == "postgresql"


def schema_for_code(code: str) -> str:
    """co_<code>, from a Platform company code (validated, never trusted raw)."""
    name = "co_" + re.sub(r"[^a-z0-9_]", "_", (code or "").strip().lower())
    if not _SCHEMA_RE.match(name) or name == "co_":
        raise ValueError(f"Invalid company code: {code!r}")
    return name


def valid(schema: str) -> bool:
    return schema in (NO_COMPANY, PUBLIC) or bool(_SCHEMA_RE.match(schema or ""))


def current() -> str | None:
    """The company schema in use, or None (no company / multi-company mode off)."""
    value = _current.get()
    return value if value and value.startswith("co_") else None


def serving() -> bool:
    return any(cmd in sys.argv for cmd in ("runserver", "gunicorn")) or "gunicorn" in sys.argv[0]


def default_schema() -> str:
    """What a fresh connection uses: nothing while serving requests (fail closed),
    public for management commands such as migrate."""
    return NO_COMPANY if serving() else PUBLIC


def _apply(schema: str) -> None:
    if not valid(schema):
        raise ValueError(f"Invalid schema name: {schema!r}")
    with connection.cursor() as cur:
        # Identifiers cannot be bound parameters; `valid` limits the name to [a-z0-9_].
        cur.execute(f'SET search_path TO "{schema}"')


def activate(schema: str) -> contextvars.Token:
    """Points this thread's connection at `schema` until deactivated."""
    token = _current.set(schema)
    _apply(schema)
    return token


def deactivate(token: contextvars.Token | None = None) -> None:
    if token is not None:
        _current.reset(token)
    else:
        _current.set(None)
    if connection.connection is not None:  # nothing to reset on a closed connection
        _apply(_current.get() or default_schema())


@contextmanager
def use(schema: str):
    token = activate(schema)
    try:
        yield schema
    finally:
        deactivate(token)


def on_connect(sender, connection, **kwargs):
    """New connections (including reconnects mid-request and new threads) start
    in the company currently in use, or the fail-closed default."""
    if connection.vendor != "postgresql" or getattr(settings, "TENANCY", "") != "schemas":
        return
    schema = _current.get() or default_schema()
    with connection.cursor() as cur:
        cur.execute(f'SET search_path TO "{schema}"')


# --- registry ---------------------------------------------------------------

def ensure_registry() -> None:
    with connection.cursor() as cur:
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{NO_COMPANY}"')
        cur.execute(
            f"""CREATE TABLE IF NOT EXISTS {REGISTRY} (
                    company_id uuid PRIMARY KEY,
                    schema_name text NOT NULL UNIQUE,
                    name text NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                )"""
        )


def register(company_id: str, schema: str, name: str) -> None:
    if not valid(schema) or not schema.startswith("co_"):
        raise ValueError(f"Invalid schema name: {schema!r}")
    with connection.cursor() as cur:
        cur.execute(
            f"""INSERT INTO {REGISTRY} (company_id, schema_name, name) VALUES (%s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET name = EXCLUDED.name""",
            [str(company_id), schema, name],
        )
    with _cache_lock:
        _cache.pop(str(company_id), None)


def schema_for(company_id) -> str | None:
    """The schema of a registered company, or None."""
    key = str(company_id or "")
    if not key:
        return None
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    try:
        with connection.cursor() as cur:
            cur.execute(f"SELECT schema_name FROM {REGISTRY} WHERE company_id::text = %s", [key])
            row = cur.fetchone()
    except Exception:  # noqa: BLE001 -- registry missing = no companies yet
        return None
    if row:
        with _cache_lock:
            _cache[key] = row[0]
        return row[0]
    return None


def companies() -> list[dict]:
    with connection.cursor() as cur:
        cur.execute(f"SELECT company_id::text, schema_name, name FROM {REGISTRY} ORDER BY created_at, schema_name")
        return [{"company_id": r[0], "schema": r[1], "name": r[2]} for r in cur.fetchall()]


def create_company(company_id: str, schema: str, name: str, *, verbosity: int = 0) -> bool:
    """Creates (or brings up to date) a company's schema and registers it.
    Idempotent. Returns True when the schema was new."""
    from django.core.management import call_command

    if not valid(schema) or not schema.startswith("co_"):
        raise ValueError(f"Invalid schema name: {schema!r}")
    ensure_registry()
    with connection.cursor() as cur:
        cur.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", [schema])
        is_new = cur.fetchone() is None
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    with use(schema):
        call_command("migrate", interactive=False, verbosity=verbosity)
    register(company_id, schema, name)
    return is_new


def migrate_all(*, verbosity: int = 1, stdout=None) -> list[str]:
    from django.core.management import call_command

    done = []
    for row in companies():
        with use(row["schema"]):
            if stdout:
                stdout.write(f"Migrating {row['name']} ({row['schema']})")
            call_command("migrate", interactive=False, verbosity=verbosity)
        done.append(row["schema"])
    return done


def run_in_thread_context(fn):
    """Wraps fn so a thread started now runs in the current company."""
    ctx = contextvars.copy_context()
    return lambda *a, **kw: ctx.run(fn, *a, **kw)
