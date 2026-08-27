#!/usr/bin/env python3
"""Re-download the local Alpaca documentation cache into the local reference cache/.

local reference material at is gitignored, so a fresh clone of this repo starts without any of the
vendored reference material the coding assistant uses (see the local reference index). Run
this script once after cloning to repopulate it.

Usage:
    python3 scripts/fetch_docs.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / ".claude" / "docs"
VENDOR_DIR = DOCS_DIR / "vendor"

REPOS = {
    "alpaca-mcp-server": "https://github.com/alpacahq/alpaca-mcp-server",
    "cli": "https://github.com/alpacahq/cli",
    "alpaca-py": "https://github.com/alpacahq/alpaca-py",
}

# slug -> output filename. All served from docs.alpaca.markets (ReadMe.io).
PAGES = {
    "alpaca-mcp-server": "alpaca-mcp-server.md",
    "alpacas-cli": "alpacas-cli.md",
    "options-trading-overview": "options-trading-overview.md",
    "options-orders": "options-orders.md",
    "options-level-3-trading": "options-level-3-trading.md",
    "historical-option-data": "historical-option-data.md",
    "real-time-option-data": "real-time-option-data.md",
}

DOCS_BASE = "https://docs.alpaca.markets/docs/"


def clone_repos() -> None:
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in REPOS.items():
        target = VENDOR_DIR / name
        if target.exists():
            print(f"[skip] {name} already present at {target}")
            continue
        print(f"[clone] {url} -> {target}")
        subprocess.run(
            ["git", "clone", "--depth", "1", url, str(target)],
            check=True,
        )


def extract_body(html: str) -> str | None:
    """Pull the raw markdown 'body' field out of ReadMe.io's SSR props payload."""
    m = re.search(
        r'<script id="ssr-props" type="application/x-ssr-props">(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        return None
    raw = unescape(m.group(1))
    idx = raw.find('"body":"')
    if idx == -1:
        return None
    idx += len('"body":"')
    out = []
    i = idx
    while i < len(raw):
        c = raw[i]
        if c == "\\":
            out.append(raw[i : i + 2])
            i += 2
            continue
        if c == '"':
            break
        out.append(c)
        i += 1
    return json.loads('"' + "".join(out) + '"')


def fetch_pages() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for slug, filename in PAGES.items():
        url = DOCS_BASE + slug
        print(f"[fetch] {url}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            print(f"  !! failed: {exc}", file=sys.stderr)
            continue
        body = extract_body(html)
        if not body:
            print(f"  !! could not extract body for {slug}", file=sys.stderr)
            continue
        (DOCS_DIR / filename).write_text(body, encoding="utf-8")
        print(f"  -> saved {filename} ({len(body)} chars)")


def main() -> None:
    clone_repos()
    fetch_pages()
    print("\nDone. See the local reference index for what's here and why.")


if __name__ == "__main__":
    main()
