"""Host telemetry for the resident-runner dashboard.

The agent runs as a container on a a private host that lives in someone's home; the
backoffice "Host" panel shows that machine's vital signs next to the kill switch. This
module gathers them and hands back a plain ``dict`` that goes straight into
``agent_status.detail['host']`` every heartbeat/cycle and, appended, into the
``host_metrics`` history table.

Constraints that shaped it:
  * **stdlib only** — no ``psutil``. Under Docker on Linux the host's ``/proc`` and
    ``/sys`` are visible, so ``os.getloadavg``, ``/proc/meminfo``, ``/proc/uptime`` and
    ``/sys/class/thermal`` already report the host; the container's own memory ceiling
    comes from the cgroup files.
  * **fail-open, per probe** — every reading is wrapped so a missing file or an
    unreadable path yields ``None`` for that key and never breaks the heartbeat. A
    caller can always persist whatever came back.
"""

from __future__ import annotations

import os
import resource
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, TypeVar

_T = TypeVar("_T")

# cgroup v1 uses a huge sentinel for "no limit"; at or above this counts as unlimited.
_CGROUP_UNLIMITED = 1 << 62

LOGS_DIR = Path(os.environ.get("BELETH_LOGS_DIR", "/app/logs"))


def _safe(fn: Callable[[], _T]) -> _T | None:
    """Run ``fn`` and swallow anything it raises — a probe that fails is just absent."""
    try:
        return fn()
    except Exception:
        return None


