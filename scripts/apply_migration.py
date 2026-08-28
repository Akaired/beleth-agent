#!/usr/bin/env python3
"""Apply one SQL migration to the Supabase project, without the dashboard.

The service-role key speaks only PostgREST, which cannot run DDL — so schema changes go
through the Management API's SQL endpoint:

    POST https://api.supabase.com/v1/projects/{ref}/database/query
    Authorization: Bearer {SUPABASE_ACCESS_TOKEN}
    body: {"query": "<sql>"}

Reads ``SUPABASE_URL`` and ``SUPABASE_ACCESS_TOKEN`` from ``.env`` (the token is a PAT
with database admin rights — it lives in ``.env`` only and is never printed here, not
even truncated).

Usage:
    python3 scripts/apply_migration.py db/migrations/0002_exit_trades.sql
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_migration.py <migration.sql>", file=sys.stderr)
        return 1
    sql_path = Path(sys.argv[1])
    if not sql_path.is_file():
        print(f"migration file not found: {sql_path}", file=sys.stderr)
        return 1

    env = _load_env(REPO_ROOT / ".env")
    token = env.get("SUPABASE_ACCESS_TOKEN", "").strip()
    base_url = env.get("SUPABASE_URL", "").strip().rstrip("/")
    missing = [
        name
        for name, value in (("SUPABASE_ACCESS_TOKEN", token), ("SUPABASE_URL", base_url))
        if not value
    ]
    if missing:
        print(f"missing in .env: {', '.join(missing)}", file=sys.stderr)
        return 1
    project_ref = base_url.split("//", 1)[1].split(".", 1)[0]

    sql = sql_path.read_text(encoding="utf-8")
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
        data=json.dumps({"query": sql}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # Cloudflare (error 1010) blocks requests with no user agent — urllib's
            # default "Python-urllib/3.x" gets 403'd at the edge, so name the tool.
            "User-Agent": "beleth-agent/apply-migration",
        },
        method="POST",
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", errors="replace")
            print(f"{sql_path.name}: HTTP {response.status}")
            if body.strip():
                print(body[:2000])
    except urllib.error.HTTPError as exc:
        print(f"{sql_path.name}: FAILED — HTTP {exc.code}: {exc.read()[:500]!r}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"{sql_path.name}: request failed — {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())