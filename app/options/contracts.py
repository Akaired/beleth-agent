"""Contract conventions for standard U.S. listed equity and ETF options.

The multiplier is not configuration. It is the exchange's contract specification: one
standard option covers 100 shares, so a price quoted per share is multiplied by 100 to
get the dollar amount. Making it a knob would suggest the number is ours to choose;
it is not, and a wrong value would silently mis-size every trade.

It lived in three modules and was re-typed as a bare `100` in three more places,
including fifty lines below one of the definitions. One definition, imported.
"""

from __future__ import annotations

CONTRACT_MULTIPLIER = 100
