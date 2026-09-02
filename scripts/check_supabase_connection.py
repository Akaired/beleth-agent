#!/usr/bin/env python3
"""Verify the Supabase connection and that the expected tables exist.

Read-only verification that SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY work and that the
migration (db/migrations/0001_initial_schema.sql) has been applied. With --smoke it
additionally runs the self-cleaning write/read/delete round trip from app/persistence
(marked rows, agent_version='smoke-test' — a leaked row is identifiable and filterable).

Usage:
    python3 scripts/check_supabase_connection.py [--smoke]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ConfigError, get_settings
from app.persistence import (
    EXPECTED_TABLES,
    PersistenceConfigError,
    PersistenceError,
    fetch_table_names,
    smoke_test,
    supabase_config_from_settings,
)


def main() -> int:
    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    try:
        config = supabase_config_from_settings(settings)
    except PersistenceConfigError as exc:
        print(f"Supabase not configured — {exc}", file=sys.stderr)
        return 1
    print(f"Supabase project: {config.base_url}")

    try:
        tables = fetch_table_names(config)
    except PersistenceError as exc:
        print(f"Supabase unreachable — {exc}", file=sys.stderr)
        return 1

    print(f"PostgREST reachable; {len(tables)} schema object(s) visible to the service role.\n")
    missing = []
    for table in EXPECTED_TABLES:
        if table in tables:
            print(f"  {table:<15} ok")
        else:
            missing.append(table)
            print(f"  {table:<15} MISSING — apply db/migrations/0001_initial_schema.sql")

    if missing:
        print(
            f"\n{len(missing)} expected table(s) missing — "
            "the migration has not been applied (or was applied to another project).",
            file=sys.stderr,
        )
        return 1

    if "--smoke" in sys.argv[1:]:
        print("\nSmoke test (self-cleaning write/read/delete round trip):")
        try:
            results = smoke_test(config)
        except PersistenceError as exc:
            print(f"  FAILED — {exc}", file=sys.stderr)
            return 1
        for name, ok in results.items():
            print(f"  {'PASS' if ok else 'FAIL'}  {name}")
        if not all(results.values()):
            print("\nOne or more smoke steps failed.", file=sys.stderr)
            return 1
        print("\nSmoke test passed — the write path works end to end.")

    print("\nAll five expected tables present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
