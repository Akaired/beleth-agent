from datetime import datetime

from app.evidence import AccountSnapshot, build_evidence_package
from app.market.calendar import EASTERN, MAJOR, MacroEvent, TenorBlock
from app.market.realized_vol import RealizedVolResult
from app.market.term_structure import CONTANGO, TermStructure
from app.market.vix import VixRegime
from app.vrp import TenorVrp
from datetime import date


def _rv(w, v):
    return RealizedVolResult(window_days=w, value=v, returns_used=w)


def _base_kwargs():
    now_et = datetime(2026, 8, 28, 10, 0, tzinfo=EASTERN)
    event = MacroEvent(
        name="Nonfarm Payrolls",
        when_et=datetime(2026, 9, 4, 8, 30, tzinfo=EASTERN),
        importance=MAJOR,
    )
    return dict(
        as_of=datetime(2026, 8, 28, 14, 0),
        market_open=True,
        underlying_symbol="SPY",
        underlying_last=451.2,
        realized_vols={10: _rv(10, 0.11), 20: _rv(20, 0.134), 30: _rv(30, 0.14)},
        vix_regime=VixRegime(
            level=15.45, as_of=date(2026, 8, 25), percentile_1y=42.0, rank_1y=30.0, lookback_points=252
        ),
        vix_error=None,
        term_structure=TermStructure(CONTANGO, 0.150, 0.180, 7, 45),
        tenor_vrp=[
            TenorVrp(dte=7, atm_iv=0.150, vrp_vs_rv20=1.6, passes_threshold=True),
            TenorVrp(dte=30, atm_iv=0.180, vrp_vs_rv20=4.6, passes_threshold=True),
        ],
        next_event=event,
        blocked_tenors=[TenorBlock(dte=7, expiry=date(2026, 9, 4), event=event)],
        now_et=now_et,
        candidates=[],
        account=AccountSnapshot(
            cash=100000.0, buying_power=400000.0, open_positions=0, day_pnl=0.0,
            risk_budget_remaining_today=2000.0,
        ),
    )


def test_package_has_the_agreed_top_level_shape():
    pkg = build_evidence_package(**_base_kwargs())
    assert set(pkg) == {
        "as_of", "market_open", "underlying", "vix", "vrp", "calendar",
        "candidates", "open_positions_detail", "account",
    }
    assert pkg["open_positions_detail"] == []
    assert pkg["underlying"]["realized_vol"] == {"10d": 0.11, "20d": 0.134, "30d": 0.14}
    assert pkg["vix"]["term_structure"] == CONTANGO
    # vix_minus_rv20 = 15.45 - 13.4 = 2.05
    assert pkg["vrp"]["vix_minus_rv20"] == 2.05
    assert pkg["calendar"]["blocks_tenors"] == [7]
    assert pkg["calendar"]["next_macro_event"]["days_away"] == 6.94
    assert [t["dte"] for t in pkg["vrp"]["per_tenor"]] == [7, 30]


def test_package_handles_missing_vix():
    kwargs = _base_kwargs()
    kwargs["vix_regime"] = None
    kwargs["vix_error"] = "FRED unreachable"
    pkg = build_evidence_package(**kwargs)
    assert pkg["vix"]["level"] is None
    assert pkg["vix"]["error"] == "FRED unreachable"
    assert pkg["vrp"]["vix_minus_rv20"] is None