def _read_text(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _meminfo() -> dict[str, int]:
    """``/proc/meminfo`` as a ``{key: kB}`` map (host memory under Docker)."""
    out: dict[str, int] = {}
    for line in _read_text("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        out[key.strip()] = int(rest.strip().split()[0])
    return out


def _host_mem() -> dict[str, float] | None:
    mi = _meminfo()
    total_kb = mi.get("MemTotal")
    avail_kb = mi.get("MemAvailable")
    if not total_kb or avail_kb is None:
        return None
    used_pct = round((total_kb - avail_kb) / total_kb * 100, 1)
    return {
        "total_mb": round(total_kb / 1024, 1),
        "available_mb": round(avail_kb / 1024, 1),
        "used_pct": used_pct,
    }


def _container_mem() -> dict[str, float] | None:
    """Current usage and ceiling for *this container* from the cgroup (v2, then v1).

    This is the number that predicts an OOM kill — ``compose.yaml`` caps the agent at
    512 MiB. ``limit_mb`` is ``None`` when the cgroup reports no ceiling.
    """
    used = limit = None
    # cgroup v2
    if Path("/sys/fs/cgroup/memory.current").exists():
        used = int(_read_text("/sys/fs/cgroup/memory.current").strip())
        raw = _read_text("/sys/fs/cgroup/memory.max").strip()
        limit = None if raw == "max" else int(raw)
    # cgroup v1
    elif Path("/sys/fs/cgroup/memory/memory.usage_in_bytes").exists():
        used = int(_read_text("/sys/fs/cgroup/memory/memory.usage_in_bytes").strip())
        limit = int(_read_text("/sys/fs/cgroup/memory/memory.limit_in_bytes").strip())
    if used is None:
        return None
    out: dict[str, float] = {"used_mb": round(used / 1024 / 1024, 1)}
    if limit is not None and limit < _CGROUP_UNLIMITED:
        out["limit_mb"] = round(limit / 1024 / 1024, 1)
        out["used_pct"] = round(used / limit * 100, 1)
    return out


def _uptime_seconds() -> int | None:
    """Host uptime — ``/proc/uptime`` is the host's under Docker."""
    return int(float(_read_text("/proc/uptime").split()[0]))


def _load() -> list[float] | None:
    return [round(x, 2) for x in os.getloadavg()]


def _disk(path: str) -> dict[str, float] | None:
    usage = shutil.disk_usage(path)
    return {
        "total_gb": round(usage.total / 1024**3, 1),
        "free_gb": round(usage.free / 1024**3, 1),
        "used_pct": round(usage.used / usage.total * 100, 1),
    }


def _thermal_c() -> float | None:
    """Warmest CPU/ACPI zone in °C, best effort. Absent on desktops and some VMs."""
    readings: list[float] = []
    for zone in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
        raw = _safe(lambda z=zone: int((z / "temp").read_text().strip()))
        if raw is not None and 0 < raw < 200_000:
            readings.append(raw / 1000)
    for hw in sorted(Path("/sys/class/hwmon").glob("hwmon*")):
        raw = _safe(lambda h=hw: int((h / "temp1_input").read_text().strip()))
        if raw is not None and 0 < raw < 200_000:
            readings.append(raw / 1000)
    return round(max(readings), 1) if readings else None


def _process(runner_stats: Mapping[str, Any] | None) -> dict[str, Any]:
    """The runner process itself: its RSS now, plus whatever the runner passed in
    (its own start time, cycle count and last network round-trips — the cycle
    subprocess is a fresh interpreter and cannot know those)."""
    proc: dict[str, Any] = {}
    rss_kb = _safe(lambda: resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    if rss_kb:
        # ru_maxrss is kB on Linux, bytes on macOS — the container is Linux.
        proc["rss_mb"] = round(rss_kb / 1024, 1)
    sha = os.environ.get("GIT_SHA") or os.environ.get("BELETH_GIT_SHA")
    if sha:
        proc["git_sha"] = sha[:12]
    for key in ("started_at", "cycles", "last_symbol"):
        if runner_stats and runner_stats.get(key) is not None:
            proc[key] = runner_stats[key]
    return proc


def collect_host_metrics(
    runner_stats: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Best-effort snapshot of the the trading host. Never raises; a failed probe is omitted or
    ``None``. ``runner_stats`` carries values only the long-lived runner knows
    (``started_at``, ``cycles``, ``net`` = ``{"supabase_ms", "alpaca_ms"}``)."""
    metrics: dict[str, Any] = {
        "label": os.environ.get("BELETH_HOST_LABEL", "the trading host"),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "platform": _safe(_platform_info),
        "uptime_seconds": _safe(_uptime_seconds),
        "load": _safe(_load),
        "cpu_count": os.cpu_count(),
        "mem": _safe(_host_mem),
        "container_mem": _safe(_container_mem),
        "disk": _safe(lambda: _disk("/")),
        "logs_disk": _safe(lambda: _disk(str(LOGS_DIR))) if LOGS_DIR.exists() else None,
        "thermal_c": _safe(_thermal_c),
        "process": _process(runner_stats),
    }
    if runner_stats and runner_stats.get("net"):
        metrics["net"] = dict(runner_stats["net"])
    return metrics


def _platform_info() -> dict[str, str]:
    import platform

    u = platform.uname()
    return {
        "system": u.system,
        "release": u.release,
        "machine": u.machine,
        "node": os.environ.get("BELETH_HOST_LABEL") or u.node,
        "python": platform.python_version(),
    }


# --- runner-owned stats file ------------------------------------------------------------
#
# The market-hours path never calls send_heartbeat: the per-symbol cycle subprocess is a
# fresh interpreter that writes agent_status itself and has no idea how long the runner
# has been up or how many cycles it has run. The runner drops those into a small JSON
# file on the logs volume; both the heartbeat and the cycle script read it so the Host
# panel stays live during market hours too.

RUNNER_STATS_PATH = LOGS_DIR / "runner_state.json"


def write_runner_stats(stats: Mapping[str, Any]) -> None:
    """Atomically replace the runner-stats file. Fail-open: a read-only volume just
    means the cycle path reports host hardware without the runner's uptime/cycles."""
    import json

    try:
        RUNNER_STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = RUNNER_STATS_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(dict(stats)), encoding="utf-8")
        tmp.replace(RUNNER_STATS_PATH)
    except Exception:
        pass


def read_runner_stats() -> dict[str, Any] | None:
    import json

    try:
        data = json.loads(RUNNER_STATS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def new_runner_stats() -> dict[str, Any]:
    """Seed the in-memory stats the runner keeps and periodically flushes."""
    return {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "cycles": 0,
        "last_symbol": None,
        "net": {},
    }


# Kept for callers that time a network round-trip and want to fold it in.
def timed_call(fn: Callable[[], _T]) -> tuple[_T, int]:
    """Return ``(result, elapsed_ms)`` for ``fn()``."""
    start = time.monotonic()
    result = fn()
    return result, int((time.monotonic() - start) * 1000)
