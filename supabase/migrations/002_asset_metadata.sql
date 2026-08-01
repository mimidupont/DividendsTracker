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
