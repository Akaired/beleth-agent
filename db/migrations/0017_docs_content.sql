-- 0017_docs_content.sql — six more published documentation pages.
--
-- Same shape as the seed at the foot of 0016_docs.sql: a raw INSERT per page
-- (this migration runs as the service role, so it writes docs_pages directly —
-- the beleth_docs_* RPCs are for the webapp, which has no service-role client).
-- Every page is authored in Beleth's voice: dry, technical, no hype, states the
-- "why", admits the limits. All content is editable afterwards from
-- /dashboard/admin/docs.
--
--   overview   : + architecture                     (order_index 2)
--   strategy   : (unchanged)
--   operating  : + position-sizing                  (order_index 1)
--                + order-failures-and-partial-fills  (order_index 2)
--                + data-sources-and-fallbacks        (order_index 3)
--   judges     : + quick-start-for-judges            (order_index 0)
--                reading-the-dashboard bumped         0 -> 1
--                + backtest-and-track-record         (order_index 2)
--
-- Idempotent: INSERTs are `on conflict (slug) do nothing`; the one reorder is a
-- plain UPDATE. Applied by hand:
--   uv run python scripts/apply_migration.py db/migrations/0017_docs_content.sql

-- ── make room in the "judges" category ────────────────────────────────────
update public.docs_pages
   set order_index = 1
 where slug = 'reading-the-dashboard'
   and order_index = 0;

-- ── new pages ────────────────────────────────────────────────────────────
insert into public.docs_pages
  (slug, category, title, summary, status, order_index, author_name, published_at, content_md)
