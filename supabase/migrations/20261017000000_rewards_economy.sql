create extension if not exists pgcrypto;

create table public.reward_economy_settings (
  singleton boolean primary key default true check (singleton),
  user_revenue_share numeric(5, 4) not null default 0.1000 check (user_revenue_share between 0 and 1),
  coins_per_usd integer not null default 12500 check (coins_per_usd > 0),
  php_per_usd numeric(12, 6) not null default 57.500000 check (php_per_usd > 0),
  daily_rewarded_ad_limit integer not null default 10 check (daily_rewarded_ad_limit between 1 and 10),
  coins_per_rewarded_ad integer not null default 25 check (coins_per_rewarded_ad > 0),
  minimum_cashout_usd numeric(10, 2) not null default 10.00 check (minimum_cashout_usd > 0),
  minimum_cashout_php numeric(10, 2) not null default 575.00 check (minimum_cashout_php > 0),
  updated_at timestamptz not null default now()
);

insert into public.reward_economy_settings (singleton) values (true);

create table public.user_profiles (
  user_id serial primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username varchar(50) not null unique check (char_length(trim(username)) between 1 and 50),
  active_buddy_name varchar(50) not null default 'Mochi',
  active_buddy_type varchar(10) not null default 'hybrid'
    check (active_buddy_type in ('cat', 'dog', 'hybrid')),
  created_at timestamptz not null default current_timestamp
);

create table public.wallets (
  wallet_id serial primary key,
  user_id integer not null unique references public.user_profiles(user_id) on delete cascade,
  coin_balance integer not null default 0 check (coin_balance >= 0),
  accumulated_php numeric(12, 2) not null default 0 check (accumulated_php >= 0),
  accumulated_usd numeric(12, 4) not null default 0 check (accumulated_usd >= 0),
  last_payout_date timestamptz
);

create table public.daily_ad_activity (
  log_id serial primary key,
  user_id integer not null references public.user_profiles(user_id) on delete cascade,
  ad_date date not null default (now() at time zone 'UTC')::date,
  rewarded_ads_watched integer not null default 0 check (rewarded_ads_watched between 0 and 10),
  banner_impressions integer not null default 0 check (banner_impressions >= 0),
  last_ad_timestamp timestamptz not null default current_timestamp,
  constraint unique_user_ad_date unique (user_id, ad_date)
);

create table public.daily_coin_activity (
  activity_id bigserial primary key,
  user_id integer not null references public.user_profiles(user_id) on delete cascade,
  earning_day date not null default (now() at time zone 'UTC')::date,
  coins_earned integer not null default 0 check (coins_earned between 0 and 250),
  updated_at timestamptz not null default now(),
  constraint unique_user_coin_day unique (user_id, earning_day)
);

create table public.user_gamification (
  game_id serial primary key,
  user_id integer not null unique references public.user_profiles(user_id) on delete cascade,
  current_streak_days integer not null default 1 check (current_streak_days between 1 and 7),
  steps_walked_today integer not null default 0 check (steps_walked_today >= 0),
  daily_wheel_spins_used integer not null default 0 check (daily_wheel_spins_used between 0 and 5),
  last_activity_date date not null default (now() at time zone 'UTC')::date
);

create table public.rewarded_ad_events (
  event_id bigserial primary key,
  admob_transaction_id text not null unique check (char_length(admob_transaction_id) between 1 and 200),
  user_id integer not null references public.user_profiles(user_id) on delete cascade,
  ad_date date not null default (now() at time zone 'UTC')::date,
  coins_awarded integer not null check (coins_awarded > 0),
  verified_at timestamptz not null default now()
);

create index rewarded_ad_events_user_day_idx
  on public.rewarded_ad_events (user_id, ad_date desc);

create table public.publisher_revenue_settlements (
  settlement_id bigserial primary key,
  provider_report_id text not null unique,
  settled_net_usd numeric(16, 8) not null check (settled_net_usd >= 0),
  settled_at timestamptz not null,
  imported_at timestamptz not null default now()
);

