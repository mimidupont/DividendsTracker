# Divvy — Wealth & Dividend Tracker

Personal multi-asset portfolio tracker built with Next.js 14, Supabase, and TypeScript.
Tracks stocks & ETFs, cash, crypto and real estate, and reports everything in **CZK**.

---

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Styling**: Inline styles with CSS variables · Instrument Serif + DM Mono + Syne
- **Database**: Supabase (PostgreSQL)
- **Charts**: Recharts
- **Prices & dividends**: StockAnalysis (primary) with Yahoo Finance fallback
- **Crypto prices**: CoinGecko
- **FX rates**: Frankfurter.app (free, no key needed)

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | Net worth dashboard — asset mix, income streams, daily P&L chart |
| `/performance` | Per-position P&L, total return incl. dividends, monthly income |
| `/allocation` | Currency, sector and concentration (HHI) breakdown |
| `/holdings` | Full holdings table with live prices, edit, add lot, DRIP |
| `/received` | Dividend payments log with DRIP tracking |
| `/projected` | Multi-year income projections by holding |
| `/calendar` | Ex-dividend calendar for the next 90 days |
| `/currency` | Currency exposure breakdown with visual bars |
| `/cash` | Bank accounts and interest income |
| `/crypto` | Crypto holdings, staking yield |
| `/realestate` | Properties, mortgages, equity and rental yield |
| `/fees` | Expense ratios, brokerage costs and long-run fee drag |
| `/transactions` | Cash-flow ledger: realized P&L, contributions vs growth |
| `/benchmark` | Your cash flows replayed into an index (shadow portfolio) |
| `/rebalance` | Drift against targets + no-sell contribution allocator |
| `/risk` | Concentration, sector/region/currency exposure, liquidity ladder |
| `/fx-attribution` | Splits returns into asset effect vs currency effect |
| `/fire` | FI number, years to FI, coast FIRE, milestones, runway |
| `/scenarios` | Stress tests (2008 replay, crypto winter, job loss…) |
| `/projection` | Monte Carlo fan chart with seeded, reproducible runs |

---

## How the numbers are computed

Anyone relying on these figures should know what's measured and what's assumed.

**Everything is converted to CZK** through `src/lib/fx.ts`. Rates come from
Frankfurter (CZK per 1 unit of foreign currency), refreshed hourly. If the live
fetch fails, the app falls back to the fixed rates in `DEFAULT_FX` **and says so**
— pages show a "fallback rates" marker rather than presenting stale numbers as
current. Currencies quoted in minor units (`GBp` pence, `ZAc`, `ILA`) are folded
into their major unit before conversion. A currency with no known rate is left
unconverted and flagged, never converted at some other currency's rate.

**Position maths lives in one place** — `src/lib/portfolio.ts`. Market value uses
the live price converted with *the currency the quote came back in* (which is not
always the currency the position was booked in); cost basis uses the currency you
recorded. If a symbol has no live quote, it is valued at average cost and marked
"at cost".

**Income** is the declared forward annual dividend rate × shares. When no live
rate is available it falls back to your saved projection for the nearest
upcoming year. Yield is then income ÷ market value, so the yield and the income
figure can never disagree.

**Total return** = unrealised P&L + dividends received **net of withholding tax**.
Reinvested (DRIP) dividends raise the cost basis by the reinvested amount, so
they are not double-counted.

**Net worth** = stocks + cash + crypto + real-estate *equity*. Real estate applies
your `ownership_pct` to the property value, purchase price, mortgage and rent
alike. The "% on invested" figure excludes cash, which has no cost basis.

**Investable net worth** (what `/fire` measures progress against) counts a
property and its mortgage together. Excluding the flat you live in while still
subtracting its mortgage would report a negative figure for anyone with a
mortgage, so both sides of the same asset are dropped or kept as a pair.

**Realized gains** convert the cost at the exchange rate on the buy date and the
proceeds at the rate on the sell date — the Czech return asks for that, and
converting both legs at today's rate would erase the currency part of the gain
entirely. `/transactions` reports that currency component in its own column.

**Snapshots** are written once per day, only after prices, crypto and live FX
have all loaded — a snapshot taken mid-load would record assets still valued at
cost. The P&L windows compare today's value against the newest snapshot on or
before the window start; with no history yet they report "no data" rather than 0%.

Assumptions you may want to change:
- `WHT_RATE` in `src/components/DripCheckModal.tsx` — 15% withholding on dividends
- `ASSUMED_WHT` in `src/app/projected/page.tsx` — 15% for the projected net figure
- `ASSUMED_TURNOVER` and `IBKR_COMMISSION` in `src/app/fees/page.tsx`
- `EXPENSE_RATIOS` in `src/app/fees/page.tsx` — tickers not listed count as 0% TER
  and are flagged in the UI
