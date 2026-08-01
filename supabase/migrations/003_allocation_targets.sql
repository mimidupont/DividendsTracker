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
