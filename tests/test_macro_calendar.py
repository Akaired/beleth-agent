from datetime import datetime
from pathlib import Path

from app.market.calendar import (
    EASTERN,
    MAJOR,
    MacroEvent,
    blocked_tenors,
    load_macro_events,
    next_macro_event,
)

EVENTS_YAML = """events:
  - name: "JOLTS"
    datetime_et: "2026-09-01T10:00:00"
    importance: minor
  - name: "Nonfarm Payrolls"
    datetime_et: "2026-09-04T08:30:00"
    importance: major
"""


def _write(tmp_path: Path) -> Path:
    p = tmp_path / "macro_events.yaml"
    p.write_text(EVENTS_YAML)
    return p


def test_load_macro_events_parses_and_sorts(tmp_path):
    events = load_macro_events(_write(tmp_path))
    assert [e.name for e in events] == ["JOLTS", "Nonfarm Payrolls"]
    assert events[0].when_et.tzinfo is not None
    assert events[1].importance == MAJOR


def test_next_macro_event_respects_now_and_major_only(tmp_path):
    events = load_macro_events(_write(tmp_path))
    now = datetime(2026, 8, 28, 12, 0, tzinfo=EASTERN)
    assert next_macro_event(events, now).name == "JOLTS"
    assert next_macro_event(events, now, major_only=True).name == "Nonfarm Payrolls"


def test_next_macro_event_none_when_all_past(tmp_path):
    events = load_macro_events(_write(tmp_path))
    now = datetime(2026, 9, 10, tzinfo=EASTERN)
    assert next_macro_event(events, now) is None


def test_blocked_tenors_blocks_expiries_crossing_a_near_major_event():
    nfp = MacroEvent(
        name="Nonfarm Payrolls",
        when_et=datetime(2026, 9, 4, 8, 30, tzinfo=EASTERN),
        importance=MAJOR,
    )
    # 2 days before NFP: block window 2 days catches it.
    now = datetime(2026, 9, 2, 12, 0, tzinfo=EASTERN)
    blocks = blocked_tenors([nfp], dte_ladder=[7, 14, 21, 30, 45], now_et=now, block_within_days=2)
    # today = 2026-09-02; expiry = today + dte. All ladder tenors expire on/after 09-04.
    assert {b.dte for b in blocks} == {7, 14, 21, 30, 45}
    assert all(b.event.name == "Nonfarm Payrolls" for b in blocks)


def test_blocked_tenors_empty_when_event_outside_window():
    nfp = MacroEvent(
        name="Nonfarm Payrolls",
        when_et=datetime(2026, 9, 4, 8, 30, tzinfo=EASTERN),
        importance=MAJOR,
    )
    now = datetime(2026, 8, 28, 12, 0, tzinfo=EASTERN)  # 7 days out, window is 2
    assert blocked_tenors([nfp], dte_ladder=[7, 14, 30], now_et=now, block_within_days=2) == []


def test_blocked_tenors_ignores_minor_events_by_default():
    jolts = MacroEvent(
        name="JOLTS",
        when_et=datetime(2026, 9, 1, 10, 0, tzinfo=EASTERN),
        importance="minor",
    )
    now = datetime(2026, 8, 31, 12, 0, tzinfo=EASTERN)
    assert blocked_tenors([jolts], dte_ladder=[7, 14], now_et=now, block_within_days=2) == []
