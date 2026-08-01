# Divvy v2 — Build Spec

Implementation brief for Claude Code. Nine features, built in dependency order.
Everything below assumes the existing Divvy codebase (Next.js 14 App Router, TypeScript, Supabase, Recharts).

---

## 0. Ground rules

Read these before writing any code. They are non-negotiable and apply to every feature.

### Existing conventions to follow

| Thing | Convention |
|---|---|
| Base currency | **CZK**. All aggregate/display values convert via `toCZK(amount, ccy, fx)` from `src/lib/fx.ts`. Never mix currencies in a sum. |
| Formatting | `fmtCZK`, `fmtNum`, `fmtDate`, `fmtDateShort` from `src/lib/fx.ts`. Do not write new formatters. |
| Data access | `useAppData()` (`src/hooks/useAppData.ts`) — cached, profile-scoped, 5-min TTL, invalidated by the `divvy:profile-change` event. Extend this hook rather than adding ad-hoc Supabase calls in pages. |
| Profile scoping | **Every** table has `profile_id uuid`. Every query filters `.eq('profile_id', profileId)`. Every insert sets it. No exceptions. |
| FX | `useFx()` hook, live rates via `/api/fx` (Frankfurter), falls back to `DEFAULT_FX`. |
| Market data | `useMarketData()` (stocks, via `src/lib/stockanalysis.ts`), `useCryptoPrices()` (crypto). |
| Styling | Inline styles + CSS variables (`var(--bg2)`, `var(--border)`, `var(--green)`, `var(--text3)`, …). No Tailwind, no CSS modules. Reuse `tdR`, `tdRMono`, `btnStyle`, `actionBtn` from `src/lib/ui.ts` and the `Badge` component. |
| Typography | Headings `'Instrument Serif', serif` 26px/400. Numbers `'DM Mono', monospace`. Labels uppercase 9–11px, letter-spacing 0.1em, `var(--text3)`. |
| Charts | Recharts, `ResponsiveContainer`, `stroke="var(--border)"` grids, 9px axis ticks. |
| Page shell | `<div style={{display:'flex'}}><Sidebar /><main style={{marginLeft:'var(--sidebar-w)', flex:1, padding:'28px 36px', maxWidth:1200}}>…` |
| Asset class colours | Stocks `--green`, Cash `--blue`, Crypto `--purple`, Real estate `--teal`, income/warnings `--amber`, negative `--red`. |

### Architectural requirement — build `src/lib/portfolio.ts` first

Six of the nine features need "every asset I own, normalised". Today that logic is duplicated
across `page.tsx`, `allocation`, `performance`, and `fees`. Before feature work, extract it:

```ts
export type AssetClass = 'stock' | 'etf' | 'cash' | 'crypto' | 'realestate'
export type LiquidityTier = 'instant' | 'week' | 'month' | 'year' | 'illiquid'

export interface Position {
  id:            string
  assetClass:    AssetClass
  label:         string          // "AAPL" / "Fio spořicí" / "BTC" / "Byt Brno"
  name:          string
  currency:      string          // native currency
  quantity:      number
  valueLocal:    number          // market value in native currency
  valueCZK:      number
  costLocal:     number
  costCZK:       number
  sector:        string | null   // stocks only
  region:        string | null   // 'US' | 'EU' | 'CZ' | 'Global' | 'EM'
  liquidityTier: LiquidityTier
  annualIncomeCZK: number        // dividend / interest / rent / staking
  isLiability:   boolean         // mortgage rows are negative positions
}

export function buildPositions(data: AppData, fx: FxRates, market: MarketData, crypto: CryptoPrices): Position[]
export function totalsByClass(positions: Position[]): Record<AssetClass, number>
export function netWorthCZK(positions: Position[]): number
```

