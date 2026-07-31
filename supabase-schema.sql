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
