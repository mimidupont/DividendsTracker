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
