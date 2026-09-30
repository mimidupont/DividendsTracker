-- ============================================================
-- Divvy — Supabase schema
-- Run this in your Supabase project: SQL Editor > New query
--
-- The app reads and writes ALL of these tables. The previous version of this
-- file only described holdings, holding_lots, dividends_received and
-- dividend_projections, and had no profile_id anywhere — so a fresh project
-- built from it failed on every query the app makes.
-- ============================================================

-- ── Profiles ────────────────────────────────────────────────
-- Every other table is scoped by profile_id. The app loads profiles first and
-- stores the active one in localStorage; with no rows here it has nothing to
-- select and all pages come up empty.
create table if not exists profiles (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  display_name   text not null,
  initials       text not null,
  base_currency  text not null default 'CZK',
  created_at     timestamptz default now()
);

-- ── Stocks & ETFs ───────────────────────────────────────────
create table if not exists holdings (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  symbol          text not null,
  name            text not null,
  shares          numeric not null,
  -- Weighted average purchase price, in `currency`
  avg_price       numeric not null,
  currency        text not null default 'USD',
  exchange        text,
  purchase_date   date,
  is_dividend_payer boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (profile_id, symbol)
);
create index if not exists holdings_profile_idx on holdings (profile_id);

-- Individual purchase lots (for cost basis history)
create table if not exists holding_lots (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  holding_id      uuid references holdings(id) on delete cascade,
  symbol          text not null,
  shares          numeric not null,
  purchase_price  numeric not null,
  purchase_date   date,
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists holding_lots_profile_idx on holding_lots (profile_id);

-- Dividends received log (with DRIP tracking)
create table if not exists dividends_received (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  symbol            text not null,
  payment_date      date not null,
  ex_date           date,
  amount_per_share  numeric not null,
  shares_held       numeric not null,
  gross_amount      numeric not null,
  withholding_tax   numeric default 0,
  net_amount        numeric generated always as (gross_amount - coalesce(withholding_tax, 0)) stored,
  currency          text not null default 'USD',
  drip_shares_added numeric,
  drip_price        numeric,
  notes             text,
  created_at        timestamptz default now(),
  -- Guards the DRIP flow against logging the same payment twice
  unique (profile_id, symbol, payment_date)
);
create index if not exists dividends_profile_date_idx on dividends_received (profile_id, payment_date desc);

-- Dividend projections (one row per symbol per year)
create table if not exists dividend_projections (
  id                      uuid primary key default gen_random_uuid(),
  profile_id              uuid not null references profiles(id) on delete cascade,
  symbol                  text not null,
  year                    int not null,
  projected_div_per_share numeric,
  -- Stored as a decimal fraction: 0.041 = 4.1%
  projected_yield         numeric,
  growth_rate             numeric default 0.04,
  projected_total         numeric,
  currency                text not null default 'USD',
  notes                   text,
  updated_at              timestamptz default now(),
  -- Was unique(symbol, year), which stopped a second profile from projecting
  -- the same ticker at all
  unique (profile_id, symbol, year)
);

-- ── Cash & savings ──────────────────────────────────────────
create table if not exists bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  name            text not null,
  institution     text not null,
  account_type    text not null default 'savings'
                  check (account_type in ('savings','checking','money_market','fixed_deposit')),
  balance         numeric not null default 0,
  currency        text not null default 'CZK',
  -- Decimal fraction, NOT a percentage: 4.5% is stored as 0.045
  interest_rate   numeric not null default 0,
  interest_type   text default 'annual',
  maturity_date   date,
  notes           text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists bank_accounts_profile_idx on bank_accounts (profile_id);

create table if not exists bank_interest_received (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  account_id    uuid references bank_accounts(id) on delete cascade,
  payment_date  date not null,
  gross_amount  numeric not null,
  tax_withheld  numeric default 0,
  net_amount    numeric generated always as (gross_amount - coalesce(tax_withheld, 0)) stored,
  currency      text not null default 'CZK',
  notes         text,
  created_at    timestamptz default now()
);
create index if not exists bank_interest_profile_idx on bank_interest_received (profile_id);

-- ── Crypto ──────────────────────────────────────────────────
create table if not exists crypto_holdings (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  -- CoinGecko id (e.g. "bitcoin"), used to fetch the live price
  coin_id       text not null,
  symbol        text not null,
  name          text not null,
  amount        numeric not null default 0,
  avg_cost_usd  numeric not null default 0,
  wallet_label  text,
  purchase_date date,
  -- Decimal fraction: 5% APY is stored as 0.05
  staking_apy   numeric not null default 0,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists crypto_profile_idx on crypto_holdings (profile_id);

-- ── Real estate ─────────────────────────────────────────────
create table if not exists real_estate (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references profiles(id) on delete cascade,
  name                 text not null,
  property_type        text not null default 'residential'
                       check (property_type in ('residential','commercial','land','reit')),
  address              text,
  purchase_price       numeric not null default 0,
  current_value        numeric not null default 0,
  currency             text not null default 'CZK',
  purchase_date        date,
  monthly_rent         numeric not null default 0,
  mortgage_balance     numeric not null default 0,
  -- Decimal fraction: 4.9% is stored as 0.049
  mortgage_rate        numeric not null default 0,
  monthly_mortgage     numeric not null default 0,
  -- Percentage 0–100. Applied to value, purchase price, mortgage and rent alike.
  ownership_pct        numeric not null default 100 check (ownership_pct between 0 and 100),
  notes                text,
  is_primary_residence boolean default false,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index if not exists real_estate_profile_idx on real_estate (profile_id);

-- ── Daily net worth history ─────────────────────────────────
-- Written once a day by the dashboard; drives the P&L chart and the
-- 7d / 30d / YTD figures.
create table if not exists portfolio_snapshots (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  snapshot_date   date not null,
  total_value_czk numeric not null,
  stocks_czk      numeric not null default 0,
  cash_czk        numeric not null default 0,
  crypto_czk      numeric not null default 0,
  realestate_czk  numeric not null default 0,
  -- Rates the snapshot was struck at, so a historical value can be explained
  fx_usd          numeric,
  fx_eur          numeric,
  created_at      timestamptz default now(),
  -- The API upserts on this pair; without it every page load appends a row
  unique (profile_id, snapshot_date)
);
create index if not exists snapshots_profile_date_idx on portfolio_snapshots (profile_id, snapshot_date);

-- ============================================================
-- Access control
-- ============================================================
-- The app talks to Supabase with the anon key and has no login. With RLS
-- disabled (the default for tables created this way), ANYONE who obtains that
-- key — it ships in the browser bundle — can read and write every row.
--
-- That is acceptable only for a private deployment you alone use. If this is
-- ever exposed publicly, add Supabase Auth and replace the permissive policies
-- below with ones that check auth.uid().
--
-- To lock the tables to authenticated users once auth is in place:
--
--   alter table profiles enable row level security;
--   create policy "own data" on profiles
--     for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
--   -- ...and the same for every table above, joined back to the owner.

-- ============================================================
-- Seed data — example profile and portfolio
-- Adjust or delete before using with your own data.
-- ============================================================

insert into profiles (id, name, display_name, initials, base_currency)
values ('11111111-1111-1111-1111-111111111111', 'default', 'Eliot', 'EL', 'CZK')
on conflict do nothing;

insert into holdings (profile_id, symbol, name, shares, avg_price, currency, exchange, purchase_date, is_dividend_payer) values
  ('11111111-1111-1111-1111-111111111111', 'SPY5',  'SPDR S&P 500 UCITS ETF',        14.7928, 458.04,   'USD', 'LSEETF', '2023-04-15', true),
  ('11111111-1111-1111-1111-111111111111', 'JPM',   'JPMorgan Chase & Co',            15.6195, 118.50,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'KO',    'Coca-Cola Co',                   53.9520, 58.67,    'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'T',     'AT&T Inc',                      110.2697, 22.37,    'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'MCD',   'McDonald''s Corp',                9.9126, 284.54,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'AMZN',  'Amazon.com Inc',                 10.0000, 118.01,   'USD', 'NASDAQ', '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'AAPL',  'Apple Inc',                       8.0437, 149.62,   'USD', 'NASDAQ', '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'RIO',   'Rio Tinto PLC ADR',              20.6108,  66.13,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'VZ',    'Verizon Communications',         20.8337,  44.05,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'O',     'Realty Income Corp',             20.2962,  57.77,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'PEP',   'PepsiCo Inc',                     2.0530, 144.45,   'USD', 'NASDAQ', '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'PG',    'Procter & Gamble Co',             6.2029, 169.33,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'ICL',   'ICL Group Ltd',                  41.6579,   7.49,   'USD', 'NYSE',   '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'OPEN',  'Opendoor Technologies',          40.0000,  14.24,   'USD', 'NASDAQ', '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'KPLT',  'Katapult Holdings',              11.0000, 113.88,   'USD', 'NASDAQ', '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'PSNY',  'Polestar Automotive',             2.0000, 100.15,   'USD', 'NASDAQ', '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'BYND',  'Beyond Meat Inc',                 3.0000, 132.04,   'USD', 'NASDAQ', '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'SKLZ',  'Skillz Inc',                      1.0000, 438.60,   'USD', 'NYSE',   '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'SPYW',  'SPDR Euro Dividend Aristocrats', 45.0000,  27.77,   'EUR', 'IBIS2',  '2026-03-13', true),
  ('11111111-1111-1111-1111-111111111111', 'CSG1',  'CSG NV',                          3.0000,  33.47,   'EUR', 'AEB',    '2021-01-01', false),
  ('11111111-1111-1111-1111-111111111111', 'ERBAG', 'Erste Group Bank AG',            11.0000, 1850.82,  'CZK', 'PRA',    '2021-01-01', true),
  ('11111111-1111-1111-1111-111111111111', 'MONET', 'Moneta Money Bank AS',           20.0000,  196.70,  'CZK', 'PRA',    '2021-01-01', true)
on conflict do nothing;

-- Dividends received
insert into dividends_received (profile_id, symbol, payment_date, ex_date, amount_per_share, shares_held, gross_amount, withholding_tax, currency, notes) values
  ('11111111-1111-1111-1111-111111111111', 'O',  '2026-03-13', '2026-02-27', 0.27, 20.225,  5.46,  0.82, 'USD', 'Monthly dividend'),
  ('11111111-1111-1111-1111-111111111111', 'KO', '2026-04-01', '2026-03-13', 0.53, 53.952, 28.59,  4.29, 'USD', 'Q1 2026 dividend')
on conflict do nothing;

-- 2027 projections
insert into dividend_projections (profile_id, symbol, year, projected_div_per_share, projected_yield, growth_rate, projected_total, currency) values
  ('11111111-1111-1111-1111-111111111111', 'SPY5',  2027, 18.50,  0.014, 0.03,  273.80, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'T',     2027,  1.15,  0.041, 0.03,  126.81, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'KO',    2027,  2.20,  0.028, 0.04,  118.69, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'JPM',   2027,  6.48,  0.021, 0.08,  101.22, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'RIO',   2027,  4.50,  0.050, 0.00,   92.75, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'MCD',   2027,  7.81,  0.024, 0.05,   77.43, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'O',     2027,  3.37,  0.052, 0.04,   68.40, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'SPYW',  2027,  1.14,  0.041, 0.04,   55.61, 'EUR'),
  ('11111111-1111-1111-1111-111111111111', 'VZ',    2027,  2.82,  0.055, 0.02,   58.75, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'PG',    2027,  4.44,  0.029, 0.05,   27.53, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'PEP',   2027,  5.97,  0.037, 0.05,   12.24, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'ICL',   2027,  0.28,  0.050, 0.00,   11.66, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'AAPL',  2027,  1.04,  0.004, 0.06,    8.37, 'USD'),
  ('11111111-1111-1111-1111-111111111111', 'ERBAG', 2027, 82.00,  0.032, 0.10,  902.00, 'CZK'),
  ('11111111-1111-1111-1111-111111111111', 'MONET', 2027, 16.00,  0.080, 0.03,  320.00, 'CZK')
on conflict (profile_id, symbol, year) do nothing;

-- ============================================================
-- v2 tables (see supabase/migrations/ for the incremental versions)
-- ============================================================

-- ── supabase/migrations/001_transactions.sql ──
-- 001_transactions.sql — F1 transactions ledger
-- Idempotent: safe to re-run.

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
  asset_id      uuid,           -- holdings.id / bank_accounts.id / crypto_holdings.id / real_estate.id
  quantity      numeric,        -- shares / coins; null for pure cash movements
  price         numeric,        -- per unit, native currency
  amount        numeric not null,  -- signed gross, native currency (+ in, - out)
  fee           numeric default 0,
  tax           numeric default 0,
  currency      text not null default 'CZK',

  -- CZK conversion frozen at transaction time. Re-deriving this from today's
  -- rate would silently rewrite every historical figure.
  fx_rate_czk   numeric not null,
  amount_czk    numeric generated always as (amount * fx_rate_czk) stored,

  -- return maths: external = money crossing the boundary of your wealth
  is_external   boolean not null default false,
  counterparty_account_id uuid,

  notes         text,
  created_at    timestamptz default now()
);

create index if not exists idx_txn_profile_date on transactions(profile_id, txn_date);
create index if not exists idx_txn_symbol on transactions(profile_id, symbol);

-- ── supabase/migrations/002_asset_metadata.sql ──
-- 002_asset_metadata.sql — F4 risk & concentration metadata
-- Idempotent: safe to re-run.

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

create index if not exists idx_asset_metadata_profile on asset_metadata(profile_id);

-- Liquidity tiers on the other asset classes
alter table bank_accounts   add column if not exists liquidity_tier text default 'instant';
alter table crypto_holdings add column if not exists liquidity_tier text default 'week';
alter table real_estate     add column if not exists liquidity_tier text default 'year';

-- ── supabase/migrations/003_allocation_targets.sql ──
-- 003_allocation_targets.sql — F3 rebalancing targets
-- Idempotent: safe to re-run.

create table if not exists allocation_targets (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  scope        text not null check (scope in ('asset_class','sector','region','symbol')),
  bucket       text not null,     -- 'stock' | 'Technology' | 'US' | 'SPY5'
  target_pct   numeric not null,  -- 0-1
  band_pct     numeric default 0.05,
  min_pct      numeric,
  max_pct      numeric,
  notes        text,
  updated_at   timestamptz default now(),
  unique(profile_id, scope, bucket)
);

create index if not exists idx_alloc_targets_profile on allocation_targets(profile_id, scope);

-- ── supabase/migrations/004_benchmarks.sql ──
-- 004_benchmarks.sql — F2 benchmark comparison
-- Idempotent: safe to re-run.
-- Benchmark prices are deliberately NOT profile-scoped: they are shared market data.

create table if not exists benchmark_prices (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,        -- 'SPY','IWDA','URTH','CZK_SAVINGS'
  price_date date not null,
  close      numeric not null,
  currency   text not null default 'USD',
  unique(symbol, price_date)
);

create index if not exists idx_benchmark_symbol_date on benchmark_prices(symbol, price_date);

create table if not exists benchmark_config (
  profile_id          uuid primary key references profiles(id) on delete cascade,
  primary_benchmark   text default 'SPY',
  secondary_benchmark text default 'IWDA',
  updated_at          timestamptz default now()
);

-- ── supabase/migrations/005_snapshot_exposure.sql ──
-- 005_snapshot_exposure.sql — F5 FX attribution
-- Idempotent: safe to re-run.
--
-- Snapshots stored CZK totals only, which cannot separate "the asset moved"
-- from "the koruna moved". These columns record exposure per currency in its
-- own units, so the two effects can be attributed separately.
-- Historical rows keep zeros; the UI reports attribution as available only
-- from the first date that carries exposure data.

alter table portfolio_snapshots add column if not exists exposure_usd_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_eur_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_czk_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_other_czk numeric default 0;
alter table portfolio_snapshots add column if not exists fx_gbp numeric;

-- ── supabase/migrations/006_financial_plan.sql ──
-- 006_financial_plan.sql — F6 FIRE dashboard
-- Idempotent: safe to re-run.

create table if not exists financial_plan (
  profile_id                uuid primary key references profiles(id) on delete cascade,
  annual_expenses_czk       numeric not null default 600000,
  annual_income_czk         numeric,
  monthly_contribution_czk  numeric default 0,
  -- Decimal fractions: 4% SWR is stored as 0.04
  swr_pct                   numeric default 0.04,
  expected_real_return      numeric default 0.05,
  inflation_pct             numeric default 0.025,
  birth_year                int,
  target_retirement_age     int,
  include_property_in_fi    boolean default false,
  include_primary_residence boolean default false,
  updated_at                timestamptz default now()
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

create index if not exists idx_expense_log_profile_month on expense_log(profile_id, month);

-- ── supabase/migrations/007_scenarios.sql ──
-- 007_scenarios.sql — F8 scenario stress tests
-- Idempotent: safe to re-run.

create table if not exists scenarios (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text,
  shocks      jsonb not null,
  is_preset   boolean default false,
  created_at  timestamptz default now()
);

create index if not exists idx_scenarios_profile on scenarios(profile_id);

-- ── supabase/migrations/008_market_assumptions.sql ──
-- 008_market_assumptions.sql — F9 Monte Carlo projection
-- Idempotent: safe to re-run.

create table if not exists market_assumptions (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references profiles(id) on delete cascade,
  asset_class          text not null,
  -- Real (after-inflation) expected return and annualised volatility,
  -- both as decimal fractions: 5.5% is stored as 0.055
  expected_real_return numeric not null,
  volatility           numeric not null,
  unique(profile_id, asset_class)
);

create index if not exists idx_market_assumptions_profile on market_assumptions(profile_id);



-- ============================================================
-- 009_add_holding_lot (also in supabase/migrations/)
-- ============================================================

-- 009_add_holding_lot.sql — atomic "add lot" for the holdings page
-- Idempotent: safe to re-run.
--
-- Adding a lot is two dependent writes: recalculate the position's weighted
-- average, then record the lot. Done as separate requests from the browser, a
-- failure on the second leaves the position already moved with no lot behind
-- it — the shares are there but the history that explains them is not.
--
-- Wrapping both in a function makes them one statement, so either both land or
-- neither does.

create or replace function add_holding_lot(
  p_holding_id   uuid,
  p_profile_id   uuid,
  p_shares       numeric,
  p_price        numeric,
  p_purchase_date date default null,
  p_notes        text default null
)
returns holdings
language plpgsql
as $$
declare
  v_holding holdings;
begin
  if p_shares is null or p_shares <= 0 then
    raise exception 'shares must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;

  -- Lock the row so two concurrent adds cannot both read the old average and
  -- write back a figure that ignores the other.
  select * into v_holding
  from holdings
  where id = p_holding_id and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'holding % not found for this profile', p_holding_id;
  end if;

  update holdings
  set shares = v_holding.shares + p_shares,
      avg_price = (v_holding.shares * v_holding.avg_price + p_shares * p_price)
                  / (v_holding.shares + p_shares),
      updated_at = now()
  where id = p_holding_id
  returning * into v_holding;

  insert into holding_lots (holding_id, symbol, shares, purchase_price, purchase_date, notes, profile_id)
  values (p_holding_id, v_holding.symbol, p_shares, p_price, p_purchase_date, p_notes, p_profile_id);

  return v_holding;
end;
$$;


-- ============================================================
-- 010_frozen_fx (also in supabase/migrations/)
-- ============================================================

-- 010_frozen_fx.sql — freeze the CZK rate on every historical money row
-- Idempotent: safe to re-run. Adds columns only; nothing is dropped or rewritten.
--
-- Until now cost basis, dividends and interest were converted to CZK at
-- *today's* rate, so a US position bought at 23.50 CZK/USD and still at the
-- same dollar price showed zero P&L after the koruna strengthened, and every
-- past dividend was re-priced each morning. The rate on the day money moved is
-- stored with the row from now on; rows without one fall back to today's rate
-- and the UI labels them.

-- CZK per 1 unit of the lot's currency (major unit: GBP, not GBp) on the purchase date.
alter table holding_lots          add column if not exists fx_rate_czk numeric;
-- Cost-weighted average of the lots' rates, i.e. CZK per unit of `currency`
-- at which the position's cost was actually paid.
alter table holdings              add column if not exists avg_fx_czk numeric;
-- CZK per USD at purchase (crypto cost is kept in USD).
alter table crypto_holdings       add column if not exists avg_fx_czk numeric;
-- CZK per unit of the payment's currency on the payment date.
alter table dividends_received    add column if not exists fx_rate_czk numeric;
alter table bank_interest_received add column if not exists fx_rate_czk numeric;

-- A term deposit defaulted to 'instant' liquidity, which hid its maturity from
-- the runway calculation. New rows get no default; the app derives the tier
-- from the account type and maturity date instead.
alter table bank_accounts alter column liquidity_tier drop default;

-- Snapshots record how many positions were valued at cost, so partial days can
-- be spotted (and are no longer written at all by the app — see README).
alter table portfolio_snapshots add column if not exists unpriced_count integer default 0;

-- add_holding_lot now also freezes the lot's FX rate and blends it into the
-- position's average rate. The old 6-argument version is replaced so PostgREST
-- has exactly one candidate to call.
drop function if exists add_holding_lot(uuid, uuid, numeric, numeric, date, text);

create or replace function add_holding_lot(
  p_holding_id    uuid,
  p_profile_id    uuid,
  p_shares        numeric,
  p_price         numeric,
  p_purchase_date date default null,
  p_notes         text default null,
  p_fx_rate_czk   numeric default null
)
returns holdings
language plpgsql
as $$
declare
  v_holding holdings;
  v_old_cost numeric;
  v_new_cost numeric;
begin
  if p_shares is null or p_shares <= 0 then
    raise exception 'shares must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;
  if p_fx_rate_czk is not null and p_fx_rate_czk <= 0 then
    raise exception 'fx rate must be positive';
  end if;

  select * into v_holding
  from holdings
  where id = p_holding_id and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'holding % not found for this profile', p_holding_id;
  end if;

  v_old_cost := v_holding.shares * v_holding.avg_price;
  v_new_cost := p_shares * p_price;

  update holdings
  set shares = v_holding.shares + p_shares,
      avg_price = (v_old_cost + v_new_cost) / (v_holding.shares + p_shares),
      -- The blended rate is only knowable when both sides have one; an unknown
      -- old rate stays unknown rather than being overwritten by the new lot's.
      avg_fx_czk = case
        when p_fx_rate_czk is null then v_holding.avg_fx_czk
        when v_holding.shares <= 0 then p_fx_rate_czk
        when v_holding.avg_fx_czk is null then null
        else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * p_fx_rate_czk) / (v_old_cost + v_new_cost)
      end,
      updated_at = now()
  where id = p_holding_id and profile_id = p_profile_id
  returning * into v_holding;

  insert into holding_lots (holding_id, symbol, shares, purchase_price, purchase_date, notes, profile_id, fx_rate_czk)
  values (p_holding_id, v_holding.symbol, p_shares, p_price, p_purchase_date, p_notes, p_profile_id, p_fx_rate_czk);

  return v_holding;
end;
$$;

-- GBP exposure is tracked separately so FX attribution can split it (it was
-- lumped into "other", whose currency effect is invisible).
alter table portfolio_snapshots add column if not exists exposure_gbp_local numeric default 0;


-- ============================================================
-- 011_bonds (also in supabase/migrations/)
-- ============================================================

-- 011_bonds.sql — bonds & fixed income as an asset class
-- Idempotent: safe to re-run. Adds a table and columns; the only thing
-- replaced is the transactions.asset_class CHECK, widened to allow 'bond'.

create table if not exists bond_holdings (
  id                        uuid primary key default gen_random_uuid(),
  profile_id                uuid not null references profiles(id) on delete cascade,
  isin                      text not null,
  name                      text not null,
  issuer_type               text not null default 'government'
                            check (issuer_type in ('government','corporate','municipal','savings')),
  currency                  text not null default 'CZK',
  -- Nominal of ONE bond, in `currency`
  face_value                numeric not null check (face_value > 0),
  -- Number of bonds held
  quantity                  numeric not null default 0 check (quantity >= 0),
  -- Decimal fraction: 4.5% is 0.045
  coupon_rate               numeric not null default 0 check (coupon_rate >= 0),
  -- Coupons per year; 0 = zero-coupon
  coupon_freq               integer not null default 1 check (coupon_freq in (0,1,2,4,12)),
  coupon_type               text not null default 'fixed'
                            check (coupon_type in ('fixed','floating','inflation','reinvest')),
  day_count                 text not null default 'ACT/ACT'
                            check (day_count in ('ACT/ACT','ACT/365','30E/360')),
  issue_date                date,
  maturity_date             date not null,
  purchase_date             date,
  -- Clean price paid, % of par (98.5 = 98.5 %)
  purchase_clean_price_pct  numeric,
  -- CZK per unit of `currency` on the purchase date
  purchase_fx_czk           numeric,
  -- Last known clean price, % of par. Null → valued at purchase price / par.
  clean_price_pct           numeric,
  price_date                date,
  -- Czech government savings bonds (Dluhopisy Republiky) are redeemable at par
  redeemable_early          boolean not null default false,
  liquidity_tier            text,
  notes                     text,
  is_active                 boolean not null default true,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),
  unique (profile_id, isin)
);
create index if not exists idx_bond_holdings_profile on bond_holdings(profile_id);

-- Bond ETFs are held as ordinary holdings; tagging them lets them count as
-- fixed income (rate shocks, bond volatility) instead of equity.
alter table asset_metadata add column if not exists asset_type text;

-- Snapshot history gets its own bond bucket.
alter table portfolio_snapshots add column if not exists bonds_czk numeric default 0;

-- The ledger can now record bond buys, sells and coupons.
alter table transactions drop constraint if exists transactions_asset_class_check;
alter table transactions add constraint transactions_asset_class_check
  check (asset_class in ('stock','cash','crypto','realestate','bond','none'));


-- ============================================================
-- 012_record_event (also in supabase/migrations/)
-- ============================================================

-- 012_record_event.sql — one atomic write for every money movement
-- Idempotent: safe to re-run (create or replace).
--
-- Buying shares, logging a dividend or changing a bank balance used to update
-- the asset table only; the transaction ledger — which the benchmark, returns
-- and realized P&L depend on — had to be re-entered by hand in a second form.
-- The two drifted apart. record_event() writes the ledger row AND applies the
-- side-effect (position, lot, dividend row, bank balance) in one statement, so
-- they cannot disagree and a failure leaves nothing half-done.
--
-- Event shape (jsonb), common fields:
--   kind          'buy' | 'sell' | 'dividend' | 'coupon' | 'interest'
--                 | 'deposit' | 'withdrawal' | 'fee'
--   asset_class   'stock' | 'crypto' | 'bond' | 'cash'
--   date          'YYYY-MM-DD'
--   currency      ISO code of the amounts below
--   fx_rate_czk   CZK per 1 unit of currency on `date` (required, > 0)
--   fee, tax      optional, in `currency`
--   notes         optional
--   cash_account_id  optional: settle against this bank account (same currency)
-- Per kind:
--   stock buy/sell:  symbol, name (new positions), quantity, price, exchange
--   crypto buy/sell: coin_id, symbol, name, quantity, price  (currency must be USD)
--   bond buy/sell:   bond_id, quantity, price_pct (clean, % of par), accrued (whole trade)
--   dividend:        symbol, gross, tax, ex_date, amount_per_share, shares_held,
--                    drip_shares, drip_price   (DRIP also adds a lot + a buy row)
--   coupon:          bond_id, gross, tax
--   interest:        account_id, gross, tax
--   deposit/withdrawal/fee: account_id, amount (positive)
--   split (stock):   symbol, quantity = ratio (4 for a 4-for-1 split, 0.1 for 1-for-10)

-- Stock splits are recorded in the ledger so cost basis and the time test
-- follow the shares through them.
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('buy','sell','deposit','withdrawal','dividend','interest','rent','fee','tax',
                  'transfer','adjustment','split'));

create or replace function record_event(p_profile_id uuid, p_event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_kind     text    := p_event->>'kind';
  v_class    text    := coalesce(p_event->>'asset_class', 'none');
  v_date     date    := (p_event->>'date')::date;
  v_ccy      text    := upper(coalesce(p_event->>'currency', 'CZK'));
  v_fx       numeric := (p_event->>'fx_rate_czk')::numeric;
  v_fee      numeric := coalesce((p_event->>'fee')::numeric, 0);
  v_tax      numeric := coalesce((p_event->>'tax')::numeric, 0);
  v_notes    text    := nullif(p_event->>'notes', '');
  v_qty      numeric := (p_event->>'quantity')::numeric;
  v_price    numeric := (p_event->>'price')::numeric;
  v_symbol   text    := nullif(upper(trim(coalesce(p_event->>'symbol', ''))), '');
  v_cash_acc uuid    := nullif(p_event->>'cash_account_id', '')::uuid;
  v_asset_id uuid;
  v_amount   numeric;          -- signed ledger amount in v_ccy
  v_cash_delta numeric := 0;   -- change to the settling bank account
  v_external boolean := false;
  v_txn_type text;
  v_holding  holdings;
  v_crypto   crypto_holdings;
  v_bond     bond_holdings;
  v_acc      bank_accounts;
  v_lot_price numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_gross    numeric;
  v_drip_shares numeric;
  v_drip_price  numeric;
  v_txn_id   uuid;
begin
  if p_profile_id is null then raise exception 'profile is required'; end if;
  if v_date is null then raise exception 'date is required'; end if;
  if v_fx is null or v_fx <= 0 then raise exception 'fx_rate_czk must be positive'; end if;
  if v_ccy = 'CZK' and v_fx <> 1 then raise exception 'fx_rate_czk must be 1 for CZK'; end if;
  if v_fee < 0 or v_tax < 0 then raise exception 'fee and tax cannot be negative'; end if;

  -- ── Stocks & ETFs ──────────────────────────────────────────────────────────
  if v_class = 'stock' and v_kind in ('buy', 'sell') then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
      raise exception 'quantity and price must be positive';
    end if;

    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;

    if v_kind = 'buy' then
      if not found then
        insert into holdings (profile_id, symbol, name, shares, avg_price, currency, exchange,
                              purchase_date, is_dividend_payer, avg_fx_czk)
        values (p_profile_id, v_symbol, coalesce(nullif(p_event->>'name', ''), v_symbol), 0, v_price,
                v_ccy, nullif(p_event->>'exchange', ''), v_date,
                coalesce((p_event->>'is_dividend_payer')::boolean, true), v_fx)
        returning * into v_holding;
      elsif upper(v_holding.currency) <> v_ccy then
        raise exception 'this position is booked in %, not %', v_holding.currency, v_ccy;
      end if;

      -- Fees are part of the acquisition cost (Czech convention).
      v_lot_price := v_price + v_fee / v_qty;
      v_old_cost  := v_holding.shares * v_holding.avg_price;
      v_new_cost  := v_qty * v_lot_price;

      update holdings set
        shares     = v_holding.shares + v_qty,
        avg_price  = (v_old_cost + v_new_cost) / (v_holding.shares + v_qty),
        avg_fx_czk = case
          when v_holding.shares <= 0 then v_fx
          when v_holding.avg_fx_czk is null then null
          else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * v_fx) / (v_old_cost + v_new_cost)
        end,
        purchase_date = coalesce(v_holding.purchase_date, v_date),
        updated_at = now()
      where id = v_holding.id
      returning * into v_holding;

      insert into holding_lots (profile_id, holding_id, symbol, shares, purchase_price, purchase_date, notes, fx_rate_czk)
      values (p_profile_id, v_holding.id, v_holding.symbol, v_qty, v_lot_price, v_date, v_notes, v_fx);

      v_amount := -(v_qty * v_price);
      v_cash_delta := v_amount - v_fee;
    else
      if not found then raise exception 'no % position to sell', v_symbol; end if;
      if v_qty > v_holding.shares + 1e-9 then
        raise exception 'cannot sell % — only % held', v_qty, v_holding.shares;
      end if;
      if upper(v_holding.currency) <> v_ccy then
        raise exception 'this position is booked in %, not %', v_holding.currency, v_ccy;
      end if;
      -- Average cost and its FX rate are unchanged by a sale; the position is
      -- kept at zero shares so its lots and history stay attached.
      update holdings set
        shares = greatest(0, v_holding.shares - v_qty),
        updated_at = now()
      where id = v_holding.id;
      v_amount := v_qty * v_price;
      v_cash_delta := v_amount - v_fee - v_tax;
    end if;
    v_asset_id := v_holding.id;
    v_txn_type := v_kind;

  -- ── Stock split: shares × ratio, prices ÷ ratio, value unchanged ──────────
  elsif v_class = 'stock' and v_kind = 'split' then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'split ratio must be positive'; end if;
    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;
    if not found then raise exception 'no % position to split', v_symbol; end if;
    update holdings set shares = shares * v_qty, avg_price = avg_price / v_qty, updated_at = now()
    where id = v_holding.id;
    update holding_lots set shares = shares * v_qty, purchase_price = purchase_price / v_qty
    where holding_id = v_holding.id and profile_id = p_profile_id;
    v_asset_id := v_holding.id;
    v_amount := 0;
    v_ccy := upper(v_holding.currency);
    v_fx := coalesce(v_holding.avg_fx_czk, 1);
    v_txn_type := 'split';

  -- ── Crypto (priced in USD) ─────────────────────────────────────────────────
  elsif v_class = 'crypto' and v_kind in ('buy', 'sell') then
    if v_ccy <> 'USD' then raise exception 'crypto trades are recorded in USD'; end if;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
      raise exception 'quantity and price must be positive';
    end if;
    select * into v_crypto from crypto_holdings
    where profile_id = p_profile_id and coin_id = p_event->>'coin_id'
    order by created_at limit 1
    for update;

    if v_kind = 'buy' then
      if not found then
        insert into crypto_holdings (profile_id, coin_id, symbol, name, amount, avg_cost_usd, purchase_date, avg_fx_czk)
        values (p_profile_id, p_event->>'coin_id', coalesce(v_symbol, upper(p_event->>'coin_id')),
                coalesce(nullif(p_event->>'name', ''), p_event->>'coin_id'), 0, v_price, v_date, v_fx)
        returning * into v_crypto;
      end if;
      v_lot_price := v_price + v_fee / v_qty;
      v_old_cost  := v_crypto.amount * v_crypto.avg_cost_usd;
      v_new_cost  := v_qty * v_lot_price;
      update crypto_holdings set
        amount       = v_crypto.amount + v_qty,
        avg_cost_usd = (v_old_cost + v_new_cost) / (v_crypto.amount + v_qty),
        avg_fx_czk   = case
          when v_crypto.amount <= 0 then v_fx
          when v_crypto.avg_fx_czk is null then null
          else (v_old_cost * v_crypto.avg_fx_czk + v_new_cost * v_fx) / (v_old_cost + v_new_cost)
        end,
        updated_at = now()
      where id = v_crypto.id;
      v_amount := -(v_qty * v_price);
      v_cash_delta := v_amount - v_fee;
    else
      if not found then raise exception 'no % holding to sell', p_event->>'coin_id'; end if;
      if v_qty > v_crypto.amount + 1e-12 then
        raise exception 'cannot sell % — only % held', v_qty, v_crypto.amount;
      end if;
      update crypto_holdings set amount = greatest(0, v_crypto.amount - v_qty), updated_at = now()
      where id = v_crypto.id;
      v_amount := v_qty * v_price;
      v_cash_delta := v_amount - v_fee - v_tax;
    end if;
    v_asset_id := v_crypto.id;
    v_symbol   := v_crypto.coin_id;
    v_txn_type := v_kind;

  -- ── Bonds ──────────────────────────────────────────────────────────────────
  elsif v_class = 'bond' and v_kind in ('buy', 'sell', 'coupon') then
    select * into v_bond from bond_holdings
    where id = (p_event->>'bond_id')::uuid and profile_id = p_profile_id
    for update;
    if not found then raise exception 'bond not found for this profile'; end if;
    if upper(v_bond.currency) <> v_ccy then
      raise exception 'this bond is denominated in %, not %', v_bond.currency, v_ccy;
    end if;
    v_symbol := v_bond.isin;
    v_asset_id := v_bond.id;

    if v_kind = 'coupon' then
      v_gross := (p_event->>'gross')::numeric;
      if v_gross is null or v_gross <= 0 then raise exception 'gross coupon must be positive'; end if;
      v_amount := v_gross;
      v_cash_delta := v_gross - v_tax;
      v_txn_type := 'interest';
      -- A reinvesting savings bond pays its coupon in new bonds.
      if v_bond.coupon_type = 'reinvest' then
        update bond_holdings set quantity = quantity + (v_gross - v_tax) / face_value, updated_at = now()
        where id = v_bond.id;
        v_cash_delta := 0;
      end if;
    else
      v_price := (p_event->>'price_pct')::numeric;
      if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
        raise exception 'quantity and price must be positive';
      end if;
      -- Clean price × par, plus accrued interest (AÚV) paid or received.
      v_amount := v_qty * v_bond.face_value * v_price / 100
                  + coalesce((p_event->>'accrued')::numeric, 0);
      if v_kind = 'buy' then
        update bond_holdings set
          purchase_clean_price_pct = case when v_bond.quantity <= 0 or v_bond.purchase_clean_price_pct is null
            then v_price
            else (v_bond.quantity * v_bond.purchase_clean_price_pct + v_qty * v_price) / (v_bond.quantity + v_qty) end,
          purchase_fx_czk = case when v_bond.quantity <= 0 then v_fx
            when v_bond.purchase_fx_czk is null then null
            else (v_bond.quantity * v_bond.purchase_fx_czk + v_qty * v_fx) / (v_bond.quantity + v_qty) end,
          quantity = v_bond.quantity + v_qty,
          purchase_date = coalesce(v_bond.purchase_date, v_date),
          updated_at = now()
        where id = v_bond.id;
        v_amount := -v_amount;
        v_cash_delta := v_amount - v_fee;
      else
        if v_qty > v_bond.quantity + 1e-9 then
          raise exception 'cannot sell % — only % held', v_qty, v_bond.quantity;
        end if;
        update bond_holdings set quantity = greatest(0, v_bond.quantity - v_qty), updated_at = now()
        where id = v_bond.id;
        v_cash_delta := v_amount - v_fee - v_tax;
      end if;
      v_txn_type := v_kind;
    end if;

  -- ── Dividends (optionally reinvested) ──────────────────────────────────────
  elsif v_kind = 'dividend' then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    v_gross := (p_event->>'gross')::numeric;
    if v_gross is null or v_gross <= 0 then raise exception 'gross dividend must be positive'; end if;

    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;

    insert into dividends_received (profile_id, symbol, payment_date, ex_date, amount_per_share,
      shares_held, gross_amount, withholding_tax, currency, drip_shares_added, drip_price, notes, fx_rate_czk)
    values (p_profile_id, v_symbol, v_date, nullif(p_event->>'ex_date', '')::date,
      coalesce((p_event->>'amount_per_share')::numeric, 0),
      coalesce((p_event->>'shares_held')::numeric, v_holding.shares, 0),
      v_gross, v_tax, v_ccy,
      nullif((p_event->>'drip_shares')::numeric, 0), (p_event->>'drip_price')::numeric, v_notes, v_fx);

    v_amount := v_gross;
    v_cash_delta := v_gross - v_tax;
    v_txn_type := 'dividend';
    v_class := 'stock';
    v_asset_id := v_holding.id;

    v_drip_shares := (p_event->>'drip_shares')::numeric;
    v_drip_price  := (p_event->>'drip_price')::numeric;
    if v_drip_shares is not null and v_drip_shares > 0 then
      if v_holding.id is null then raise exception 'no % position to reinvest into', v_symbol; end if;
      if v_drip_price is null or v_drip_price <= 0 then raise exception 'drip_price must be positive'; end if;
      -- drip_price is in the holding's currency; the lot carries its own rate.
      v_old_cost := v_holding.shares * v_holding.avg_price;
      v_new_cost := v_drip_shares * v_drip_price;
      update holdings set
        shares = v_holding.shares + v_drip_shares,
        avg_price = (v_old_cost + v_new_cost) / (v_holding.shares + v_drip_shares),
        avg_fx_czk = case
          when v_holding.avg_fx_czk is null or (p_event->>'drip_fx_rate_czk') is null then v_holding.avg_fx_czk
          else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * (p_event->>'drip_fx_rate_czk')::numeric)
               / (v_old_cost + v_new_cost)
        end,
        updated_at = now()
      where id = v_holding.id;
      insert into holding_lots (profile_id, holding_id, symbol, shares, purchase_price, purchase_date, notes, fx_rate_czk)
      values (p_profile_id, v_holding.id, v_holding.symbol, v_drip_shares, v_drip_price, v_date, 'DRIP',
              (p_event->>'drip_fx_rate_czk')::numeric);
      -- The reinvestment is a purchase in its own right: it gets its own
      -- ledger row so realized P&L and the time test know when these shares
      -- were acquired.
      insert into transactions (profile_id, txn_date, type, asset_class, symbol, asset_id, quantity, price,
        amount, fee, tax, currency, fx_rate_czk, is_external, notes)
      values (p_profile_id, v_date, 'buy', 'stock', v_holding.symbol, v_holding.id, v_drip_shares, v_drip_price,
        -(v_drip_shares * v_drip_price), 0, 0, upper(v_holding.currency),
        coalesce((p_event->>'drip_fx_rate_czk')::numeric, case when upper(v_holding.currency) = v_ccy then v_fx else null end, 1),
        false, 'DRIP reinvestment');
      v_cash_delta := 0;  -- reinvested, not paid out
    end if;

  -- ── Cash: interest, deposits, withdrawals, fees ────────────────────────────
  elsif v_kind in ('interest', 'deposit', 'withdrawal', 'fee') then
    select * into v_acc from bank_accounts
    where id = (p_event->>'account_id')::uuid and profile_id = p_profile_id
    for update;
    if not found then raise exception 'account not found for this profile'; end if;
    if upper(v_acc.currency) <> v_ccy then
      raise exception 'this account is in %, not %', v_acc.currency, v_ccy;
    end if;
    v_class := 'cash';
    v_asset_id := v_acc.id;

    if v_kind = 'interest' then
      v_gross := (p_event->>'gross')::numeric;
      if v_gross is null or v_gross <= 0 then raise exception 'gross interest must be positive'; end if;
      insert into bank_interest_received (profile_id, account_id, payment_date, gross_amount, tax_withheld, currency, notes, fx_rate_czk)
      values (p_profile_id, v_acc.id, v_date, v_gross, v_tax, v_ccy, v_notes, v_fx);
      v_amount := v_gross;
      v_txn_type := 'interest';
      update bank_accounts set balance = balance + v_gross - v_tax, updated_at = now() where id = v_acc.id;
    else
      v_amount := (p_event->>'amount')::numeric;
      if v_amount is null or v_amount <= 0 then raise exception 'amount must be positive'; end if;
      if v_kind = 'deposit' then
        v_external := true;
      else
        v_amount := -v_amount;
        v_external := v_kind = 'withdrawal';
      end if;
      v_txn_type := v_kind;
      update bank_accounts set balance = balance + v_amount, updated_at = now() where id = v_acc.id;
    end if;
    v_cash_acc := null;  -- already applied to the account itself

  else
    raise exception 'unsupported event: % %', v_class, v_kind;
  end if;

  -- ── Optional settlement against a bank account ─────────────────────────────
  if v_cash_acc is not null and v_cash_delta <> 0 then
    select * into v_acc from bank_accounts
    where id = v_cash_acc and profile_id = p_profile_id
    for update;
    if not found then raise exception 'settlement account not found for this profile'; end if;
    if upper(v_acc.currency) <> v_ccy then
      raise exception 'settlement account is in %, trade is in %', v_acc.currency, v_ccy;
    end if;
    update bank_accounts set balance = balance + v_cash_delta, updated_at = now() where id = v_acc.id;
  end if;

  insert into transactions (profile_id, txn_date, type, asset_class, symbol, asset_id, quantity, price,
    amount, fee, tax, currency, fx_rate_czk, is_external, counterparty_account_id, notes)
  values (p_profile_id, v_date, v_txn_type, v_class, v_symbol, v_asset_id,
    case when v_kind in ('buy', 'sell', 'split') then v_qty end,
    case when v_kind in ('buy', 'sell') then v_price end,
    v_amount, v_fee, v_tax, v_ccy, v_fx, v_external, v_cash_acc, v_notes)
  returning id into v_txn_id;

  return jsonb_build_object('transaction_id', v_txn_id, 'asset_id', v_asset_id);
