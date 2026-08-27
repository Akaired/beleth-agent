from dataclasses import dataclass

from app.options.filter import filter_relevant_contracts


@dataclass
class FakeGreeks:
    delta: float
    gamma: float = 0.01
    rho: float = 0.0
    theta: float = -0.02
    vega: float = 0.03


@dataclass
class FakeSnapshot:
    greeks: FakeGreeks | None
    implied_volatility: float | None = 0.2


def test_keeps_contracts_within_delta_band():
    snapshots = {
        "IN_BAND_CALL": FakeSnapshot(greeks=FakeGreeks(delta=0.20)),
        "IN_BAND_PUT": FakeSnapshot(greeks=FakeGreeks(delta=-0.18)),
        "TOO_LOW": FakeSnapshot(greeks=FakeGreeks(delta=0.05)),
        "TOO_HIGH": FakeSnapshot(greeks=FakeGreeks(delta=0.60)),
        "NO_GREEKS": FakeSnapshot(greeks=None),
    }

    result = filter_relevant_contracts(snapshots, delta_min=0.15, delta_max=0.25)

    symbols = {c.symbol for c in result}
    assert symbols == {"IN_BAND_CALL", "IN_BAND_PUT"}


def test_empty_chain_returns_empty_list():
    assert filter_relevant_contracts({}, delta_min=0.15, delta_max=0.25) == []
