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
