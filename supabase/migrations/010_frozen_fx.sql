-- 010_frozen_fx.sql — freeze the CZK rate on every historical money row
-- Idempotent: safe to re-run. Adds columns only; nothing is dropped or rewritten.
--
-- Until now cost basis, dividends and interest were converted to CZK at
-- *today's* rate, so a US position bought at 23.50 CZK/USD and still at the
-- same dollar price showed zero P&L after the koruna strengthened, and every
-- past dividend was re-priced each morning. The rate on the day money moved is
-- stored with the row from now on; rows without one fall back to today's rate
-- and the UI labels them.

-- CZK per 1 unit of the lot's currency (major unit: GBP, not GBp) on the purchase date.
alter table holding_lots          add column if not exists fx_rate_czk numeric;
-- Cost-weighted average of the lots' rates, i.e. CZK per unit of `currency`
-- at which the position's cost was actually paid.
alter table holdings              add column if not exists avg_fx_czk numeric;
-- CZK per USD at purchase (crypto cost is kept in USD).
alter table crypto_holdings       add column if not exists avg_fx_czk numeric;
-- CZK per unit of the payment's currency on the payment date.
alter table dividends_received    add column if not exists fx_rate_czk numeric;
alter table bank_interest_received add column if not exists fx_rate_czk numeric;

-- A term deposit defaulted to 'instant' liquidity, which hid its maturity from
-- the runway calculation. New rows get no default; the app derives the tier
-- from the account type and maturity date instead.
alter table bank_accounts alter column liquidity_tier drop default;

-- Snapshots record how many positions were valued at cost, so partial days can
-- be spotted (and are no longer written at all by the app — see README).
alter table portfolio_snapshots add column if not exists unpriced_count integer default 0;

-- add_holding_lot now also freezes the lot's FX rate and blends it into the
-- position's average rate. The old 6-argument version is replaced so PostgREST
-- has exactly one candidate to call.
drop function if exists add_holding_lot(uuid, uuid, numeric, numeric, date, text);

create or replace function add_holding_lot(
  p_holding_id    uuid,
  p_profile_id    uuid,
  p_shares        numeric,
  p_price         numeric,
  p_purchase_date date default null,
  p_notes         text default null,
  p_fx_rate_czk   numeric default null
)
returns holdings
language plpgsql
as $$
declare
  v_holding holdings;
  v_old_cost numeric;
  v_new_cost numeric;
begin
  if p_shares is null or p_shares <= 0 then
    raise exception 'shares must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;
  if p_fx_rate_czk is not null and p_fx_rate_czk <= 0 then
    raise exception 'fx rate must be positive';
  end if;

  select * into v_holding
  from holdings
  where id = p_holding_id and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'holding % not found for this profile', p_holding_id;
  end if;

  v_old_cost := v_holding.shares * v_holding.avg_price;
  v_new_cost := p_shares * p_price;

  update holdings
  set shares = v_holding.shares + p_shares,
      avg_price = (v_old_cost + v_new_cost) / (v_holding.shares + p_shares),
      -- The blended rate is only knowable when both sides have one; an unknown
      -- old rate stays unknown rather than being overwritten by the new lot's.
      avg_fx_czk = case
        when p_fx_rate_czk is null then v_holding.avg_fx_czk
        when v_holding.shares <= 0 then p_fx_rate_czk
        when v_holding.avg_fx_czk is null then null
        else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * p_fx_rate_czk) / (v_old_cost + v_new_cost)
      end,
      updated_at = now()
  where id = p_holding_id and profile_id = p_profile_id
  returning * into v_holding;

  insert into holding_lots (holding_id, symbol, shares, purchase_price, purchase_date, notes, profile_id, fx_rate_czk)
  values (p_holding_id, v_holding.symbol, p_shares, p_price, p_purchase_date, p_notes, p_profile_id, p_fx_rate_czk);

  return v_holding;
end;
$$;

-- GBP exposure is tracked separately so FX attribution can split it (it was
-- lumped into "other", whose currency effect is invisible).
alter table portfolio_snapshots add column if not exists exposure_gbp_local numeric default 0;
