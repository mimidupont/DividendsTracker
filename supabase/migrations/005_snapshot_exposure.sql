-- 005_snapshot_exposure.sql — F5 FX attribution
-- Idempotent: safe to re-run.
--
-- Snapshots stored CZK totals only, which cannot separate "the asset moved"
-- from "the koruna moved". These columns record exposure per currency in its
-- own units, so the two effects can be attributed separately.
-- Historical rows keep zeros; the UI reports attribution as available only
-- from the first date that carries exposure data.

alter table portfolio_snapshots add column if not exists exposure_usd_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_eur_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_czk_local numeric default 0;
alter table portfolio_snapshots add column if not exists exposure_other_czk numeric default 0;
alter table portfolio_snapshots add column if not exists fx_gbp numeric;
