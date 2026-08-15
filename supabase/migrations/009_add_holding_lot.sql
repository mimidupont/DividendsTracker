-- 009_add_holding_lot.sql — atomic "add lot" for the holdings page
-- Idempotent: safe to re-run.
--
-- Adding a lot is two dependent writes: recalculate the position's weighted
-- average, then record the lot. Done as separate requests from the browser, a
-- failure on the second leaves the position already moved with no lot behind
-- it — the shares are there but the history that explains them is not.
--
-- Wrapping both in a function makes them one statement, so either both land or
-- neither does.

create or replace function add_holding_lot(
  p_holding_id   uuid,
  p_profile_id   uuid,
  p_shares       numeric,
  p_price        numeric,
  p_purchase_date date default null,
  p_notes        text default null
)
returns holdings
language plpgsql
as $$
declare
  v_holding holdings;
begin
  if p_shares is null or p_shares <= 0 then
    raise exception 'shares must be positive';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price must be positive';
  end if;

  -- Lock the row so two concurrent adds cannot both read the old average and
  -- write back a figure that ignores the other.
  select * into v_holding
  from holdings
  where id = p_holding_id and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'holding % not found for this profile', p_holding_id;
  end if;

  update holdings
  set shares = v_holding.shares + p_shares,
      avg_price = (v_holding.shares * v_holding.avg_price + p_shares * p_price)
                  / (v_holding.shares + p_shares),
      updated_at = now()
  where id = p_holding_id
  returning * into v_holding;

  insert into holding_lots (holding_id, symbol, shares, purchase_price, purchase_date, notes, profile_id)
  values (p_holding_id, v_holding.symbol, p_shares, p_price, p_purchase_date, p_notes, p_profile_id);

  return v_holding;
end;
$$;