Rules:
- Real estate produces **two** rows per property: the asset at `current_value * ownership_pct`, and the mortgage as a negative-value position with `isLiability: true`.
- Sector/region/liquidity come from a metadata table (see F4) with sane fallbacks — never hardcode a second copy of the `SECTORS` map.
- All new pages consume `buildPositions()`. Refactor `allocation` and `page.tsx` to use it too, but **in a separate commit** so a regression is easy to bisect.

### Migrations

One SQL file per feature in `supabase/migrations/`, named `NNN_feature.sql`, idempotent
(`create table if not exists`, `alter table … add column if not exists`). Append the same
statements to `supabase-schema.sql` so a fresh setup still works from one file. Never
drop or rewrite an existing column.

### Definition of done (every feature)

- [ ] Migration written, idempotent, `profile_id` present, indexed on `(profile_id, date)`
- [ ] TypeScript interface added to `src/lib/supabase.ts`
- [ ] Pure calculation logic in `src/lib/*.ts` — no maths inside components
- [ ] Page renders correctly with **zero rows** in the new table (empty state, not a crash)
- [ ] Nav entry added to `src/components/Sidebar.tsx`
- [ ] Works when market data fails to load (falls back to `avg_price`)
- [ ] `npm run build` passes with no new TS errors

### Build order

```
F0  lib/portfolio.ts refactor      ← blocks everything
F1  Transactions ledger            ← blocks F2, F5, F6, F9
F4  Risk & concentration metadata  ← blocks F7, F8
F3  Rebalancing
F2  Benchmark comparison
F5  FX attribution
F6  FIRE dashboard                 ← blocks F7, F9
F7  Emergency fund runway
F8  Scenario stress tests
F9  Monte Carlo projection
```

---

## F1 — Transactions ledger

**Problem it solves.** Net worth history comes from daily snapshots, so a rise of 200k CZK
could be market performance or a deposit — indistinguishable. Without a cash-flow record
there is no honest return figure, no realized P&L, and no tax-lot history.

### Schema

```sql
create table if not exists transactions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  txn_date      date not null,
  type          text not null check (type in (
                  'buy','sell','deposit','withdrawal',
                  'dividend','interest','rent','fee','tax','transfer','adjustment')),
  asset_class   text not null check (asset_class in ('stock','cash','crypto','realestate','none')),

  -- what was traded
  symbol        text,           -- ticker or coin_id
  asset_id      uuid,           -- FK-ish: holdings.id / bank_accounts.id / crypto_holdings.id / real_estate.id
  quantity      numeric,        -- shares / coins; null for pure cash movements
  price         numeric,        -- per unit, native currency
  amount        numeric not null,  -- signed gross, native currency (+ in, − out)
  fee           numeric default 0,
  tax           numeric default 0,
  currency      text not null default 'CZK',

  -- CZK conversion frozen at transaction time
  fx_rate_czk   numeric not null,
  amount_czk    numeric generated always as (amount * fx_rate_czk) stored,

  -- return maths
  is_external   boolean not null default false,
  counterparty_account_id uuid,   -- for transfers between own accounts

  notes         text,
  created_at    timestamptz default now()
);

create index if not exists idx_txn_profile_date on transactions(profile_id, txn_date);
create index if not exists idx_txn_symbol on transactions(profile_id, symbol);
```

### `is_external` — get this right, everything downstream depends on it

External = money crossing the boundary of your wealth. Internal = money moving inside it.

| Event | `is_external` | Why |
|---|---|---|
| Salary → brokerage | `true` | new money |
| Withdrawal to spend | `true` | money leaves |
| Buy AAPL with existing cash | `false` | cash → shares, same wealth |
| Dividend received | `false` | already counted as portfolio return |
| Dividend spent (withdrawn) | `true` (a second withdrawal row) | |
| Mortgage principal payment | `false` | cash → equity |
| Mortgage interest | `true` (outflow) | genuine cost |
| Transfer between own accounts | `false` | pair of rows, nets to zero |
| Fees | `false` | drag on return, not a contribution |

