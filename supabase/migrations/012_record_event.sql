-- 012_record_event.sql — one atomic write for every money movement
-- Idempotent: safe to re-run (create or replace).
--
-- Buying shares, logging a dividend or changing a bank balance used to update
-- the asset table only; the transaction ledger — which the benchmark, returns
-- and realized P&L depend on — had to be re-entered by hand in a second form.
-- The two drifted apart. record_event() writes the ledger row AND applies the
-- side-effect (position, lot, dividend row, bank balance) in one statement, so
-- they cannot disagree and a failure leaves nothing half-done.
--
-- Event shape (jsonb), common fields:
--   kind          'buy' | 'sell' | 'dividend' | 'coupon' | 'interest'
--                 | 'deposit' | 'withdrawal' | 'fee'
--   asset_class   'stock' | 'crypto' | 'bond' | 'cash'
--   date          'YYYY-MM-DD'
--   currency      ISO code of the amounts below
--   fx_rate_czk   CZK per 1 unit of currency on `date` (required, > 0)
--   fee, tax      optional, in `currency`
--   notes         optional
--   cash_account_id  optional: settle against this bank account (same currency)
-- Per kind:
--   stock buy/sell:  symbol, name (new positions), quantity, price, exchange
--   crypto buy/sell: coin_id, symbol, name, quantity, price  (currency must be USD)
--   bond buy/sell:   bond_id, quantity, price_pct (clean, % of par), accrued (whole trade)
--   dividend:        symbol, gross, tax, ex_date, amount_per_share, shares_held,
--                    drip_shares, drip_price   (DRIP also adds a lot + a buy row)
--   coupon:          bond_id, gross, tax
--   interest:        account_id, gross, tax
--   deposit/withdrawal/fee: account_id, amount (positive)
--   split (stock):   symbol, quantity = ratio (4 for a 4-for-1 split, 0.1 for 1-for-10)

-- Stock splits are recorded in the ledger so cost basis and the time test
-- follow the shares through them.
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check
  check (type in ('buy','sell','deposit','withdrawal','dividend','interest','rent','fee','tax',
                  'transfer','adjustment','split'));

