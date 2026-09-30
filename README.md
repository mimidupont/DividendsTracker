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
| `/` | Net worth dashboard — attention list, flow-aware change, class cards |
| `/transactions` | **Activity** — every buy, sell, dividend, coupon, split; realised P&L (FIFO or average), Czech tax view, historical-FX backfill |
| `/holdings` | Stocks & ETFs with live prices, edit, add lot, DRIP check |
| `/bonds` | Bonds: accrued interest, YTM, duration, maturity ladder |
| `/cash` | Current, savings and term accounts; interest; runway |
| `/crypto` | Crypto holdings, staking yield |
| `/realestate` | Properties, mortgages, equity, net rental yield, valuation date |
| `/received` | All income received — dividends, coupons, interest, rent |
| `/projected` | Next 12 months of income, gross and net of tax |
| `/calendar` | Ex-dividend dates, coupons, maturities and deposits coming due |
| `/allocation` | Cross-asset, currency, sector and region breakdown (`/currency` redirects here) |
| `/performance` | Per-position P&L incl. realised gains, net dividends and FX effect |
| `/fees` | Expense ratios, brokerage costs and long-run fee drag |
| `/benchmark` | Time-weighted return vs an index; your cash flows replayed into it |
| `/rebalance` | Drift against targets + no-sell contribution allocator |
| `/risk` | Concentration, exposure, liquidity ladder; edit each holding's classification |
| `/fx-attribution` | Splits returns into asset effect vs currency effect |
| `/fire` | FI number, years to FI, coast FIRE, milestones, runway |
| `/scenarios` | Stress tests (2008 replay, crypto winter, job loss…) |
| `/projection` | Monte Carlo fan chart with seeded, reproducible runs |

---

## How the numbers are computed

Anyone relying on these figures should know what's measured and what's assumed.

**Everything is converted to CZK** through `src/lib/fx.ts`. Rates come from
Frankfurter (CZK per 1 unit of foreign currency; these are **ECB** reference rates,
not ČNB — close, but not the rates the Czech tax return formally uses), refreshed
hourly. If the live
fetch fails, the app falls back to the fixed rates in `DEFAULT_FX` **and says so**
— pages show a "fallback rates" marker rather than presenting stale numbers as
current. Currencies quoted in minor units (`GBp` pence, `ZAc`, `ILA`) are folded
into their major unit before conversion. A currency with no known rate is left
unconverted and flagged, never converted at some other currency's rate.

**Position maths lives in one place** — `src/lib/portfolio.ts`. Market value uses
the live price converted with *the currency the quote came back in* (which is not
always the currency the position was booked in); cost basis uses the currency you
recorded. If a symbol has no live quote, it is valued at average cost and marked
"at cost" — unless you entered a **manual price** (✎ on Positions, migration 015),
which is then used and marked "manual" (flagged after 30 days). A position valued
at cost holds back that day's history point; a manual one does not.

**Which listing is priced** is decided by the position's exchange: a bare ticker
gets the exchange's Yahoo suffix (`SBF` → `.PA`, `AEB` → `.AS`, `IBIS2` → `.DE`,
`LSEETF` → `.L`, `PRA` → `.PR`; US venues none — `EXCHANGE_SUFFIX` in
`src/lib/yahoo.ts`). `YAHOO_SYMBOL_MAP` overrides broker codes that differ from
the exchange's ticker (IBKR's `CSG1` is Euronext's `CSG`).

**Income** is the declared forward annual dividend rate × shares. When no live
rate is available it falls back to your saved projection for the nearest
upcoming year. Yield is then income ÷ market value, so the yield and the income
figure can never disagree.

**Total return** = unrealised P&L + dividends received **net of withholding tax**.
Reinvested (DRIP) dividends raise the cost basis by the reinvested amount, so
they are not double-counted.

**Net worth** = stocks + bonds + cash + crypto + real-estate *equity*. Rental
income is counted net of the property's `annual_costs`. Real estate applies
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

**Frozen FX.** Every lot, dividend and interest payment stores the CZK rate on its
own date (`fx_rate_czk`), and holdings keep a blended `avg_fx_czk`. Cost is
converted at that frozen rate, so the P&L splits into price and currency parts.
Rows recorded before migration 010 have no rate — the UI says "purchase FX
unknown" for them until you click **Fill from ECB rates** on Positions
(`src/lib/purchasefx.ts`): it writes each lot's rate and the position's
cost-weighted `avg_fx_czk`. Purchase dates of 1 January are treated as
placeholders and skipped — set the real date first. Zero-cost positions (RSUs,
gifts) have no currency effect and are not flagged.

**Allocation targets** only count once they add up to 100 % (± 0.5 pp). All-zero
rows are treated as "no targets" rather than as a 0 % plan that every holding
breaches.

**Bonds** (`src/lib/bonds.ts`) are valued at clean price + accrued interest
(ACT/ACT ICMA, ACT/365 or 30E/360). Without a quote they fall back to cost and are
labelled. YTM, Macaulay/modified duration and convexity are computed from the
coupon schedule; Czech savings bonds that can be redeemed early carry duration 0.