### Library — `src/lib/transactions.ts`

```ts
export function realizedPL(txns: Transaction[], method: 'fifo' | 'avg'): RealizedLot[]
export function costBasis(symbol: string, txns: Transaction[]): { shares: number; avgPrice: number; lots: Lot[] }
export function externalFlows(txns: Transaction[]): { date: string; amountCZK: number }[]
export function contributionsVsGrowth(
  txns: Transaction[], snapshots: PortfolioSnapshot[]
): { date: string; contributed: number; growth: number }[]
```

`src/lib/returns.ts`:

```ts
export function xirr(flows: { date: Date; amount: number }[], guess?: number): number | null
export function twr(snapshots: PortfolioSnapshot[], flows: Flow[]): number   // Modified Dietz per sub-period
export function cagr(start: number, end: number, years: number): number
```

XIRR: Newton–Raphson, bisection fallback, max 100 iterations, return `null` on
non-convergence rather than NaN. Final portfolio value is a terminal negative flow.
Needs ≥ 1 positive and ≥ 1 negative flow — otherwise return `null` and the UI shows `—`.

### Page `/transactions`

- Table: date · type badge · asset · quantity · price · amount (native) · CZK · fee · running balance
- Filters: date range, type (multi), asset class, symbol, `is_external` only
- Summary cards: total contributed (external in), total withdrawn, net contributed, realized P&L YTD, fees paid YTD
- Add/edit modal following `AddPositionModal` structure. Type selector drives which fields are shown.
- Delete with `confirm()`, matching the existing holdings-delete pattern.

### Backfill

Existing users have holdings but no transaction history. Add a one-off "Seed from holdings"
button that creates a `buy` row per `holding_lots` entry (or per holding using `purchase_date` +
`avg_price` where lots are missing), flagged `notes = 'backfilled'`. Same for
`dividends_received` → `dividend` rows. Idempotent: skip if a backfilled row already exists.

### CSV import (do this second, after manual entry works)

`/transactions/import`: paste or upload CSV → column mapper UI → preview table with per-row
validation → commit. Support an IBKR Flex-style layout and a generic
`date,type,symbol,quantity,price,currency,fee` shape. Dedupe on
`(txn_date, symbol, quantity, amount)`.

### Acceptance

- Buy → sell → the realized gain matches a hand calculation under FIFO
- XIRR on a known series (e.g. −1000 on day 0, +1100 after 365 days) returns ≈ 10%
- Dashboard can show "of the +240k this year, 180k was contributions and 60k was growth"

---

## F4 — Risk & concentration

Built early because F7 and F8 need the metadata it introduces.

### Schema

```sql
create table if not exists asset_metadata (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  symbol         text not null,
  sector         text,
  industry       text,
  region         text,            -- 'US','EU','CZ','UK','Global','EM','Other'
  country        text,
  liquidity_tier text default 'week',
  is_hedged      boolean default false,
  notes          text,
  unique(profile_id, symbol)
);

alter table bank_accounts add column if not exists liquidity_tier text default 'instant';
alter table crypto_holdings add column if not exists liquidity_tier text default 'week';
alter table real_estate    add column if not exists liquidity_tier text default 'year';
```

Seed `asset_metadata` from the existing `SECTORS` map in `allocation/page.tsx`, then delete
that map. Default liquidity tiers: ETFs/large caps `week`, small caps `week`, term deposits
`month` (or `year` if `maturity_date` is far out), property `year`, primary residence `illiquid`.

### Library — `src/lib/risk.ts`

```ts
export function topNConcentration(positions: Position[], n = 5): { pct: number; rows: Position[] }
export function herfindahl(positions: Position[]): number          // Σ wᵢ² ; ×10000 for HHI points
export function effectiveN(positions: Position[]): number          // 1 / Σ wᵢ² — "how many bets do I really have"
export function exposureBy(positions: Position[], key: 'sector'|'region'|'currency'|'assetClass'): Bucket[]
export function unhedgedFxShare(positions: Position[], base = 'CZK'): number
export function liquidityLadder(positions: Position[]): Record<LiquidityTier, number>
```

