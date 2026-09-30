-- 013_property_details.sql — valuation date and running costs for property
-- Idempotent: safe to re-run. Adds columns only.
--
-- A property's current_value is an estimate the user typed at some point; the
-- UI now says how old it is. Running costs (maintenance, insurance, property
-- tax, service charges) turn gross rent into a net yield.

alter table real_estate add column if not exists valuation_date date;
-- Annual running costs at 100 % ownership, in the property's currency.
alter table real_estate add column if not exists annual_costs numeric not null default 0;
