from datetime import date

import pytest

from app.occ import InvalidOccSymbolError, parse_occ_symbol


def test_parses_standard_spy_symbol():
    occ = parse_occ_symbol("SPY260904C00450000")
    assert occ.root == "SPY"
    assert occ.expiry == date(2026, 9, 4)
    assert occ.right == "C"
    assert occ.strike == 450.0


def test_parses_fractional_strike_and_put():
    occ = parse_occ_symbol("QQQ261218P00387500")
    assert occ.right == "P"
    assert occ.strike == 387.5
    assert occ.expiry == date(2026, 12, 18)


def test_rejects_garbage():
    with pytest.raises(InvalidOccSymbolError):
        parse_occ_symbol("not-a-symbol")


def test_rejects_equity_ticker():
    with pytest.raises(InvalidOccSymbolError):
        parse_occ_symbol("SPY")