Interpretation bands for the UI (as `Badge` variants):

| Metric | Green | Amber | Red |
|---|---|---|---|
| Top-5 weight | < 35% | 35–55% | > 55% |
| Single position | < 10% | 10–20% | > 20% |
| Effective N | > 15 | 8–15 | < 8 |
| Unhedged FX | < 40% | 40–70% | > 70% |
| Instant liquidity | > 6 mo expenses | 3–6 mo | < 3 mo |

Note in the UI copy that for a CZK-based investor, high unhedged FX is a *deliberate*
diversification choice, not automatically a defect — flag it, don't scold.

### Page `/risk`

1. Four summary cards: top-5 weight · effective N · unhedged FX % · instant-liquidity months
2. Concentration table — every position by weight, cumulative % column, bar fill, red rows above 10%
3. Two pies side by side: sector and region (reuse the `allocation` page pie styling)
4. Currency exposure with a hedged/unhedged split bar
5. Liquidity ladder — horizontal stacked bar `instant | week | month | year | illiquid`, with CZK and % labels, plus "you could raise X within a week"

---

## F3 — Rebalancing

### Schema

```sql
create table if not exists allocation_targets (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  scope        text not null check (scope in ('asset_class','sector','region','symbol')),
  bucket       text not null,     -- 'stock' | 'Technology' | 'US' | 'SPY5'
  target_pct   numeric not null,  -- 0–1
  band_pct     numeric default 0.05,
  min_pct      numeric,
  max_pct      numeric,
  notes        text,
  updated_at   timestamptz default now(),
  unique(profile_id, scope, bucket)
);
```

Targets within a scope should sum to 1. Warn in the UI if they don't; don't block saving.

### Library — `src/lib/rebalance.ts`

```ts
export interface DriftRow {
  bucket: string
  currentCZK: number
  currentPct: number
  targetPct: number
  driftPct: number          // current − target, in percentage points
  status: 'ok' | 'watch' | 'breach'
  deltaCZK: number          // + = buy this much, − = sell this much
}

export function computeDrift(positions: Position[], targets: AllocationTarget[], scope: Scope): DriftRow[]

/** No-sell rebalancing: distribute a new contribution to the most underweight buckets. */
export function allocateContribution(
  rows: DriftRow[], amountCZK: number, opts?: { minTicketCZK?: number }
): { bucket: string; amountCZK: number; newPct: number }[]

/** Full rebalance including sells — shown separately, with a tax warning. */
export function fullRebalanceTrades(rows: DriftRow[]): Trade[]
```

`allocateContribution` algorithm: compute post-contribution total `T' = T + A`, ideal value per
bucket `target_pct × T'`, shortfall `max(0, ideal − current)`, then allocate `A` pro-rata to
shortfalls. Drop allocations below `minTicketCZK` (default 2000 CZK — not worth a trade fee)
and redistribute. Never suggest a sell in this mode.

### Page `/rebalance`

- Scope tabs: Asset class · Sector · Region · Symbol
- Drift table: bucket · current CZK · current % · target % · drift bar (diverging from centre, green under / red over) · action
- **Contribution allocator**: number input ("I have 20 000 CZK to invest") → suggested split table, updating live. This is the centrepiece — make it prominent.
- Editable targets panel with a "sums to X%" indicator
- Full-rebalance mode behind a toggle, with a note that sells may realize taxable gains and can break the Czech 3-year time test

### Acceptance

Empty targets → page invites you to set them, no crash. Setting stocks 60 / cash 20 / crypto 5 /
property 15 and entering 20 000 CZK produces a split that pushes each bucket toward target and
sums exactly to the input amount.

---

## F2 — Benchmark comparison

