-- 015_manual_price.sql — a price the user enters when no quote source has one
-- Idempotent: safe to re-run. Adds columns only.
--
-- A delisted or thinly-covered ticker (e.g. SKLZ) never gets a live quote, so
-- it was valued at cost forever and blocked every daily snapshot. A manual
-- price, with the date it was taken, is used only when no live quote arrives;
-- the UI labels it "manual" and flags it once it is more than 30 days old.

alter table holdings add column if not exists manual_price numeric
  check (manual_price is null or manual_price >= 0);
alter table holdings add column if not exists manual_price_date date;
