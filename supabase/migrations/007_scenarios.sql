-- 007_scenarios.sql — F8 scenario stress tests
-- Idempotent: safe to re-run.

create table if not exists scenarios (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  name        text not null,
  description text,
  shocks      jsonb not null,
  is_preset   boolean default false,
  created_at  timestamptz default now()
);

create index if not exists idx_scenarios_profile on scenarios(profile_id);