**Problem.** "+12%" is meaningless in isolation. The right comparison applies *your* cash-flow
timing to the benchmark, not a naive buy-and-hold from day one.

### Schema

```sql
create table if not exists benchmark_prices (
  id        uuid primary key default gen_random_uuid(),
  symbol    text not null,        -- 'SPY','IWDA','URTH','CZK_SAVINGS'
  price_date date not null,
  close     numeric not null,
  currency  text not null default 'USD',
  unique(symbol, price_date)
);

create table if not exists benchmark_config (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  primary_benchmark   text default 'SPY',
  secondary_benchmark text default 'IWDA',
  updated_at  timestamptz default now()
);
```

Benchmark prices are **not** profile-scoped — they are shared market data.

### Data source

Extend `src/lib/stockanalysis.ts` with a history scraper, or add `/api/benchmark/sync` that
pulls daily closes and upserts them. Sync on demand via a button plus a nightly cron. If
history is unavailable, degrade gracefully: compare only over the period where both series
have data, and say so in the subtitle.

Benchmarks must be converted to CZK using the FX rate **of that date** (`portfolio_snapshots`
already stores `fx_usd` / `fx_eur` — use those; interpolate for gaps). A CZK investor's SPY
return includes the FX move, and hiding that would make the comparison dishonest.

### Library — `src/lib/benchmark.ts`

```ts
/** Replay your external cash flows into the benchmark. The core comparison. */
export function shadowPortfolio(
  flows: Flow[], prices: BenchmarkPrice[], fxByDate: Record<string, FxRates>
): { date: string; valueCZK: number; units: number }[]

export function indexTo100(series: { date: string; value: number }[]): { date: string; value: number }[]
export function trackingDifference(mine: Series, bench: Series): number
export function rollingReturns(series: Series, windowDays: number): Series
export function maxDrawdown(series: Series): { pct: number; peakDate: string; troughDate: string }
```

### Page `/benchmark`

1. Cards: your TWR · benchmark TWR · difference (green/red) · your XIRR · max drawdown yours vs benchmark
2. Main chart: two lines indexed to 100 from the start of the selected window, plus a shaded
   band for the difference. Windows: 1M / 3M / 6M / YTD / 1Y / All.
3. "What if you'd just bought the index" card: shadow-portfolio value today vs your actual, in CZK
4. Per-holding vs benchmark table — which positions actually earned their place next to an index fund
5. Honest caveat line: comparison is only as good as the transaction history behind it

---

## F5 — FX attribution

**Problem.** A CZK investor holding mostly USD assets cannot tell whether a good year was the
market or the koruna. Split it.

### Schema addition

Current snapshots store CZK totals only, which is not enough — you need exposure per currency.

```sql
alter table portfolio_snapshots add column if not exists exposure_usd_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_eur_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_czk_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_other_czk numeric default 0;
alter table portfolio_snapshots add column if not exists fx_gbp numeric;
```

Update `/api/snapshots` POST and `usePortfolioSnapshots.saveSnapshot()` to write these.
Historical rows will have zeros — attribution shows "available from <first date with exposure data>".

### Library — `src/lib/fxattribution.ts`

For each currency c, over a period from 0 to 1, with local value `V` and rate `R`:

```
ΔCZK = V₁R₁ − V₀R₀
     = (V₁ − V₀)·R₀     ← asset effect   (what the asset did, at old FX)
     + V₀·(R₁ − R₀)     ← currency effect (what the koruna did, on old holdings)
     + (V₁ − V₀)(R₁ − R₀) ← interaction   (small; report separately, don't hide it)
```

```ts
export interface FxAttribution {
  currency: string
  assetEffectCZK: number
  currencyEffectCZK: number
  interactionCZK: number
  totalCZK: number
}
export function attributePeriod(from: PortfolioSnapshot, to: PortfolioSnapshot): FxAttribution[]
export function attributeSeries(snapshots: PortfolioSnapshot[]): FxAttribution[]  // chained, avoids flow distortion
```

