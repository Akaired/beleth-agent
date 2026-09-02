"""Unit tests for app/hostinfo.py — every probe must be fail-open and the snapshot
must stay JSON-serialisable whatever the host looks like."""

import json

import pytest

from app import hostinfo


def test_collect_returns_json_safe_dict_with_core_keys():
    m = hostinfo.collect_host_metrics()
    json.dumps(m)  # must not raise
    for key in (
        "label",
        "captured_at",
        "platform",
        "load",
        "cpu_count",
        "mem",
        "container_mem",
        "disk",
        "thermal_c",
        "process",
    ):
        assert key in m


def test_label_from_env(monkeypatch):
    monkeypatch.setenv("BELETH_HOST_LABEL", "test-box")
    assert hostinfo.collect_host_metrics()["label"] == "test-box"


def test_every_probe_failure_is_swallowed(monkeypatch):
    """If the filesystem probes all raise, collect() still returns a dict."""

    def boom(*_a, **_k):
        raise OSError("no /proc here")

    monkeypatch.setattr(hostinfo, "_read_text", boom)
    monkeypatch.setattr(hostinfo.shutil, "disk_usage", boom)
    monkeypatch.setattr(hostinfo.os, "getloadavg", boom)

    m = hostinfo.collect_host_metrics()
    assert m["load"] is None
    assert m["mem"] is None
    assert m["disk"] is None
    assert m["uptime_seconds"] is None
    json.dumps(m)


def test_host_mem_math(monkeypatch):
    monkeypatch.setattr(
        hostinfo,
        "_read_text",
        lambda _p: "MemTotal:       8000000 kB\nMemAvailable:   2000000 kB\n",
    )
    mem = hostinfo._host_mem()
    assert mem == {
        "total_mb": pytest.approx(7812.5),
        "available_mb": pytest.approx(1953.1),
        "used_pct": 75.0,
    }


def test_container_mem_v2(monkeypatch, tmp_path):
    cur = tmp_path / "memory.current"
    cur.write_text("83886080")  # 80 MiB
    mx = tmp_path / "memory.max"
    mx.write_text("536870912")  # 512 MiB

    def fake_read(p):
        return (tmp_path / p.split("/")[-1]).read_text()

    monkeypatch.setattr(hostinfo.Path, "exists", lambda self: self.name == "memory.current")
    monkeypatch.setattr(hostinfo, "_read_text", fake_read)

    cm = hostinfo._container_mem()
    assert cm["used_mb"] == pytest.approx(80.0)
    assert cm["limit_mb"] == pytest.approx(512.0)
    assert cm["used_pct"] == pytest.approx(15.6, abs=0.1)


def test_container_mem_unlimited_omits_limit(monkeypatch):
    reads = iter(["4096", "max"])
    monkeypatch.setattr(hostinfo.Path, "exists", lambda self: self.name == "memory.current")
    monkeypatch.setattr(hostinfo, "_read_text", lambda _p: next(reads))
    cm = hostinfo._container_mem()
    assert "limit_mb" not in cm and "used_pct" not in cm
    assert cm["used_mb"] == pytest.approx(0.0, abs=0.01)


def test_runner_stats_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(hostinfo, "RUNNER_STATS_PATH", tmp_path / "runner_state.json")
    stats = hostinfo.new_runner_stats()
    stats["cycles"] = 7
    stats["last_symbol"] = "SPY"
    hostinfo.write_runner_stats(stats)
    back = hostinfo.read_runner_stats()
    assert back["cycles"] == 7 and back["last_symbol"] == "SPY"


def test_read_runner_stats_missing_is_none(monkeypatch, tmp_path):
    monkeypatch.setattr(hostinfo, "RUNNER_STATS_PATH", tmp_path / "nope.json")
    assert hostinfo.read_runner_stats() is None


def test_process_folds_in_runner_stats(monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abcdef1234567890")
    proc = hostinfo._process(
        {"started_at": "2026-08-30T00:00:00Z", "cycles": 12, "last_symbol": "SPY"}
    )
    assert proc["git_sha"] == "abcdef123456"  # truncated to 12
    assert proc["started_at"] == "2026-08-30T00:00:00Z"
    assert proc["cycles"] == 12
