#!/usr/bin/env python3
"""Apply Supabase schema migrations from ``db/migrations/`` without the dashboard.

The service-role key speaks only PostgREST, which cannot run DDL, so schema changes go
through the Management API's SQL endpoint, which connects as ``postgres``:

    POST https://api.supabase.com/v1/projects/{ref}/database/query
    Authorization: Bearer {SUPABASE_ACCESS_TOKEN}

Every applied file is recorded in ``public.schema_migrations`` (version, name, sha256,
applied_at). The runner therefore knows what is pending, refuses to run the same file
twice, and reports when a file changed after it was applied. Ledger row and migration
travel in one request, so a failing migration rolls the ledger back with it.

The ledger table has RLS enabled and no policies: neither ``anon`` nor ``authenticated``
can see it. Only this runner, holding the admin token, reads or writes it.

Usage:
    python3 scripts/migrate.py --status                 # applied / pending / drifted
    python3 scripts/migrate.py                          # apply every pending file, in order
    python3 scripts/migrate.py db/migrations/0029_x.sql # apply specific files
    python3 scripts/migrate.py --mark-applied FILE...   # record without executing (adoption)
    python3 scripts/migrate.py --sql "select 1"         # ad-hoc query, for inspection
    python3 scripts/migrate.py --dry-run                # print, send nothing that writes

Credentials come from ``.env`` (gitignored) and are never printed, not even truncated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")
API_TIMEOUT_SECONDS = 60
USER_AGENT = "beleth-agent/migrate"

LEDGER_DDL = """
create table if not exists public.schema_migrations (
  version     text primary key,
  name        text        not null,
  sha256      text        not null,
  applied_at  timestamptz not null default now()
);
comment on table public.schema_migrations is
  'Which db/migrations files are live. Written only by scripts/migrate.py through the '
  'Management API. RLS on with no policies: invisible to anon and authenticated.';
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
"""


class MigrationError(RuntimeError):
    """A migration could not be applied, or the environment is not usable."""


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise MigrationError(f"missing env file: {path}")
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


class Project:
    """The Management API SQL endpoint for one Supabase project."""

    def __init__(self, token: str, project_ref: str) -> None:
        self._token = token
        self.ref = project_ref

    @classmethod
    def from_env(cls, env_path: Path | None = None) -> Project:
        env = load_env(env_path or REPO_ROOT / ".env")
        token = env.get("SUPABASE_ACCESS_TOKEN", "").strip()
        base_url = env.get("SUPABASE_URL", "").strip().rstrip("/")
        missing = [
            name
            for name, value in (("SUPABASE_ACCESS_TOKEN", token), ("SUPABASE_URL", base_url))
            if not value
        ]
        if missing:
            raise MigrationError(
                f"missing in .env: {', '.join(missing)} — SUPABASE_ACCESS_TOKEN is a "
                "personal access token with database admin rights"
            )
        return cls(token, base_url.split("//", 1)[1].split(".", 1)[0])

    def query(self, sql: str) -> list[dict]:
        request = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{self.ref}/database/query",
            data=json.dumps({"query": sql}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                # Cloudflare (error 1010) blocks requests with no user agent — urllib's
                # default "Python-urllib/3.x" is rejected at the edge, so name the tool.
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        # add_unredirected_header keeps the bearer token off any redirect hop.
        request.add_unredirected_header("Authorization", f"Bearer {self._token}")
        try:
            with urllib.request.urlopen(request, timeout=API_TIMEOUT_SECONDS) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise MigrationError(f"HTTP {exc.code}: {detail[:800]}") from None
        except urllib.error.URLError as exc:
            raise MigrationError(f"request failed: {exc.reason}") from None
        if not body.strip():
            return []
        parsed = json.loads(body)
        return parsed if isinstance(parsed, list) else [parsed]


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class Migration:
    def __init__(self, path: Path) -> None:
        match = MIGRATION_NAME.match(path.name)
        if not match:
            raise MigrationError(
                f"not a migration filename: {path.name} (expected NNNN_lower_snake.sql)"
            )
        self.path = path
        self.version = match.group(1)
        self.name = path.name
        self.sql = path.read_text(encoding="utf-8")
        self.sha256 = hashlib.sha256(self.sql.encode("utf-8")).hexdigest()

    def ledger_insert(self) -> str:
        return (
            "insert into public.schema_migrations (version, name, sha256) values "
            f"({sql_literal(self.version)}, {sql_literal(self.name)}, {sql_literal(self.sha256)}) "
            "on conflict (version) do update set "
            "name = excluded.name, sha256 = excluded.sha256, applied_at = now();"
        )


def discover(paths: list[str] | None) -> list[Migration]:
    if paths:
        files = [Path(p) if Path(p).is_absolute() else REPO_ROOT / p for p in paths]
        for file in files:
            if not file.is_file():
                raise MigrationError(f"migration file not found: {file}")
    else:
        files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return sorted((Migration(f) for f in files), key=lambda m: m.version)


def read_ledger(project: Project) -> dict[str, dict]:
    project.query(LEDGER_DDL)
    rows = project.query("select version, name, sha256 from public.schema_migrations;")
    return {row["version"]: row for row in rows}


def report_status(project: Project, migrations: list[Migration]) -> int:
    ledger = read_ledger(project)
    pending = 0
    drifted = 0
    for migration in migrations:
        record = ledger.get(migration.version)
        if record is None:
            state, note = "PENDING", ""
            pending += 1
        elif record["sha256"] != migration.sha256:
            state, note = "DRIFTED", "  (file edited after it was applied)"
            drifted += 1
        else:
            state, note = "applied", ""
        print(f"  {state:<8} {migration.name}{note}")
    orphans = sorted(set(ledger) - {m.version for m in migrations})
    for version in orphans:
        print(f"  ORPHAN   {ledger[version]['name']}  (in the ledger, not in db/migrations/)")
    print(f"\n{len(migrations) - pending} applied, {pending} pending, {drifted} drifted")
    return 1 if drifted else 0


def apply(project: Project, migrations: list[Migration], *, dry_run: bool) -> int:
    ledger = read_ledger(project)
    todo = [m for m in migrations if m.version not in ledger]
    if not todo:
        print("nothing to apply — every migration is already recorded as live")
        return 0
    for migration in todo:
        if dry_run:
            print(f"  would apply {migration.name}  ({len(migration.sql)} bytes)")
            continue
        print(f"  applying {migration.name} ...", end=" ", flush=True)
        # One request, so Postgres runs migration + ledger row in a single implicit
        # transaction: a failing migration leaves no ledger row behind.
        project.query(f"{migration.sql}\n\n{migration.ledger_insert()}")
        print("ok")
    return 0


def mark_applied(project: Project, migrations: list[Migration], *, dry_run: bool) -> int:
    """Record files as live without executing them — for adopting an existing database."""
    read_ledger(project)
    for migration in migrations:
        if dry_run:
            print(f"  would record {migration.name} as applied (not executed)")
            continue
        project.query(migration.ledger_insert())
        print(f"  recorded {migration.name} as applied (not executed)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Apply Supabase schema migrations through the Management API."
    )
    parser.add_argument("files", nargs="*", help="migration files (default: every pending one)")
    parser.add_argument("--status", action="store_true", help="report applied/pending/drifted")
    parser.add_argument(
        "--mark-applied",
        action="store_true",
        help="record the given files as live WITHOUT executing them",
    )
    parser.add_argument("--sql", help="run an ad-hoc statement and print the rows")
    parser.add_argument("--dry-run", action="store_true", help="print, send nothing that writes")
    args = parser.parse_args(argv)

    try:
        project = Project.from_env()
        if args.sql:
            print(json.dumps(project.query(args.sql), indent=2, default=str))
            return 0
        migrations = discover(args.files or None)
        if args.status:
            return report_status(project, migrations)
        if args.mark_applied:
            if not args.files:
                raise MigrationError("--mark-applied needs explicit files")
            return mark_applied(project, migrations, dry_run=args.dry_run)
        return apply(project, migrations, dry_run=args.dry_run)
    except MigrationError as exc:
        print(f"migrate: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