Chain sub-periods (day over day, summed) rather than computing endpoint-to-endpoint — otherwise
contributions during the period pollute the currency effect.

### Page `/fx-attribution` (or a tab on `/performance`)

- Cards: total return CZK · of which asset · of which FX · FX as % of total
- Stacked bar chart by month: asset effect vs currency effect
- Per-currency table with each effect and current exposure
- Line: portfolio value in CZK vs the same portfolio at constant (frozen start-date) FX. The gap *is* the currency effect, and this chart makes it obvious at a glance.

---

## F6 — FIRE dashboard

### Schema

```sql
create table if not exists financial_plan (
  profile_id            uuid primary key references profiles(id) on delete cascade,
  annual_expenses_czk   numeric not null default 600000,
  annual_income_czk     numeric,
  monthly_contribution_czk numeric default 0,
  swr_pct               numeric default 0.04,
  expected_real_return  numeric default 0.05,
  inflation_pct         numeric default 0.025,
  birth_year            int,
  target_retirement_age int,
  include_property_in_fi boolean default false,
  include_primary_residence boolean default false,
  updated_at            timestamptz default now()
);

create table if not exists expense_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  month       date not null,        -- first day of month
  amount_czk  numeric not null,
  category    text,
  notes       text,
  unique(profile_id, month, category)
);
```

`expense_log` is optional detail; `financial_plan.annual_expenses_czk` is the fallback. If ≥ 3
months of expense data exist, use a trailing 12-month (or annualised) average instead and label it as such.

### Library — `src/lib/fire.ts`

```ts
export function fiNumber(annualExpenses: number, swr: number): number         // expenses / swr
export function fiProgress(investableNetWorth: number, fiNumber: number): number
export function savingsRate(income: number, expenses: number): number
export function currentSwrIncome(investableNetWorth: number, swr: number): number

export function yearsToFI(
  current: number, monthlyContribution: number, realReturn: number, fiNumber: number
): number | null      // null if contribution ≤ 0 and current < target

export function coastFireNumber(
  fiNumber: number, yearsToRetirement: number, realReturn: number
): number             // fiNumber / (1+r)^years — the point where you can stop contributing

export function baristaFireNumber(
  annualExpenses: number, partTimeIncome: number, swr: number
): number
```

**Investable net worth** excludes the primary residence by default (you can't spend the
house you live in), controlled by `include_primary_residence`. Mortgages still subtract.
Make this switch visible on the page — the number moves a lot and the user should see why.

`yearsToFI`: solve `FV = P(1+r)ⁿ + PMT·((1+r)ⁿ−1)/r` for n, monthly compounding, real
(inflation-adjusted) returns so today's expense figure stays valid.

### Page `/fire`

1. Hero: big progress ring or bar, "X% to financial independence", FI number, current investable net worth
2. Cards: FI number · years to FI · projected FI date (and your age then) · savings rate · current 4% income vs expenses (green when income ≥ expenses)
3. Coast FIRE card — "you could stop contributing today and still hit the target at 60" with the coast number and gap
4. Assumptions panel — every input editable inline, everything recalculates live. Show the SWR as a slider (3–5%) because the sensitivity is the lesson.
5. Milestones: 100k / 250k / 500k / 1M CZK, then 1× / 5× / 10× / 25× annual expenses, with dates hit or projected
6. Chart: projected net worth to FI date, with the FI number as a `ReferenceLine`

Include one line of copy noting the 4% rule comes from US historical data over 30-year
retirements; a Czech investor with a longer horizon may prefer 3.25–3.5%. State it neutrally
— this is a planning tool, not advice.

---

## F7 — Emergency fund runway

Small feature, high value. Depends on F4 liquidity tiers and F6 expenses.

### Library — `src/lib/runway.ts`