create table public.withdrawals (
  withdrawal_id bigserial primary key,
  user_id integer not null references public.user_profiles(user_id) on delete cascade,
  payout_platform text not null check (payout_platform in ('GCash', 'Maya', 'PayPal')),
  target_account text not null check (char_length(trim(target_account)) between 3 and 120),
  amount_value numeric(12, 2) not null check (amount_value > 0),
  currency_code text not null check (currency_code in ('PHP', 'USD')),
  coin_cost integer not null check (coin_cost > 0),
  php_per_usd numeric(12, 6),
  payout_status text not null default 'pending'
    check (payout_status in ('pending', 'processing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint withdrawal_currency_matches_platform check (
    (payout_platform in ('GCash', 'Maya') and currency_code = 'PHP' and php_per_usd > 0)
    or (payout_platform = 'PayPal' and currency_code = 'USD' and php_per_usd is null)
  )
);

create index wallets_leaderboard_coins_idx on public.wallets (coin_balance desc, user_id);
create index withdrawals_user_requested_idx on public.withdrawals (user_id, requested_at desc);
create index withdrawals_status_idx on public.withdrawals (payout_status) where payout_status in ('pending', 'processing');

alter table public.reward_economy_settings enable row level security;
alter table public.user_profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.daily_ad_activity enable row level security;
alter table public.daily_coin_activity enable row level security;
alter table public.user_gamification enable row level security;
alter table public.rewarded_ad_events enable row level security;
alter table public.publisher_revenue_settlements enable row level security;
alter table public.withdrawals enable row level security;

create policy "Users can view their own profile"
  on public.user_profiles for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy "Users can update their own buddy"
  on public.user_profiles for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

create policy "Users can view their own wallet"
  on public.wallets for select to authenticated
  using (user_id = (select profile.user_id from public.user_profiles as profile where profile.auth_user_id = (select auth.uid())));

create policy "Users can view their own ad activity"
  on public.daily_ad_activity for select to authenticated
  using (user_id = (select profile.user_id from public.user_profiles as profile where profile.auth_user_id = (select auth.uid())));

create policy "Users can view their own daily coin activity"
  on public.daily_coin_activity for select to authenticated
  using (user_id = (select profile.user_id from public.user_profiles as profile where profile.auth_user_id = (select auth.uid())));

create policy "Users can view their own gamification status"
  on public.user_gamification for select to authenticated
  using (user_id = (select profile.user_id from public.user_profiles as profile where profile.auth_user_id = (select auth.uid())));

create policy "Users can view their own withdrawals"
  on public.withdrawals for select to authenticated
  using (user_id = (select profile.user_id from public.user_profiles as profile where profile.auth_user_id = (select auth.uid())));

revoke all on public.reward_economy_settings, public.rewarded_ad_events, public.publisher_revenue_settlements from anon, authenticated;
revoke insert, update, delete on public.user_profiles, public.wallets, public.daily_ad_activity, public.daily_coin_activity, public.user_gamification, public.withdrawals from anon, authenticated;
grant select on public.user_profiles, public.wallets, public.daily_ad_activity, public.daily_coin_activity, public.user_gamification, public.withdrawals to authenticated;
grant select on public.reward_economy_settings to service_role;
grant all on public.reward_economy_settings, public.rewarded_ad_events, public.publisher_revenue_settlements to service_role;
grant all on public.user_profiles, public.wallets, public.daily_ad_activity, public.daily_coin_activity, public.user_gamification, public.withdrawals to service_role;

create or replace function public.create_cashpaws_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
 as $$
declare
  new_user_id integer;
  requested_username text;
begin
  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-zA-Z0-9_-]', '', 'g'));
  requested_username := left(requested_username, 50);
  if requested_username = '' then
    requested_username := 'user_' || left(replace(new.id::text, '-', ''), 12);
  end if;

  begin
    insert into public.user_profiles (auth_user_id, username)
    values (new.id, requested_username)
    returning user_id into new_user_id;
  exception when unique_violation then
    insert into public.user_profiles (auth_user_id, username)
    values (new.id, 'user_' || left(replace(new.id::text, '-', ''), 12))
    returning user_id into new_user_id;
  end;

  insert into public.wallets (user_id) values (new_user_id);
  insert into public.user_gamification (user_id) values (new_user_id);
  return new;
end;
$$;

create trigger on_auth_user_created_cashpaws
  after insert on auth.users
  for each row execute procedure public.create_cashpaws_profile();

