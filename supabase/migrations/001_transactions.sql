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