end;
$$;


-- ============================================================
-- 013_property_details (also in supabase/migrations/)
-- ============================================================

-- 013_property_details.sql — valuation date and running costs for property
-- Idempotent: safe to re-run. Adds columns only.
--
-- A property's current_value is an estimate the user typed at some point; the
-- UI now says how old it is. Running costs (maintenance, insurance, property
-- tax, service charges) turn gross rent into a net yield.

alter table real_estate add column if not exists valuation_date date;
-- Annual running costs at 100 % ownership, in the property's currency.
alter table real_estate add column if not exists annual_costs numeric not null default 0;

-- ── 014 bank_interest_received.profile_id (older installs) ──

alter table bank_interest_received
  add column if not exists profile_id uuid references profiles(id) on delete cascade;

update bank_interest_received i
   set profile_id = b.profile_id
  from bank_accounts b
 where i.profile_id is null and i.account_id = b.id;

-- Only enforce NOT NULL once every row has a profile (rows with no account can't be placed).
do $$
begin
  if not exists (select 1 from bank_interest_received where profile_id is null) then
    alter table bank_interest_received alter column profile_id set not null;
  else
    raise notice 'bank_interest_received has rows with no account/profile - profile_id left nullable; fix those rows and re-run.';
  end if;
end $$;

create index if not exists bank_interest_profile_idx on bank_interest_received (profile_id);

notify pgrst, 'reload schema';

-- 015_manual_price.sql — a price the user enters when no quote source has one
-- Idempotent: safe to re-run. Adds columns only.
--
-- A delisted or thinly-covered ticker (e.g. SKLZ) never gets a live quote, so
-- it was valued at cost forever and blocked every daily snapshot. A manual
-- price, with the date it was taken, is used only when no live quote arrives;
-- the UI labels it "manual" and flags it once it is more than 30 days old.

alter table holdings add column if not exists manual_price numeric
  check (manual_price is null or manual_price >= 0);
alter table holdings add column if not exists manual_price_date date;
