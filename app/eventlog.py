"""Curated, webapp-facing event stream.

The runner narrates to stdout and to the rotating file on the runner's logs volume,
but the webapp can only see this database. ``EventLog`` collects a handful of
meaningful events during a run — a decision, a submitted or failed order, a risk
rejection, an exit trigger, a position anomaly, a pause/resume, an error — and
flushes them to ``agent_events`` in one request at the end.

Fail-open by construction: emitting only appends to an in-memory list, and a flush
that raises is caught, logged to stdout, and the events are dropped. Nothing here
can break a cycle.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

LEVELS = ("debug", "info", "warn", "error")


@dataclass
class _Event:
    level: str
    event: str
    message: str
    symbol: str | None
    context: dict[str, Any]


@dataclass
class EventLog:
    """Append events with :meth:`emit` (or the level shortcuts), then :meth:`flush`."""

    echo: bool = True
    _events: list[_Event] = field(default_factory=list)

    def emit(
        self,
        level: str,
        event: str,
        message: str,
        *,
        symbol: str | None = None,
        **context: Any,
    ) -> None:
        lvl = level if level in LEVELS else "info"
        self._events.append(
            _Event(
                level=lvl,
                event=str(event),
                message=str(message),
                symbol=symbol,
                context={k: v for k, v in context.items() if v is not None},
            )
        )
        if self.echo:
            tag = f"[{lvl.upper()}] {event}"
            sym = f" {symbol}" if symbol else ""
            print(f"{tag}{sym}: {message}", flush=True)

    def debug(self, event: str, message: str, **kw: Any) -> None:
        self.emit("debug", event, message, **kw)

    def info(self, event: str, message: str, **kw: Any) -> None:
        self.emit("info", event, message, **kw)

    def warn(self, event: str, message: str, **kw: Any) -> None:
        self.emit("warn", event, message, **kw)

    def error(self, event: str, message: str, **kw: Any) -> None:
        self.emit("error", event, message, **kw)

    def __len__(self) -> int:
        return len(self._events)

    def drain(self) -> list[_Event]:
        """Return the buffered events and clear the buffer."""
        out, self._events = self._events, []
        return out

    def flush(self, config: Any, *, decision_id: str | None = None) -> int:
        """Persist and clear the buffer. Returns the count written (0 on any failure
        or when Supabase is not configured)."""
        if config is None or not self._events:
            self._events.clear()
            return 0
        # Imported here so this module stays import-cheap and dependency-free.
        from app.persistence import event_rows, persist_events

        rows = event_rows(self.drain(), decision_id=decision_id)
        try:
            persist_events(config, rows)
            return len(rows)
        except Exception as exc:  # noqa: BLE001 — the event log must never be fatal
            print(f"WARNING: agent_events flush failed ({exc}) — {len(rows)} dropped", flush=True)
            return 0
