-- 010_bonds.sql — fixed income (government & corporate bonds)
-- Idempotent: safe to re-run.
--
-- A bond is not a holding with a funny name. It has a nominal you get back on a
-- fixed date, a price quoted as a percentage of that nominal, and interest that
-- accrues every day between coupons — none of which the `holdings` table can
-- express. Modelling a French OAT as a share would report its price (≈ 92) as a
-- currency amount and its coupon as a dividend yield on the wrong base.

create table if not exists bonds (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,

  -- Identity
  name          text not null,                       -- 'OAT 3.00% 25 May 2054'
  issuer        text not null default '',            -- 'République Française (AFT)'
  isin          text,                                -- 'FR001400UKX0'
  bond_type     text not null default 'government',  -- government | corporate | municipal | supranational | inflation_linked
  country       text,                                -- ISO-2, 'FR'
  currency      text not null default 'EUR',

  -- Size. `face_value` is the nominal of ONE unit (an OAT is quoted per €1 of
  -- nominal); `quantity` is how many units are held. Nominal held is the product.
  face_value    numeric not null default 1,
  quantity      numeric not null default 0,

  -- Prices are CLEAN, as a percentage of par: 92.35 means 92.35%, not €92.35.
  -- Keeping them in percent is what makes the value independent of face_value.
  purchase_price_pct numeric not null default 100,
  current_price_pct  numeric,            -- null → valued at cost, and the UI says so

  -- Coupon. Rate is a decimal fraction: 3% is 0.03.
  coupon_rate       numeric not null default 0,
  coupons_per_year  int not null default 1,          -- OAT pays annually
  day_count         text not null default 'ACT/ACT', -- ACT/ACT | ACT/365 | 30/360

  -- Dates
  issue_date    date,
  maturity_date date not null,
  purchase_date date,

  -- Accrued interest paid to the seller at purchase (coupon couru). Part of what
  -- the position cost, so leaving it out overstates the gain.
  accrued_at_purchase numeric not null default 0,

  -- Withholding on coupons at source, as a decimal fraction.
  withholding_tax_pct numeric not null default 0,

  -- Inflation-linked issues (OAT€i / OATi) carry an indexation coefficient that
  -- scales both the nominal repaid and every coupon.
  is_inflation_linked boolean not null default false,
  index_ratio         numeric not null default 1,

  liquidity_tier text,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists idx_bonds_profile on bonds(profile_id);
create index if not exists idx_bonds_maturity on bonds(profile_id, maturity_date);

-- Coupons actually received, so realised income is a record rather than a model.
create table if not exists bond_coupons_received (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  bond_id       uuid not null references bonds(id) on delete cascade,
  payment_date  date not null,
  gross_amount  numeric not null,
  tax_withheld  numeric not null default 0,
  net_amount    numeric not null,
  currency      text not null default 'EUR',
  notes         text,
  created_at    timestamptz default now()
);

create index if not exists idx_bond_coupons_profile_date
  on bond_coupons_received(profile_id, payment_date desc);

-- Bonds get their own column on the daily snapshot, like every other class.
alter table portfolio_snapshots add column if not exists bonds_czk numeric default 0;
