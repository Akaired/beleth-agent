"""Unit tests for app/eventlog.py + the agent_events row shaping in persistence."""

from app.eventlog import EventLog
from app.persistence import event_rows


def test_emit_and_drain_clears_buffer():
    el = EventLog(echo=False)
    el.info("decision", "no-trade", symbol="SPY", action="no_trade")
    el.warn("risk_rejected", "1/3 cleared", rules=["R4"])
    assert len(el) == 2
    drained = el.drain()
    assert len(drained) == 2
    assert len(el) == 0


def test_level_shortcuts_and_unknown_level_falls_back():
    el = EventLog(echo=False)
    el.debug("x", "d")
    el.emit("bogus", "y", "m")
    lvls = [e.level for e in el.drain()]
    assert lvls == ["debug", "info"]


def test_none_context_values_are_dropped():
    el = EventLog(echo=False)
    el.info("order_submitted", "ok", alpaca_order_id="abc", credit=None, qty=1)
    row = event_rows(el.drain())[0]
    assert row["context"] == {"alpaca_order_id": "abc", "qty": 1}


def test_event_rows_stamps_decision_id_and_symbol():
    el = EventLog(echo=False)
    el.info("decision", "traded", symbol="QQQ")
    el.info("cycle_end", "done")  # no symbol
    rows = event_rows(el.drain(), decision_id="d-1")
    assert rows[0]["symbol"] == "QQQ"
    assert "symbol" not in rows[1]
    assert all(r["decision_id"] == "d-1" for r in rows)


def test_flush_without_config_is_noop_and_clears():
    el = EventLog(echo=False)
    el.info("decision", "x")
    assert el.flush(None) == 0
    assert len(el) == 0


def test_flush_swallows_persist_failure(monkeypatch):
    import app.persistence as p

    def boom(*_a, **_k):
        raise RuntimeError("network down")

    monkeypatch.setattr(p, "persist_events", boom)
    el = EventLog(echo=False)
    el.info("decision", "x")
    # A truthy config object; flush must catch the RuntimeError and return 0.
    assert el.flush(object()) == 0
    assert len(el) == 0