values
  (
    'quick-start-for-judges', 'judges', 'Quick start for judges',
    'Five pages, in order, for a reviewer with five minutes: what it is, the edge, the loop, how risky trades are stopped, and where to watch it live.',
    'published', 0, 'Beleth', now(),
    $md$If you have five minutes and do not want to navigate the sidebar yourself,
read these five pages in order. Each one links onward.

## The five-minute path

1. **[What Beleth is](/docs/what-beleth-is)** — one page. An autonomous agent
   that sells a *measured* volatility risk premium through defined-risk vertical
   spreads on an Alpaca **paper** account, and stays out when the premium is not
   there. What it deliberately does not do is on the same page.
2. **[The volatility risk premium](/docs/the-volatility-risk-premium)** — the
   edge it is trying to collect, why that edge exists, and why it is not always
   there. This is the "is the idea sound?" page.
3. **[How a cycle works](/docs/how-a-cycle-works)** — the six steps every
   decision runs through, from reading the VIX regime to submitting an order or
   writing down why it did not.
4. **[Risk checks and the kill switch](/docs/risk-checks-and-the-kill-switch)**
   — the explicit pre-trade check every order passes, and the fact that its
   rejections are logged and shown with the same weight as fills. This is the
   "is it safe?" page.
5. **[Reading the dashboard](/docs/reading-the-dashboard)** — a 30-second tour
   of the public homepage so the live numbers mean something.

## If you have longer

- **[Architecture](/docs/architecture)** — the two processes, how they
  communicate, and what happens when one goes down.
- **[Position sizing](/docs/position-sizing)** — how each trade is sized against
  equity, with a worked example.
- **[Order failures and partial fills](/docs/order-failures-and-partial-fills)**
  — what happens when an order is rejected or an account ends up unbalanced.
- **[Data sources and fallbacks](/docs/data-sources-and-fallbacks)** — where the
  VIX and the option prices come from, and the behaviour when a feed is down.
- **[Backtest and track record](/docs/backtest-and-track-record)** — why there
  is no historical backtest, and what stands in its place.

Everything a decision used is in the log. The dashboard's decision history shows
the raw model reasoning, the full risk-check detail, and every reconstructed
position — read-only for the demo admin account.
$md$
  ),
  (
    'architecture', 'overview', 'Architecture',
    'Two independent processes that only ever talk through a shared Supabase database, so the public dashboard stays up even when the trading host is off.',
    'published', 2, 'Beleth', now(),
    $md$Beleth is deliberately not a monolith. It is two processes that share one
database and never call each other directly. The split is a reliability choice:
the public showcase stays reachable and shows the last known state even if the
trading machine is switched off — only the production of *new* decisions pauses.

## The agent

A Python 3.11 process on a private host, packaged as a
single Docker service with `restart: unless-stopped`. It is **outbound-only** —
no inbound ports, no public domain, nothing to reach it from the internet.

A resident loop (`scripts/run_agent.py`) runs one cycle per symbol by launching
`scripts/check_market_data.py` as a fresh subprocess each time, so a crash or
hang dies with the subprocess and the loop survives. Market hours come from the
Alpaca clock: full cycles run every ~5 minutes only while the market is open;
outside hours the loop just writes an `agent_status` heartbeat every ~15 minutes
so the dashboard can tell "alive, market closed" from "agent down". It reads the
`agent_status.paused` kill-switch flag every iteration and fails closed. A
512 MiB memory cap turns any leak into a clean restart rather than a starved
host.

Stack: `alpaca-py` for paper trading and market data, the OpenAI SDK pointed at
OpenRouter for the LLM decision layer (a free tool-calling model, swappable by
config), plus `httpx`, `pydantic-settings`, `pyyaml`. If the model call fails,
the cycle degrades to the deterministic no-trade — never to a trade.

## The webapp

A Next.js 16 App Router app (React 19, Tailwind v4) on Vercel — public homepage
and authenticated dashboard in one deploy. It reads Supabase with the anon key
under row-level security for anonymous, public-user and demo-admin views, and
uses the service role only for master-admin server actions. It also reads the
Alpaca paper account directly, server-side, for the live equity curve and
positions.

## The shared database

Supabase Postgres is the single source of truth. The agent writes every
decision, risk-check outcome, trade, heartbeat and event with service-role
credentials; the webapp reads. Supabase Auth carries the four access states. The
kill switch is the one control that flows the other way: the webapp calls an
RPC that sets `agent_status.paused`, and the runner obeys it on its next loop.

## Data flow

```
        private host — Docker, outbound-only
        +---------------------------------------------+
        |  run_agent.py  (resident loop)              |
        |    -> check_market_data.py  (one cycle)     |
        |       evidence -> risk gate -> decide       |
        +------+------------------------+-------------+
               | reads                  | writes (service role)
               v                        v
   Alpaca paper API            Supabase Postgres  <--- single source of truth
   FRED VIXCLS CSV             decisions, risk_checks, trades,
   OpenRouter (LLM)            agent_status, agent_events, host_metrics
                                        ^      ^
                          reads (anon   |      | Auth (4 access states)
                          key + RLS)    |      |
                              +---------+------+----------+
                              |  Next.js webapp (Vercel)  |
                              |  homepage + dashboard     |
                              +------------+--------------+
                                           | also reads (server-only keys)
                                           v
                                    Alpaca paper API
                                    (live equity curve, positions)
```

## When something goes down

- **Agent host offline** — the dashboard still serves the last persisted state
  plus live Alpaca reads; only new decisions stop. The heartbeat age tells a
  reader which it is.
- **Webapp / Vercel offline** — the agent keeps trading and persisting; the
  dashboard catches up when it returns.
- **Supabase unreachable from the agent** — the cycle cannot persist, so **no
  order is sent**: an order never goes out unlogged.
- **OpenRouter down** — deterministic no-trade.
- **FRED down** — the cycle trades without the VIX size taper and says so (see
  [Data sources and fallbacks](/docs/data-sources-and-fallbacks)).
$md$
  ),
  (
    'position-sizing', 'operating', 'Position sizing',
    'How many spreads a trade gets: a whole-number division of the per-trade risk budget by the spread''s known max loss, then scaled down by the VIX regime and capped across the whole book.',
    'published', 1, 'Beleth', now(),
    $md$Every spread has a known maximum loss before it is sent — `(strike width −
credit) × 100` per contract. Sizing is just: how many of those fit inside the
risk budget?

## The base calculation

The per-trade budget is `risk.max_risk_per_trade_pct_of_equity` percent of
account equity — **2%**, the upper bound of a conventional 1–2% band, used as a
hard cap. The quantity is a floor division:

```
cap      = equity × 2%
quantity = floor(cap ÷ max_loss_per_spread)
```

Whole spreads only. If even one spread would break the cap — or equity or max
loss is unusable — the quantity is **0** and the cycle logs a no-trade instead
of sending a fractional or oversized order.

## The VIX regime taper (R9)

Before that division, the budget is scaled by a multiplier read off the VIX's
own 1-year percentile. Full size at or above the 25th percentile; a straight
line down to a **0.5×** floor at the 3rd percentile; **strictly below the 3rd
percentile, no new entry at all** (a logged R9 rejection). This is complacency
insurance: a very low VIX is a weak timing signal, so the response is a smaller
trade, not a market call — except in the extreme tail, where it is a hard stop.
The tapered budget is what the division above uses, so a deep-enough taper can
by itself take the quantity to 0.

## The aggregate cap (R11)

A second, account-level gate: the summed max loss of all open spreads, plus this
candidate's max loss, must stay within `risk.max_aggregate_risk_pct_of_equity`
— **6%** of equity, twice the 3% daily-drawdown stop. SPY and QQQ move together
(~0.95 correlated), so the book is treated as one directional short-volatility
bet, not a diversified set. Past the cap, the entry is rejected until open risk
comes down.

## A worked example

Equity **$100,000**. A 5-wide SPY put spread measured at **$1.20** credit:

- **Max loss per spread** = (5 − 1.20) × 100 = **$380**.
- **Base budget** = 2% × $100,000 = **$2,000** → floor(2000 ÷ 380) = **5
  spreads**, combined max loss **$1,900** (1.9% of equity).
- **VIX taper.** With the VIX 1-year percentile near 4 — roughly where it sat
  when the taper went live — the multiplier is about **0.52**. Budget becomes
  $1,040 → floor(1040 ÷ 380) = **2 spreads**, combined max loss **$760**.
- **Aggregate cap.** If $900 is already at risk across an open QQQ spread,
  projected book risk is $1,660, well inside the $6,000 cap — the trade clears.
  If instead $5,400 were already at risk, the projection is $6,160, past the
  cap: an R11 rejection, no new entry.

Every one of these numbers is written to the decision log, whether the trade
went out or not.
$md$
  ),
  (
    'data-sources-and-fallbacks', 'operating', 'Data sources and fallbacks',
    'Where the VIX comes from (FRED VIXCLS), what happens when a feed is unreachable, how often it is read, and how option prices are pulled for pricing.',
    'published', 3, 'Beleth', now(),
    $md$Beleth reads three outside feeds each cycle: the VIX from FRED, underlying
prices and history from Alpaca, and the option chain from Alpaca. Each has a
defined behaviour when it is missing — none of them is faked.

## The VIX regime feed

Alpaca does not provide index data, so the VIX comes from **FRED, series
`VIXCLS`** — the CBOE VIX daily close, history back to 1990, pulled from the
free CSV endpoint with no API key. It is used as a *regime* read (its own
1-year percentile over the trailing 252 observations), never as a proxy for the
implied volatility of the contracts actually traded.

If FRED fails, the fetch falls back to **CBOE's own published `VIX_History.csv`**.
A proxy index or a volatility ETF is never substituted. An HTTP 401/403 is
treated as "needs a key we will not register without a go-ahead" and counts as
unavailable.

## When the VIX is unavailable

Both sources failing raises `VixDataUnavailable`, which the cycle catches: it
records the error, prints a warning, and **continues without the VIX taper** —
an absent VIX returns a neutral 1.0× multiplier, not a block. The real regime
gate is the IV term structure (backwardation), derived from the SPY chain
itself. The evidence package stores the VIX `as_of` date, so a reader can see
how fresh the reading was; there is no hard "reject if older than N days"
guard — the latest published close is used as-is.

## How often it reads

Once per cycle. While the market is open the loop runs a cycle per symbol every
~5 minutes, so every feed is re-read on that cadence. `VIXCLS` is a daily
series, so intraday it does not move — it effectively refreshes once per trading
day when FRED posts the new close. Outside market hours the loop only
heartbeats; nothing is fetched.

## Prices for pricing options

- **Underlying** (SPY/QQQ): the latest trade for at-the-money strike selection,
  and split/dividend-adjusted daily closes for the realized-volatility windows
  (10/20/30 days, annualized over 252).
- **Entry**: one option-chain request per symbol, filtered server-side to the
  DTE ladder window. Each contract comes back as a snapshot with quote and
  Greeks/IV; the delta and width filters run locally. The spread's credit is
  measured from the leg mid quotes — and a mid is an indication, not a fillable
  price, which is why the order path subtracts a slippage concession.
- **Exit**: the latest quote on the exact contracts an open spread holds (they
  can sit outside any chain window). A missing or unusable quote means "cannot
  measure, do not act" — the position is held, and only the short-leg
  in-the-money rule, which needs just the strike and the underlying, still
  fires.

## Data quality, stated plainly

The account is on Alpaca's **Basic** data plan: the options feed is
*indicative*, not full OPRA, and historical data excludes the most recent 15
minutes. The implied volatility Beleth reasons over is therefore less precise
than a professional's. Any P&L should be read with that in mind.
$md$
  ),
  (
    'order-failures-and-partial-fills', 'operating', 'Order failures and partial fills',
    'One multi-leg order per spread makes a half-filled spread structurally impossible; what the agent does when a submission is rejected or the account ends up unbalanced anyway.',
    'published', 2, 'Beleth', now(),
    $md$## One order, both legs

Every entry and every exit is a **single multi-leg (`mleg`) order** with both
legs inside it — never two separate orders, never a naked leg. Alpaca fills the
package against one net limit price, which is what makes the classic failure —
one leg fills, the other does not, leaving unhedged exposure — structurally
unavailable here. Alpaca's own documentation puts it as reducing "the chance of
partial fills that could distort the intended strategy". Options orders are
day-only, so an unfilled order simply expires at the close and the next cycle
re-evaluates from scratch.

## When a submission is rejected

`submit_mleg_order` wraps any API error as one `OrderSubmissionError` and **does
not retry** — a silent retry could double a position. The cycle catches it and
persists a `trades` row with `status = 'submission_failed'` and the broker's
message, emits an `order_failed` (or `exit_failed`) event, and prints the error.
The rejection is a first-class row in the decision log and shows in the
dashboard with the same weight as a fill.

Several checks stop an order before it is even built, each logging its reason
instead of sending: no fillable net-credit limit exists; being marketable would
concede more than half the measured credit; or the sized quantity came out at
zero.

## No silent stacking

Because the loop runs every few minutes, a resting order is committed risk the
position count cannot see. So if an entry order is already resting on the
account, **R10 rejects every new entry that cycle** — no stacking of unfilled
entries (this was a real day-one incident, since fixed). An order whose legs
cannot be read is treated as opening risk, not ignored. On the exit side, a
triggered close whose spread already has a working closing order is skipped, not
duplicated.

## If the account still ends up unbalanced

Each cycle pairs the account's open option legs back into spreads. Anything that
does not pair — a lone short leg (naked exposure), an unpaired long, a
non-option position — is surfaced as an **anomaly**: it is written to the log,
raised as a `position_anomaly` event, and **blocks all new entries until it is
resolved**. There is no automatic unwind. The agent's response to an unexpected
account state is to stop adding risk and make the problem visible, not to trade
its way out of it — clearing it is an operator action.
$md$
  ),
  (
    'backtest-and-track-record', 'judges', 'Backtest and track record',
    'There is no historical backtest, on purpose. The validation is a live paper-trading decision log — every input, every rejection, every fill, timestamped and append-only.',
    'published', 2, 'Beleth', now(),
    $md$**There is no historical backtest of this strategy, and that is a deliberate
choice, not an omission.** The parameters in `config/strategy.yaml` are
industry-conventional starting values for a short-vertical-spread strategy, not
numbers fitted to past data. The code, the README and the config all say so in
those words.

## Why not

- **The data to do it credibly does not exist here.** A trustworthy options
  backtest needs historical option chains with quotes and Greeks at each entry
  time. The Basic Alpaca plan does not provide that history. A backtest built on
  synthetic IV, or on the VIX as a stand-in for contract IV, would be *worse*
  than none — it would carry the authority of a backtest with none of the
  validity, and the strategy notes explicitly forbid using the VIX that way.
- **The edge is documented, not discovered by us.** The volatility risk premium
  is well established in the academic literature. `docs/strategy.md` organises
  every claim behind the strategy by reliability tier — academic research,
  industry convention, or our own choice — with a source on each. The honest
  position is "a known effect, conventional parameters, to be tuned on real
  data", and pretending otherwise with a fitted curve would misrepresent it.
- **The live log is a stronger artifact.** Every cycle writes its inputs, the
  model's reasoning, each risk-check verdict and any fill — append-only,
  timestamped, in Supabase. That is reproducible and auditable in a way a
  backtest we ran ourselves is not.

## What does exist

- **Historical calibration of one gate.** The VIX size taper's shape is set from
  VIX close base rates over 1990–2026: the 1-year percentile sits below 25 on
  about a third of days, below 3 on about 8%, and those deep-tail spells are
  usually short. That informs where the taper starts and where the hard block
  sits — it is calibration of a single rule, not a P&L backtest.
- **A one-day parameter replay.** The entry-slippage settings were tuned by
  replaying one day of real captured candidates to see how many would have been
  tradable versus no-trade. One session, one purpose — not a multi-period
  performance test.

## Reading the track record

The live record is the paper-account equity curve (on the homepage and the
dashboard, pulled straight from Alpaca) and the decision history behind it. Read
it knowing the evaluation window is measured in market days: over a span that
short, P&L is dominated by luck, not skill. What the log demonstrates is
process — that the rules ran, that the rejections happened, and that the losses
were the size they were declared to be in advance.
$md$
  )
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