```ts
export interface Runway {
  tier: LiquidityTier
  availableCZK: number
  cumulativeCZK: number
  months: number
  cumulativeMonths: number
}
export function computeRunway(positions: Position[], monthlyExpenses: number): Runway[]
export function runwayStatus(months: number): 'critical' | 'thin' | 'ok' | 'strong'  // <1 / <3 / <6 / ≥6
```

Apply a haircut to non-cash tiers when computing "emergency" availability: stocks at 100% of
market value but flagged as "may be sold at a loss", crypto at 70%, property excluded from
emergency access entirely. Make haircuts constants at the top of the file, not magic numbers.

### UI — card on `/fire` and `/cash`, plus a small dashboard tile

- Big number: "8.3 months" with a status colour
- Segmented horizontal bar: instant / week / month, each labelled in months of expenses
- Target line at 6 months, with the CZK gap if under
- A note when a term deposit's `maturity_date` locks up cash that would otherwise count as instant

---

## F8 — Scenario stress tests

### Schema

```sql
create table if not exists scenarios (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text,
  shocks      jsonb not null,
  is_preset   boolean default false,
  created_at  timestamptz default now()
);
```

`shocks` shape:

```json
{
  "equity_pct": -0.30,
  "crypto_pct": -0.60,
  "property_pct": -0.20,
  "fx": { "USD": -0.15, "EUR": -0.10 },
  "rates_pct": -0.50,
  "rent_vacancy_pct": -0.25,
  "expense_shock_pct": 0.10,
  "income_loss_months": 6
}
```

Presets to ship: **2008 replay** (equity −50, property −20, rates −80%), **COVID crash**
(equity −34 fast recovery), **Dot-com** (tech-heavy equity −45), **CZK strengthens 15%**,
**Crypto winter** (−70), **Job loss** (6 months no income, expenses continue), **Stagflation**
(equity −20, expenses +15, rates +50%).

### Library — `src/lib/scenarios.ts`

```ts
export interface ScenarioResult {
  netWorthBefore: number
  netWorthAfter: number
  deltaCZK: number
  deltaPct: number
  byClass: Record<AssetClass, { before: number; after: number; delta: number }>
  annualIncomeBefore: number
  annualIncomeAfter: number
  runwayMonthsBefore: number
  runwayMonthsAfter: number
  fiProgressBefore: number
  fiProgressAfter: number
  yearsToFIDelta: number | null
}
export function applyScenario(positions: Position[], plan: FinancialPlan, shocks: Shocks): ScenarioResult
```

Apply FX shocks to `valueLocal` before converting, so a currency move correctly hits only
foreign-denominated assets. Mortgages do **not** shrink when property falls — that asymmetry is
the entire point of the property scenario, and the UI should show equity going negative if it does.

### Page `/scenarios`

- Preset buttons across the top, applying instantly
- Sliders for each shock dimension, live recalculation
- Before/after waterfall: starting net worth → each shock's contribution → ending net worth
- Impact table by asset class
- "What survives" panel: runway months after, FI progress after, years-to-FI pushed back by N, whether 4% income still covers expenses
- Save custom scenarios with a name

---

## F9 — Monte Carlo projection

### Schema

```sql
create table if not exists market_assumptions (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  asset_class    text not null,
  expected_real_return numeric not null,
  volatility     numeric not null,
  unique(profile_id, asset_class)
);
```

Defaults (real, i.e. after inflation): stocks 5.5% / 16%, crypto 8% / 70%, cash 0.5% / 1%,
real estate 3% / 10%. Correlation matrix as a constant in the lib — stocks/crypto 0.4,
stocks/property 0.3, cash/everything ~0.

### Library — `src/lib/montecarlo.ts`

