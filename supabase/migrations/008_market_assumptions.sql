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