- `SECTORS` in `src/app/allocation/page.tsx` — unlisted tickers fall into "Other"
- `CZK_SAVINGS_APY` in `src/app/api/benchmark/sync/route.ts` — 4% p.a. for the
  "CZK savings" benchmark, which is generated rather than fetched (there is no
  market series for money in the bank). The rate is in the option's label so the
  synthetic series is never mistaken for an observed one.

---

## Key features

### ✎ Edit positions
Click the pencil icon on any row in Holdings to edit shares, price, currency, exchange.

### + Add lot
Click the + icon to add a new purchase lot to an existing holding.
- Recalculates the weighted average price automatically
- Saves lot history to `holding_lots`

### ⟳ Check dividends (DRIP)
Looks back 90 days for confirmed payments not yet logged.
- "Apply DRIP" logs the dividend and adds the fractional shares to your position
- Reinvestment is computed in CZK from the net-of-WHT amount, matching IBKR
- Cost basis is raised by the reinvested amount, in the holding's own currency
- Payments already in the log are skipped, so nothing is counted twice

### Ex-dividend calendar
Ex-dates and pay dates for the next 90 days. Pay dates that the provider does not
supply are estimated as ex-date + 21 days and labelled `~est.`

### Market data
StockAnalysis is tried first (structured dividend data, no session needed) with
Yahoo Finance as fallback. Add new tickers to `SA_SYMBOL_MAP` in
`src/lib/stockanalysis.ts`; anything not listed goes to Yahoo, with
`YAHOO_SYMBOL_MAP` in `src/lib/yahoo.ts` for exchange suffixes (`SPYW` → `SPYW.DE`).

Both providers are scraped rather than accessed through a supported API, so
expect occasional gaps. Every page shows the fetch state, and positions without a
live quote fall back to cost rather than to zero.

---

## Deploy

### 1. Supabase setup

1. Create a new project at supabase.com
2. SQL Editor → New query → paste `supabase-schema.sql` → Run
3. Settings → API → copy the Project URL and anon key

`supabase-schema.sql` is the complete, current schema. An existing install can
instead run just the new files in `supabase/migrations/` — every one is
idempotent (`create table if not exists`, `add column if not exists`) and none
drops or rewrites an existing column.

The schema creates one seed profile. Every table is scoped by `profile_id`, and
the app needs at least one row in `profiles` — with none, all pages come up empty.

> **Security**: the app uses the anon key with no login, and RLS is not enabled.
> Anyone with that key (it ships in the browser bundle) can read and write your
> data. That's fine for a private deployment; add Supabase Auth and RLS policies
> before exposing it publicly. See the notes at the bottom of the schema file.

### 2. Environment variables

```bash
cp .env.local.example .env.local
# Fill in:
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

If these are missing the app loads but every page shows a configuration error
banner instead of failing with an opaque network error.

### 3. Vercel deploy

1. Push to GitHub
2. Import at vercel.com
3. Add the two env vars above
4. Deploy — Next.js is auto-detected

### 4. Daily snapshots without logging in

The P&L chart, benchmark comparison and FX attribution are all built from daily
snapshots. Originally these were written only by the browser when you opened the
dashboard, so days you didn't visit left holes in the history.

`/api/cron/snapshot` now does the same work server-side. `vercel.json` schedules
it twice daily; any external scheduler hitting that URL works too. Set
`CRON_SECRET` in your environment and Vercel will send it as a bearer token —
without it the endpoint is open, which is acceptable only for a private deployment.

The route skips writing entirely if live FX is unavailable, rather than
recording a value struck at stale rates that would show up in the history as a
step change that never happened.

### 5. Local development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## Database tables

| Table | Purpose |
|-------|---------|
| `profiles` | Portfolio owners; everything else is scoped by `profile_id` |
| `holdings` | Current positions with weighted avg price |
| `holding_lots` | Individual purchase lots (for history) |
| `dividends_received` | Logged dividend payments with DRIP tracking |
| `dividend_projections` | Editable annual forecasts per ticker per year |
| `bank_accounts` | Cash and savings accounts |
| `bank_interest_received` | Logged interest payments |
| `crypto_holdings` | Crypto positions keyed by CoinGecko id |
| `real_estate` | Properties with mortgage and rental data |
| `portfolio_snapshots` | Daily net worth history + per-currency exposure |
| `transactions` | Every money movement; FX frozen per row |
| `asset_metadata` | Sector, region and liquidity tier per symbol |
| `allocation_targets` | Target weights per scope for rebalancing |
| `benchmark_prices` | Shared index price history (not profile-scoped) |
| `financial_plan` / `expense_log` | FIRE assumptions and observed spending |
| `scenarios` | Saved stress-test shock sets |
| `market_assumptions` | Per-class return and volatility for Monte Carlo |

Rates and percentages are stored as **decimal fractions** (`interest_rate`,
`staking_apy`, `mortgage_rate`, `projected_yield`, `growth_rate`): 4.5% is `0.045`.
The one exception is `ownership_pct`, stored as 0–100.
