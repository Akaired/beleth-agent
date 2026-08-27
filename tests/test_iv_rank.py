import pytest

from app.options.iv_rank import compute_iv_rank


def test_no_history_returns_none_rank():
    result = compute_iv_rank(history=[], current_iv=0.2, lookback_days=30)
    assert result.rank is None
    assert result.history_points == 0
    assert not result.has_sufficient_history


def test_rank_at_max_of_range():
    result = compute_iv_rank(history=[0.1, 0.2, 0.3], current_iv=0.3, lookback_days=3)
    assert result.rank == 100.0
    assert result.has_sufficient_history


def test_rank_at_min_of_range():
    result = compute_iv_rank(history=[0.1, 0.2, 0.3], current_iv=0.1, lookback_days=3)
    assert result.rank == 0.0


def test_rank_midpoint():
    result = compute_iv_rank(history=[0.1, 0.3], current_iv=0.2, lookback_days=2)
    assert result.rank == pytest.approx(50.0)


def test_insufficient_history_flagged():
    result = compute_iv_rank(history=[0.1, 0.2], current_iv=0.15, lookback_days=30)
    assert result.history_points == 2
    assert not result.has_sufficient_history


def test_degenerate_history_no_variation():
    result = compute_iv_rank(history=[0.2, 0.2, 0.2], current_iv=0.2, lookback_days=3)
    assert result.rank == 0.0
