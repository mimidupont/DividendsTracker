-- ============================================================
-- Divvy — Supabase schema (redesigned)
-- Run this in your Supabase project: SQL Editor > New query
-- ============================================================

-- Holdings table
create table if not exists holdings (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null,
  name            text not null,
  shares          numeric not null,
  avg_price       numeric not null,
  currency        text not null default 'USD',
  exchange        text,
  purchase_date   date,
  is_dividend_payer boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Individual purchase lots (for cost basis history)
create table if not exists holding_lots (
  id              uuid primary key default gen_random_uuid(),
  holding_id      uuid references holdings(id) on delete cascade,
  symbol          text not null,
  shares          numeric not null,
  purchase_price  numeric not null,
  purchase_date   date,
  notes           text,
  created_at      timestamptz default now()
);

-- Dividends received log (with DRIP tracking)
create table if not exists dividends_received (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  payment_date      date not null,
  ex_date           date,
  amount_per_share  numeric not null,
  shares_held       numeric not null,
  gross_amount      numeric not null,
  withholding_tax   numeric default 0,
  net_amount        numeric generated always as (gross_amount - withholding_tax) stored,
  currency          text not null default 'USD',
  drip_shares_added numeric,
  drip_price        numeric,
  notes             text,
  created_at        timestamptz default now()
);

-- Dividend projections
create table if not exists dividend_projections (
  id                      uuid primary key default gen_random_uuid(),
  symbol                  text not null,
  year                    int not null,
  projected_div_per_share numeric,
  projected_yield         numeric,
  growth_rate             numeric default 0.04,
  projected_total         numeric,
  currency                text not null default 'USD',
  notes                   text,
  updated_at              timestamptz default now(),
  unique(symbol, year)
);

-- ============================================================
-- Seed data — current portfolio (May 2026)
-- ============================================================

insert into holdings (symbol, name, shares, avg_price, currency, exchange, purchase_date, is_dividend_payer) values
  ('SPY5',  'SPDR S&P 500 UCITS ETF',        14.7928, 458.04,   'USD', 'LSEETF', '2023-04-15', true),
  ('JPM',   'JPMorgan Chase & Co',            15.6195, 118.50,   'USD', 'NYSE',   '2021-01-01', true),
  ('KO',    'Coca-Cola Co',                   53.9520, 58.67,    'USD', 'NYSE',   '2021-01-01', true),
  ('T',     'AT&T Inc',                      110.2697, 22.37,    'USD', 'NYSE',   '2021-01-01', true),
  ('MCD',   'McDonald''s Corp',                9.9126, 284.54,   'USD', 'NYSE',   '2021-01-01', true),
  ('AMZN',  'Amazon.com Inc',                 10.0000, 118.01,   'USD', 'NASDAQ', '2021-01-01', false),
  ('AAPL',  'Apple Inc',                       8.0437, 149.62,   'USD', 'NASDAQ', '2021-01-01', true),
  ('RIO',   'Rio Tinto PLC ADR',              20.6108,  66.13,   'USD', 'NYSE',   '2021-01-01', true),
  ('VZ',    'Verizon Communications',         20.8337,  44.05,   'USD', 'NYSE',   '2021-01-01', true),
  ('O',     'Realty Income Corp',             20.2962,  57.77,   'USD', 'NYSE',   '2021-01-01', true),
  ('PEP',   'PepsiCo Inc',                     2.0530, 144.45,   'USD', 'NASDAQ', '2021-01-01', true),
  ('PG',    'Procter & Gamble Co',             6.2029, 169.33,   'USD', 'NYSE',   '2021-01-01', true),
  ('ICL',   'ICL Group Ltd',                  41.6579,   7.49,   'USD', 'NYSE',   '2021-01-01', true),
  ('OPEN',  'Opendoor Technologies',          40.0000,  14.24,   'USD', 'NASDAQ', '2021-01-01', false),
  ('KPLT',  'Katapult Holdings',              11.0000, 113.88,   'USD', 'NASDAQ', '2021-01-01', false),
  ('PSNY',  'Polestar Automotive',             2.0000, 100.15,   'USD', 'NASDAQ', '2021-01-01', false),
  ('BYND',  'Beyond Meat Inc',                 3.0000, 132.04,   'USD', 'NASDAQ', '2021-01-01', false),
  ('SKLZ',  'Skillz Inc',                      1.0000, 438.60,   'USD', 'NYSE',   '2021-01-01', false),
  ('SPYW',  'SPDR Euro Dividend Aristocrats', 45.0000,  27.77,   'EUR', 'IBIS2',  '2026-03-13', true),
  ('CSG1',  'CSG NV',                          3.0000,  33.47,   'EUR', 'AEB',    '2021-01-01', false),
  ('ERBAG', 'Erste Group Bank AG',            11.0000, 1850.82,  'CZK', 'PRA',    '2021-01-01', true),
  ('MONET', 'Moneta Money Bank AS',           20.0000,  196.70,  'CZK', 'PRA',    '2021-01-01', true)
on conflict do nothing;

-- Dividends received
insert into dividends_received (symbol, payment_date, ex_date, amount_per_share, shares_held, gross_amount, withholding_tax, currency, notes) values
  ('O',  '2026-03-13', '2026-02-27', 0.27, 20.225,  5.46,  0.82, 'USD', 'Monthly dividend'),
  ('KO', '2026-04-01', '2026-03-13', 0.53, 53.952, 28.59,  4.29, 'USD', 'Q1 2026 dividend')
on conflict do nothing;

-- 2027 projections
insert into dividend_projections (symbol, year, projected_div_per_share, projected_yield, growth_rate, projected_total, currency) values
  ('SPY5',  2027, 18.50,  0.014, 0.03,  273.80, 'USD'),
  ('T',     2027,  1.15,  0.041, 0.03,  126.81, 'USD'),
  ('KO',    2027,  2.20,  0.028, 0.04,  118.69, 'USD'),
  ('JPM',   2027,  6.48,  0.021, 0.08,  101.22, 'USD'),
  ('RIO',   2027,  4.50,  0.050, 0.00,   92.75, 'USD'),
  ('MCD',   2027,  7.81,  0.024, 0.05,   77.43, 'USD'),
  ('O',     2027,  3.37,  0.052, 0.04,   68.40, 'USD'),
  ('SPYW',  2027,  1.14,  0.041, 0.04,   55.61, 'EUR'),
  ('VZ',    2027,  2.82,  0.055, 0.02,   58.75, 'USD'),
  ('PG',    2027,  4.44,  0.029, 0.05,   27.53, 'USD'),
  ('PEP',   2027,  5.97,  0.037, 0.05,   12.24, 'USD'),
  ('ICL',   2027,  0.28,  0.050, 0.00,   11.66, 'USD'),
  ('AAPL',  2027,  1.04,  0.004, 0.06,    8.37, 'USD'),
  ('ERBAG', 2027, 82.00,  0.032, 0.10,  902.00, 'CZK'),
  ('MONET', 2027, 16.00,  0.080, 0.03,  320.00, 'CZK')
on conflict (symbol, year) do nothing;
