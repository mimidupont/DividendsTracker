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