```ts
export interface McConfig {
  startValueByClass: Record<AssetClass, number>
  monthlyContributionCZK: number
  contributionGrowthPct: number    // annual raise
  years: number                    // 10, 20, 30
  simulations: number              // default 5000
  assumptions: MarketAssumption[]
  seed?: number                    // reproducible runs
  withdrawalStartYear?: number
  annualWithdrawalCZK?: number
}

export interface McResult {
  percentiles: { year: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]
  finalValues: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }
  probabilityOfTarget: number      // P(ending ≥ FI number)
  probabilityOfRuin: number        // P(hitting 0 before horizon), when withdrawals are modelled
  medianYearReachingTarget: number | null
}

export function runMonteCarlo(config: McConfig): McResult
```

Implementation notes:

- Monthly steps. Log-normal returns: `r_m = exp(μ_m + σ_m·z) − 1`, with `μ_m = ln(1+μ)/12 − σ_m²/2`.
- Correlate draws via Cholesky decomposition of the correlation matrix.
- Seeded PRNG (mulberry32 or xorshift) so a re-run with the same seed gives the same fan — users lose trust in a chart that jumps every refresh.
- 5000 sims × 360 months × 4 classes is fine in a Web Worker; run it there and show a progress bar. Do not block the main thread.
- Optional: a bootstrap mode resampling historical annual returns instead of assuming normality. Worth it — fat tails matter and the normal assumption flatters the p5.

### Page `/projection`

1. Fan chart: p5–p95 shaded bands around the median, FI number as a `ReferenceLine`, x-axis in years and calendar years
2. Headline: "Median outcome in 20 years: 14.2M CZK. 90% of outcomes fall between 8.1M and 26.4M."
3. Probability card: chance of reaching the FI number by year 10 / 20 / 30
4. Input panel: contribution, horizon, expected returns and vol per class, number of sims, seed
5. Histogram of final values with the FI number marked
6. Plain-language caveat: these are assumptions compounded, not predictions; the width of the band is the honest part of the answer

---

## Sidebar navigation (final state)

```
Overview      Net worth · Performance · Allocation · Transactions
Analysis      Benchmark · Rebalance · Risk · FX attribution        [--text2]
Stocks & ETFs Holdings · Dividends · Projected · Ex-div cal. · Fees [--green]
Cash & Savings Bank accounts                                        [--blue]
Crypto        Holdings                                              [--purple]
Real Estate   Properties                                            [--teal]
Planning      FIRE · Scenarios · Projection                         [--amber]
```

---

## Suggested commit sequence

```
1  refactor: extract lib/portfolio.ts, migrate allocation + dashboard to it
2  feat: transactions schema + /transactions page (manual entry)
3  feat: lib/returns.ts (xirr, twr) + contributions-vs-growth on dashboard
4  feat: transaction backfill from holdings/dividends
5  feat: CSV import
6  feat: asset_metadata + /risk page
7  feat: allocation_targets + /rebalance with contribution allocator
8  feat: benchmark_prices + sync route + /benchmark
9  feat: per-currency exposure in snapshots + /fx-attribution
10 feat: financial_plan + /fire
11 feat: emergency runway card (fire + cash + dashboard tile)
12 feat: scenarios + /scenarios
13 feat: monte carlo worker + /projection
14 chore: nightly cron for snapshots + benchmark sync
```

---

## Things to be careful about

- **Don't break existing pages.** The `portfolio.ts` refactor touches the dashboard; verify net worth is unchanged to the koruna before and after.
- **Empty state everywhere.** Half these features start with zero rows. Every page must render something useful and explain what to add.
- **`profile_id` on every single query.** A leak across profiles is the worst bug this app can have.
- **Freeze FX at transaction time** (`fx_rate_czk` on the row). Re-deriving historical CZK values from today's rate silently corrupts every historical figure.
- **Keep maths out of components.** Every formula lives in `src/lib/*` as a pure function, so it can be checked by hand and reused.
- **Numbers that can't be computed show `—`, never `NaN`, `0`, or `Infinity`.** XIRR with one flow, drift with no targets, runway with no expenses — all are legitimate "not enough data yet" states.