create or replace function public.record_verified_rewarded_ad(
  requested_user_id integer,
  admob_transaction text
)
returns table (success boolean, duplicate boolean, coins_awarded integer, coin_balance integer, ads_today integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  economy public.reward_economy_settings;
  wallet_row public.wallets;
  activity_row public.daily_ad_activity;
  coin_activity_row public.daily_coin_activity;
  inserted_event_id bigint;
  utc_today date := (now() at time zone 'UTC')::date;
begin
  if admob_transaction is null or char_length(admob_transaction) not between 1 and 200 then
    raise exception 'Invalid AdMob transaction id';
  end if;

  select * into economy from public.reward_economy_settings where singleton = true;
  select * into wallet_row from public.wallets where user_id = requested_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;

  insert into public.daily_ad_activity (user_id, ad_date)
    values (requested_user_id, utc_today)
    on conflict (user_id, ad_date) do nothing;
  select * into activity_row from public.daily_ad_activity
    where user_id = requested_user_id and ad_date = utc_today for update;

  insert into public.daily_coin_activity (user_id, earning_day)
    values (requested_user_id, utc_today)
    on conflict (user_id, earning_day) do nothing;
  select * into coin_activity_row from public.daily_coin_activity
    where user_id = requested_user_id and earning_day = utc_today for update;

  insert into public.rewarded_ad_events (admob_transaction_id, user_id, ad_date, coins_awarded)
    values (admob_transaction, requested_user_id, utc_today, economy.coins_per_rewarded_ad)
    on conflict (admob_transaction_id) do nothing
    returning event_id into inserted_event_id;

  if inserted_event_id is null then
    return query select true, true, 0, wallet_row.coin_balance, activity_row.rewarded_ads_watched;
    return;
  end if;

  if activity_row.rewarded_ads_watched >= economy.daily_rewarded_ad_limit then
    raise exception 'Daily rewarded-ad limit reached';
  end if;

  if coin_activity_row.coins_earned + economy.coins_per_rewarded_ad > 250 then
    raise exception 'Daily 250 coin earning limit reached';
  end if;

  update public.daily_ad_activity
    set rewarded_ads_watched = rewarded_ads_watched + 1,
        last_ad_timestamp = now()
    where log_id = activity_row.log_id
    returning * into activity_row;

  update public.daily_coin_activity
    set coins_earned = coins_earned + economy.coins_per_rewarded_ad,
        updated_at = now()
    where activity_id = coin_activity_row.activity_id
    returning * into coin_activity_row;

  update public.wallets
    set coin_balance = coin_balance + economy.coins_per_rewarded_ad,
        accumulated_usd = (coin_balance + economy.coins_per_rewarded_ad)::numeric / economy.coins_per_usd,
        accumulated_php = (coin_balance + economy.coins_per_rewarded_ad)::numeric / economy.coins_per_usd * economy.php_per_usd
    where wallet_id = wallet_row.wallet_id
    returning * into wallet_row;

  return query select true, false, economy.coins_per_rewarded_ad, wallet_row.coin_balance, activity_row.rewarded_ads_watched;
end;
$$;

create or replace function public.get_wallet_payout_status()
returns table (
  coin_balance integer,
  accumulated_php numeric,
  accumulated_usd numeric,
  publisher_pool_available_usd numeric,
  php_per_usd numeric,
  progress_percent integer,
  can_withdraw boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id integer;
  wallet_row public.wallets;
  economy public.reward_economy_settings;
  settled_budget numeric;
  reserved_budget numeric;
  available_usd numeric;
  threshold_usd numeric;
begin
  select profile.user_id into current_user_id from public.user_profiles as profile
    where profile.auth_user_id = (select auth.uid());
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into wallet_row from public.wallets where user_id = current_user_id;
  select * into economy from public.reward_economy_settings where singleton = true;

  select coalesce(sum(settled_net_usd), 0) * economy.user_revenue_share
    into settled_budget from public.publisher_revenue_settlements;
  select coalesce(sum(coin_cost::numeric / economy.coins_per_usd), 0)
    into reserved_budget from public.withdrawals
    where payout_status in ('pending', 'processing', 'completed');
  available_usd := greatest(settled_budget - reserved_budget, 0);
  threshold_usd := economy.minimum_cashout_usd;

  return query select wallet_row.coin_balance,
    wallet_row.accumulated_php,
    wallet_row.accumulated_usd,
    available_usd,
    economy.php_per_usd,
    least(100, floor(wallet_row.accumulated_usd / threshold_usd * 100)::integer),
    wallet_row.accumulated_usd >= threshold_usd and available_usd >= threshold_usd;
end;
$$;

create or replace function public.request_cashpaws_payout(
  requested_platform text,
  requested_account text,
  requested_amount numeric
)
returns public.withdrawals
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id integer;
  wallet_row public.wallets;
  economy public.reward_economy_settings;
  new_withdrawal public.withdrawals;
  request_currency text;
  request_cost integer;
  request_usd numeric;
  settled_budget numeric;
  reserved_budget numeric;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(7261736870617773);

  select profile.user_id into current_user_id from public.user_profiles as profile
    where profile.auth_user_id = (select auth.uid());
  if current_user_id is null then raise exception 'User profile not found'; end if;

  select * into economy from public.reward_economy_settings where singleton = true;
  select * into wallet_row from public.wallets where user_id = current_user_id for update;
  if not found then raise exception 'Wallet not found'; end if;

  if requested_platform in ('GCash', 'Maya') then
    request_currency := 'PHP';
    if requested_amount < economy.minimum_cashout_php then raise exception 'Minimum PHP payout is %', economy.minimum_cashout_php; end if;
    request_usd := requested_amount / economy.php_per_usd;
    request_cost := ceil(request_usd * economy.coins_per_usd)::integer;
  elsif requested_platform = 'PayPal' then
    request_currency := 'USD';
    if requested_amount < economy.minimum_cashout_usd then raise exception 'Minimum USD payout is %', economy.minimum_cashout_usd; end if;
    request_usd := requested_amount;
    request_cost := ceil(request_usd * economy.coins_per_usd)::integer;
  else
    raise exception 'Unsupported payout platform';
  end if;

  if requested_account is null or char_length(trim(requested_account)) not between 3 and 120 then
    raise exception 'Enter a valid payout account';
  end if;
  if wallet_row.coin_balance < request_cost then raise exception 'Insufficient coin balance'; end if;

  select coalesce(sum(settled_net_usd), 0) * economy.user_revenue_share
    into settled_budget from public.publisher_revenue_settlements;
  select coalesce(sum(coin_cost::numeric / economy.coins_per_usd), 0)
    into reserved_budget from public.withdrawals
    where payout_status in ('pending', 'processing', 'completed');
  if request_usd > greatest(settled_budget - reserved_budget, 0) then
    raise exception 'Insufficient finalized publisher revenue for the 10 percent user allocation';
  end if;

  update public.wallets
    set coin_balance = coin_balance - request_cost,
        accumulated_usd = (coin_balance - request_cost)::numeric / economy.coins_per_usd,
        accumulated_php = (coin_balance - request_cost)::numeric / economy.coins_per_usd * economy.php_per_usd,
        last_payout_date = now()
    where wallet_id = wallet_row.wallet_id;

  insert into public.withdrawals (user_id, payout_platform, target_account, amount_value, currency_code, coin_cost, php_per_usd)
    values (current_user_id, requested_platform, trim(requested_account), requested_amount, request_currency, request_cost,
      case when request_currency = 'PHP' then economy.php_per_usd else null end)
    returning * into new_withdrawal;

  return new_withdrawal;
end;
$$;

revoke all on function public.create_cashpaws_profile() from public, anon, authenticated;
revoke all on function public.record_verified_rewarded_ad(integer, text) from public, anon, authenticated;
revoke all on function public.get_wallet_payout_status() from public, anon;
revoke all on function public.request_cashpaws_payout(text, text, numeric) from public, anon;
grant execute on function public.get_wallet_payout_status() to authenticated;
grant execute on function public.request_cashpaws_payout(text, text, numeric) to authenticated;
grant execute on function public.record_verified_rewarded_ad(integer, text) to service_role;

create or replace view public.cashpaws_leaderboard as
  select profile.username, profile.active_buddy_name, profile.active_buddy_type,
    wallet.coin_balance, game.current_streak_days,
    row_number() over (order by wallet.coin_balance desc, profile.user_id) as rank_position
  from public.user_profiles as profile
  join public.wallets as wallet using (user_id)
  join public.user_gamification as game using (user_id);

grant select on public.cashpaws_leaderboard to authenticated;
