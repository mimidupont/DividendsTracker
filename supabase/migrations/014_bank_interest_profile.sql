-- 014_bank_interest_profile.sql
-- Older installs created bank_interest_received before profiles existed, so the
-- table has no profile_id. The app (and record_event) scope every row by
-- profile, so add it and fill it from the row's bank account. Idempotent.

alter table bank_interest_received
  add column if not exists profile_id uuid references profiles(id) on delete cascade;

update bank_interest_received i
   set profile_id = b.profile_id
  from bank_accounts b
 where i.profile_id is null and i.account_id = b.id;

-- Only enforce NOT NULL once every row has a profile (rows with no account can't be placed).
do $$
begin
  if not exists (select 1 from bank_interest_received where profile_id is null) then
    alter table bank_interest_received alter column profile_id set not null;
  else
    raise notice 'bank_interest_received has rows with no account/profile - profile_id left nullable; fix those rows and re-run.';
  end if;
end $$;

create index if not exists bank_interest_profile_idx on bank_interest_received (profile_id);

notify pgrst, 'reload schema';