**Changes in net worth are flow-aware.** Deposits and withdrawals recorded in
Activity are taken out of the change, so saving money does not look like profit;
the benchmark page compares a time-weighted return, not raw growth.

**Czech tax view** (Activity page) applies the 3-year time test (the holding period
must *exceed* three years), the 100 000 CZK annual proceeds exemption and the
40 M CZK cap. It is an aid, not advice — confirm with a tax adviser.

Assumptions you may want to change:
- `DIVIDEND_WHT_BY_COUNTRY` / `DEFAULT_DIVIDEND_WHT` in `src/lib/tax.ts` — dividend
  withholding by country of the issuer (overridable per holding on `/risk`)
- `CZ_INTEREST_TAX`, `CZ_COUPON_TAX` in `src/lib/tax.ts` — 15%
- `ASSUMED_TURNOVER` and `DEFAULT_COMMISSION_RATE` in `src/app/fees/page.tsx`
- `EXPENSE_RATIOS` in `src/app/fees/page.tsx` — tickers not listed are flagged in
  the UI and left out of the TER total
- `SEED_SECTORS` in `src/lib/risk.ts` — defaults only; set sector, region, type
  and country per holding on `/risk`
- `EMERGENCY_HAIRCUTS` in `src/lib/runway.ts`, `DEFAULT_BOND_DURATION` in
  `src/lib/scenarios.ts`, return/volatility assumptions in `src/lib/montecarlo.ts`
- `CZK_SAVINGS_APY` in `src/app/api/benchmark/sync/route.ts` — 4% p.a. for the
  "CZK savings" benchmark, which is generated rather than fetched (there is no
  market series for money in the bank). The rate is in the option's label so the
  synthetic series is never mistaken for an observed one.

---

## Key features

### + Record
One button (top of the sidebar) records any money movement: buy, sell, dividend
(optionally reinvested), bond coupon, interest, deposit, withdrawal, fee or stock
split. It saves through the `record_event()` database function, so the ledger row
and its effect on the position, dividend log or bank balance land together or not
at all. The FX rate defaults to the rate on the transaction date.

### ✎ Edit positions
Click the pencil icon on any row in Stocks & ETFs to edit shares, price, currency,
exchange. Deletes can be undone for a few seconds from the toast.

### ⟳ Check dividends (DRIP)
Looks back 90 days for confirmed payments not yet logged.
- Shares are counted as of the ex-date, the FX rate is the pay-date rate
- Withholding defaults by country (`src/lib/tax.ts`) and can be edited per payment
- "Apply DRIP" logs the dividend and adds the fractional shares to your position
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

**Upgrading to this version:** run `supabase/migrations/010_frozen_fx.sql`,
`011_bonds.sql`, `012_record_event.sql`, `013_property_details.sql`,
`014_bank_interest_profile.sql` and
`015_manual_price.sql` **in that order** (SQL Editor), then open Activity → *Backfill from holdings* once to create
ledger rows and historical FX rates for positions entered before the ledger existed.
Until 012 is run, the Record button reports that `record_event()` is missing.

The schema creates one seed profile. Every table is scoped by `profile_id`, and
the app needs at least one row in `profiles` — with none, all pages come up empty.

> **Security — an explicit decision, not an oversight.** As of 2026-08, this
> deployment is single-user and private, and runs with the Supabase anon key and
> RLS disabled. Anyone holding that key (it ships in the browser bundle) can read
> and write the data, and `/api/snapshots` accepts any valid-looking `profileId`
> from any caller.
>
> That is acceptable *only* while the URL is not shared. Before exposing this
> app to anyone else, in this order:
> 1. Add Supabase Auth and enable RLS with the policies sketched at the bottom
>    of `supabase-schema.sql`.
> 2. Move the server routes onto a service-role key held in a non-`NEXT_PUBLIC_`
>    variable.
> 3. Rate-limit `POST /api/snapshots`.
>
> `CRON_SECRET` is already required rather than optional — see §4 below.

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
it once daily (the Hobby plan allows one cron invocation per day); any external
scheduler hitting that URL works too.

**`CRON_SECRET` is required.** The route writes to the database for every
profile, so it fails closed with a 503 when the variable is unset rather than
running open to anyone who knows the deployment URL. Vercel sends it as a bearer
token automatically; an external scheduler needs
`Authorization: Bearer $CRON_SECRET`.

The snapshot date is computed in `SNAPSHOT_TIMEZONE` (default `Europe/Prague`),
not UTC — the browser stamps snapshots with *your* calendar date, and the two
writers must agree about which day it is.

The route skips writing entirely if live FX is unavailable, rather than
recording a value struck at stale rates that would show up in the history as a
step change that never happened.

### 5. Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Vitest — the maths in src/lib is covered
npm run lint     # rules-of-hooks is an error, not a warning
```

Requires Node 22 or newer (`@supabase/supabase-js` declares it). The pure
functions in `src/lib` carry the test suite; anything that changes a reported
number should arrive with a test that pins it.

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