create or replace function record_event(p_profile_id uuid, p_event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_kind     text    := p_event->>'kind';
  v_class    text    := coalesce(p_event->>'asset_class', 'none');
  v_date     date    := (p_event->>'date')::date;
  v_ccy      text    := upper(coalesce(p_event->>'currency', 'CZK'));
  v_fx       numeric := (p_event->>'fx_rate_czk')::numeric;
  v_fee      numeric := coalesce((p_event->>'fee')::numeric, 0);
  v_tax      numeric := coalesce((p_event->>'tax')::numeric, 0);
  v_notes    text    := nullif(p_event->>'notes', '');
  v_qty      numeric := (p_event->>'quantity')::numeric;
  v_price    numeric := (p_event->>'price')::numeric;
  v_symbol   text    := nullif(upper(trim(coalesce(p_event->>'symbol', ''))), '');
  v_cash_acc uuid    := nullif(p_event->>'cash_account_id', '')::uuid;
  v_asset_id uuid;
  v_amount   numeric;          -- signed ledger amount in v_ccy
  v_cash_delta numeric := 0;   -- change to the settling bank account
  v_external boolean := false;
  v_txn_type text;
  v_holding  holdings;
  v_crypto   crypto_holdings;
  v_bond     bond_holdings;
  v_acc      bank_accounts;
  v_lot_price numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_gross    numeric;
  v_drip_shares numeric;
  v_drip_price  numeric;
  v_txn_id   uuid;
begin
  if p_profile_id is null then raise exception 'profile is required'; end if;
  if v_date is null then raise exception 'date is required'; end if;
  if v_fx is null or v_fx <= 0 then raise exception 'fx_rate_czk must be positive'; end if;
  if v_ccy = 'CZK' and v_fx <> 1 then raise exception 'fx_rate_czk must be 1 for CZK'; end if;
  if v_fee < 0 or v_tax < 0 then raise exception 'fee and tax cannot be negative'; end if;

  -- ── Stocks & ETFs ──────────────────────────────────────────────────────────
  if v_class = 'stock' and v_kind in ('buy', 'sell') then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
      raise exception 'quantity and price must be positive';
    end if;

    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;

    if v_kind = 'buy' then
      if not found then
        insert into holdings (profile_id, symbol, name, shares, avg_price, currency, exchange,
                              purchase_date, is_dividend_payer, avg_fx_czk)
        values (p_profile_id, v_symbol, coalesce(nullif(p_event->>'name', ''), v_symbol), 0, v_price,
                v_ccy, nullif(p_event->>'exchange', ''), v_date,
                coalesce((p_event->>'is_dividend_payer')::boolean, true), v_fx)
        returning * into v_holding;
      elsif upper(v_holding.currency) <> v_ccy then
        raise exception 'this position is booked in %, not %', v_holding.currency, v_ccy;
      end if;

      -- Fees are part of the acquisition cost (Czech convention).
      v_lot_price := v_price + v_fee / v_qty;
      v_old_cost  := v_holding.shares * v_holding.avg_price;
      v_new_cost  := v_qty * v_lot_price;

      update holdings set
        shares     = v_holding.shares + v_qty,
        avg_price  = (v_old_cost + v_new_cost) / (v_holding.shares + v_qty),
        avg_fx_czk = case
          when v_holding.shares <= 0 then v_fx
          when v_holding.avg_fx_czk is null then null
          else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * v_fx) / (v_old_cost + v_new_cost)
        end,
        purchase_date = coalesce(v_holding.purchase_date, v_date),
        updated_at = now()
      where id = v_holding.id
      returning * into v_holding;

      insert into holding_lots (profile_id, holding_id, symbol, shares, purchase_price, purchase_date, notes, fx_rate_czk)
      values (p_profile_id, v_holding.id, v_holding.symbol, v_qty, v_lot_price, v_date, v_notes, v_fx);

      v_amount := -(v_qty * v_price);
      v_cash_delta := v_amount - v_fee;
    else
      if not found then raise exception 'no % position to sell', v_symbol; end if;
      if v_qty > v_holding.shares + 1e-9 then
        raise exception 'cannot sell % — only % held', v_qty, v_holding.shares;
      end if;
      if upper(v_holding.currency) <> v_ccy then
        raise exception 'this position is booked in %, not %', v_holding.currency, v_ccy;
      end if;
      -- Average cost and its FX rate are unchanged by a sale; the position is
      -- kept at zero shares so its lots and history stay attached.
      update holdings set
        shares = greatest(0, v_holding.shares - v_qty),
        updated_at = now()
      where id = v_holding.id;
      v_amount := v_qty * v_price;
      v_cash_delta := v_amount - v_fee - v_tax;
    end if;
    v_asset_id := v_holding.id;
    v_txn_type := v_kind;

  -- ── Stock split: shares × ratio, prices ÷ ratio, value unchanged ──────────
  elsif v_class = 'stock' and v_kind = 'split' then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'split ratio must be positive'; end if;
    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;
    if not found then raise exception 'no % position to split', v_symbol; end if;
    update holdings set shares = shares * v_qty, avg_price = avg_price / v_qty, updated_at = now()
    where id = v_holding.id;
    update holding_lots set shares = shares * v_qty, purchase_price = purchase_price / v_qty
    where holding_id = v_holding.id and profile_id = p_profile_id;
    v_asset_id := v_holding.id;
    v_amount := 0;
    v_ccy := upper(v_holding.currency);
    v_fx := coalesce(v_holding.avg_fx_czk, 1);
    v_txn_type := 'split';

  -- ── Crypto (priced in USD) ─────────────────────────────────────────────────
  elsif v_class = 'crypto' and v_kind in ('buy', 'sell') then
    if v_ccy <> 'USD' then raise exception 'crypto trades are recorded in USD'; end if;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
      raise exception 'quantity and price must be positive';
    end if;
    select * into v_crypto from crypto_holdings
    where profile_id = p_profile_id and coin_id = p_event->>'coin_id'
    order by created_at limit 1
    for update;

    if v_kind = 'buy' then
      if not found then
        insert into crypto_holdings (profile_id, coin_id, symbol, name, amount, avg_cost_usd, purchase_date, avg_fx_czk)
        values (p_profile_id, p_event->>'coin_id', coalesce(v_symbol, upper(p_event->>'coin_id')),
                coalesce(nullif(p_event->>'name', ''), p_event->>'coin_id'), 0, v_price, v_date, v_fx)
        returning * into v_crypto;
      end if;
      v_lot_price := v_price + v_fee / v_qty;
      v_old_cost  := v_crypto.amount * v_crypto.avg_cost_usd;
      v_new_cost  := v_qty * v_lot_price;
      update crypto_holdings set
        amount       = v_crypto.amount + v_qty,
        avg_cost_usd = (v_old_cost + v_new_cost) / (v_crypto.amount + v_qty),
        avg_fx_czk   = case
          when v_crypto.amount <= 0 then v_fx
          when v_crypto.avg_fx_czk is null then null
          else (v_old_cost * v_crypto.avg_fx_czk + v_new_cost * v_fx) / (v_old_cost + v_new_cost)
        end,
        updated_at = now()
      where id = v_crypto.id;
      v_amount := -(v_qty * v_price);
      v_cash_delta := v_amount - v_fee;
    else
      if not found then raise exception 'no % holding to sell', p_event->>'coin_id'; end if;
      if v_qty > v_crypto.amount + 1e-12 then
        raise exception 'cannot sell % — only % held', v_qty, v_crypto.amount;
      end if;
      update crypto_holdings set amount = greatest(0, v_crypto.amount - v_qty), updated_at = now()
      where id = v_crypto.id;
      v_amount := v_qty * v_price;
      v_cash_delta := v_amount - v_fee - v_tax;
    end if;
    v_asset_id := v_crypto.id;
    v_symbol   := v_crypto.coin_id;
    v_txn_type := v_kind;

  -- ── Bonds ──────────────────────────────────────────────────────────────────
  elsif v_class = 'bond' and v_kind in ('buy', 'sell', 'coupon') then
    select * into v_bond from bond_holdings
    where id = (p_event->>'bond_id')::uuid and profile_id = p_profile_id
    for update;
    if not found then raise exception 'bond not found for this profile'; end if;
    if upper(v_bond.currency) <> v_ccy then
      raise exception 'this bond is denominated in %, not %', v_bond.currency, v_ccy;
    end if;
    v_symbol := v_bond.isin;
    v_asset_id := v_bond.id;

    if v_kind = 'coupon' then
      v_gross := (p_event->>'gross')::numeric;
      if v_gross is null or v_gross <= 0 then raise exception 'gross coupon must be positive'; end if;
      v_amount := v_gross;
      v_cash_delta := v_gross - v_tax;
      v_txn_type := 'interest';
      -- A reinvesting savings bond pays its coupon in new bonds.
      if v_bond.coupon_type = 'reinvest' then
        update bond_holdings set quantity = quantity + (v_gross - v_tax) / face_value, updated_at = now()
        where id = v_bond.id;
        v_cash_delta := 0;
      end if;
    else
      v_price := (p_event->>'price_pct')::numeric;
      if v_qty is null or v_qty <= 0 or v_price is null or v_price <= 0 then
        raise exception 'quantity and price must be positive';
      end if;
      -- Clean price × par, plus accrued interest (AÚV) paid or received.
      v_amount := v_qty * v_bond.face_value * v_price / 100
                  + coalesce((p_event->>'accrued')::numeric, 0);
      if v_kind = 'buy' then
        update bond_holdings set
          purchase_clean_price_pct = case when v_bond.quantity <= 0 or v_bond.purchase_clean_price_pct is null
            then v_price
            else (v_bond.quantity * v_bond.purchase_clean_price_pct + v_qty * v_price) / (v_bond.quantity + v_qty) end,
          purchase_fx_czk = case when v_bond.quantity <= 0 then v_fx
            when v_bond.purchase_fx_czk is null then null
            else (v_bond.quantity * v_bond.purchase_fx_czk + v_qty * v_fx) / (v_bond.quantity + v_qty) end,
          quantity = v_bond.quantity + v_qty,
          purchase_date = coalesce(v_bond.purchase_date, v_date),
          updated_at = now()
        where id = v_bond.id;
        v_amount := -v_amount;
        v_cash_delta := v_amount - v_fee;
      else
        if v_qty > v_bond.quantity + 1e-9 then
          raise exception 'cannot sell % — only % held', v_qty, v_bond.quantity;
        end if;
        update bond_holdings set quantity = greatest(0, v_bond.quantity - v_qty), updated_at = now()
        where id = v_bond.id;
        v_cash_delta := v_amount - v_fee - v_tax;
      end if;
      v_txn_type := v_kind;
    end if;

  -- ── Dividends (optionally reinvested) ──────────────────────────────────────
  elsif v_kind = 'dividend' then
    if v_symbol is null then raise exception 'symbol is required'; end if;
    v_gross := (p_event->>'gross')::numeric;
    if v_gross is null or v_gross <= 0 then raise exception 'gross dividend must be positive'; end if;

    select * into v_holding from holdings
    where profile_id = p_profile_id and upper(symbol) = v_symbol
    for update;

    insert into dividends_received (profile_id, symbol, payment_date, ex_date, amount_per_share,
      shares_held, gross_amount, withholding_tax, currency, drip_shares_added, drip_price, notes, fx_rate_czk)
    values (p_profile_id, v_symbol, v_date, nullif(p_event->>'ex_date', '')::date,
      coalesce((p_event->>'amount_per_share')::numeric, 0),
      coalesce((p_event->>'shares_held')::numeric, v_holding.shares, 0),
      v_gross, v_tax, v_ccy,
      nullif((p_event->>'drip_shares')::numeric, 0), (p_event->>'drip_price')::numeric, v_notes, v_fx);

    v_amount := v_gross;
    v_cash_delta := v_gross - v_tax;
    v_txn_type := 'dividend';
    v_class := 'stock';
    v_asset_id := v_holding.id;

    v_drip_shares := (p_event->>'drip_shares')::numeric;
    v_drip_price  := (p_event->>'drip_price')::numeric;
    if v_drip_shares is not null and v_drip_shares > 0 then
      if v_holding.id is null then raise exception 'no % position to reinvest into', v_symbol; end if;
      if v_drip_price is null or v_drip_price <= 0 then raise exception 'drip_price must be positive'; end if;
      -- drip_price is in the holding's currency; the lot carries its own rate.
      v_old_cost := v_holding.shares * v_holding.avg_price;
      v_new_cost := v_drip_shares * v_drip_price;
      update holdings set
        shares = v_holding.shares + v_drip_shares,
        avg_price = (v_old_cost + v_new_cost) / (v_holding.shares + v_drip_shares),
        avg_fx_czk = case
          when v_holding.avg_fx_czk is null or (p_event->>'drip_fx_rate_czk') is null then v_holding.avg_fx_czk
          else (v_old_cost * v_holding.avg_fx_czk + v_new_cost * (p_event->>'drip_fx_rate_czk')::numeric)
               / (v_old_cost + v_new_cost)
        end,
        updated_at = now()
      where id = v_holding.id;
      insert into holding_lots (profile_id, holding_id, symbol, shares, purchase_price, purchase_date, notes, fx_rate_czk)
      values (p_profile_id, v_holding.id, v_holding.symbol, v_drip_shares, v_drip_price, v_date, 'DRIP',
              (p_event->>'drip_fx_rate_czk')::numeric);
      -- The reinvestment is a purchase in its own right: it gets its own
      -- ledger row so realized P&L and the time test know when these shares
      -- were acquired.
      insert into transactions (profile_id, txn_date, type, asset_class, symbol, asset_id, quantity, price,
        amount, fee, tax, currency, fx_rate_czk, is_external, notes)
      values (p_profile_id, v_date, 'buy', 'stock', v_holding.symbol, v_holding.id, v_drip_shares, v_drip_price,
        -(v_drip_shares * v_drip_price), 0, 0, upper(v_holding.currency),
        coalesce((p_event->>'drip_fx_rate_czk')::numeric, case when upper(v_holding.currency) = v_ccy then v_fx else null end, 1),
        false, 'DRIP reinvestment');
      v_cash_delta := 0;  -- reinvested, not paid out
    end if;

  -- ── Cash: interest, deposits, withdrawals, fees ────────────────────────────
  elsif v_kind in ('interest', 'deposit', 'withdrawal', 'fee') then
    select * into v_acc from bank_accounts
    where id = (p_event->>'account_id')::uuid and profile_id = p_profile_id
    for update;
    if not found then raise exception 'account not found for this profile'; end if;
    if upper(v_acc.currency) <> v_ccy then
      raise exception 'this account is in %, not %', v_acc.currency, v_ccy;
    end if;
    v_class := 'cash';
    v_asset_id := v_acc.id;

    if v_kind = 'interest' then
      v_gross := (p_event->>'gross')::numeric;
      if v_gross is null or v_gross <= 0 then raise exception 'gross interest must be positive'; end if;
      insert into bank_interest_received (profile_id, account_id, payment_date, gross_amount, tax_withheld, currency, notes, fx_rate_czk)
      values (p_profile_id, v_acc.id, v_date, v_gross, v_tax, v_ccy, v_notes, v_fx);
      v_amount := v_gross;
      v_txn_type := 'interest';
      update bank_accounts set balance = balance + v_gross - v_tax, updated_at = now() where id = v_acc.id;
    else
      v_amount := (p_event->>'amount')::numeric;
      if v_amount is null or v_amount <= 0 then raise exception 'amount must be positive'; end if;
      if v_kind = 'deposit' then
        v_external := true;
      else
        v_amount := -v_amount;
        v_external := v_kind = 'withdrawal';
      end if;
      v_txn_type := v_kind;
      update bank_accounts set balance = balance + v_amount, updated_at = now() where id = v_acc.id;
    end if;
    v_cash_acc := null;  -- already applied to the account itself

  else
    raise exception 'unsupported event: % %', v_class, v_kind;
  end if;

  -- ── Optional settlement against a bank account ─────────────────────────────
  if v_cash_acc is not null and v_cash_delta <> 0 then
    select * into v_acc from bank_accounts
    where id = v_cash_acc and profile_id = p_profile_id
    for update;
    if not found then raise exception 'settlement account not found for this profile'; end if;
    if upper(v_acc.currency) <> v_ccy then
      raise exception 'settlement account is in %, trade is in %', v_acc.currency, v_ccy;
    end if;
    update bank_accounts set balance = balance + v_cash_delta, updated_at = now() where id = v_acc.id;
  end if;

  insert into transactions (profile_id, txn_date, type, asset_class, symbol, asset_id, quantity, price,
    amount, fee, tax, currency, fx_rate_czk, is_external, counterparty_account_id, notes)
  values (p_profile_id, v_date, v_txn_type, v_class, v_symbol, v_asset_id,
    case when v_kind in ('buy', 'sell', 'split') then v_qty end,
    case when v_kind in ('buy', 'sell') then v_price end,
    v_amount, v_fee, v_tax, v_ccy, v_fx, v_external, v_cash_acc, v_notes)
  returning id into v_txn_id;

  return jsonb_build_object('transaction_id', v_txn_id, 'asset_id', v_asset_id);
end;
$$;
