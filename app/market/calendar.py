"""Macro-event calendar and the R3 tenor gate.

The agent does not open a position whose expiry falls on or after a known macro event when
that event is within N days (default 2, `macro_calendar.block_within_days`). Short-dated
implied volatility ahead of an event is dominated by the jump premium for that event — which
is exactly the tail risk that wrecks short-vol strategies. See docs/strategy.md A3 / R3.

For the hackathon the event list is a hand-maintained YAML file, not a calendar-provider
integration (note C). Times are US Eastern.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

EASTERN = ZoneInfo("America/New_York")

MAJOR = "major"
MINOR = "minor"


@dataclass(frozen=True)
class MacroEvent:
    name: str
    when_et: datetime  # tz-aware, America/New_York
    importance: str  # MAJOR | MINOR
    source: str = ""

    @property
    def day(self) -> date:
        return self.when_et.date()


def load_macro_events(path: str | Path) -> list[MacroEvent]:
    raw = yaml.safe_load(Path(path).read_text())
    events: list[MacroEvent] = []
    for item in (raw or {}).get("events", []):
        when = datetime.fromisoformat(item["datetime_et"])
        if when.tzinfo is None:
            when = when.replace(tzinfo=EASTERN)
        events.append(
            MacroEvent(
                name=item["name"],
                when_et=when,
                importance=str(item.get("importance", MINOR)).lower(),
                source=item.get("source", ""),
            )
        )
    events.sort(key=lambda e: e.when_et)
    return events


def next_macro_event(
    events: list[MacroEvent], now_et: datetime, major_only: bool = False
) -> MacroEvent | None:
    for event in events:  # events is sorted ascending
        if event.when_et < now_et:
            continue
        if major_only and event.importance != MAJOR:
            continue
        return event
    return None


@dataclass(frozen=True)
class TenorBlock:
    dte: int
    expiry: date
    event: MacroEvent


def blocked_tenors(
    events: list[MacroEvent],
    dte_ladder: list[int],
    now_et: datetime,
    block_within_days: int,
    major_only: bool = True,
) -> list[TenorBlock]:
    """Which ladder tenors R3 blocks right now.

    A tenor (its expiry = today + dte) is blocked if there is an event E such that:
      * E is still in the future, and within `block_within_days` days of now, and
      * the tenor's expiry falls on or after E's date
        (holding a short-premium position through the event is the thing we refuse).
    """
    today = now_et.date()
    horizon = now_et + timedelta(days=block_within_days)

    upcoming = [
        e
        for e in events
        if now_et <= e.when_et <= horizon and (not major_only or e.importance == MAJOR)
    ]
    if not upcoming:
        return []

    blocks: list[TenorBlock] = []
    for dte in dte_ladder:
        expiry = today + timedelta(days=dte)
        hits = [e for e in upcoming if expiry >= e.day]
        if hits:
            # Attribute the block to the earliest event it crosses.
            blocks.append(TenorBlock(dte=dte, expiry=expiry, event=hits[0]))
    return blocks
