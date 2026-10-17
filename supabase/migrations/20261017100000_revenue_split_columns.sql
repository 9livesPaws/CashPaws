alter table public.publisher_revenue_settlements
  add column if not exists ad_impressions integer not null default 0 check (ad_impressions >= 0),
  add column if not exists platform_profit_usd numeric(16, 8) not null default 0 check (platform_profit_usd >= 0),
  add column if not exists user_pool_usd numeric(16, 8) not null default 0 check (user_pool_usd >= 0),
  add column if not exists platform_profit_php numeric(16, 6) not null default 0 check (platform_profit_php >= 0),
  add column if not exists user_pool_php numeric(16, 6) not null default 0 check (user_pool_php >= 0);
update public.publisher_revenue_settlements as settlement
set user_pool_usd = round(settlement.settled_net_usd * settings.user_revenue_share, 8),
    platform_profit_usd = round(settlement.settled_net_usd * (1 - settings.user_revenue_share), 8),
    user_pool_php = round(settlement.settled_net_usd * settings.user_revenue_share * settings.php_per_usd, 6),
    platform_profit_php = round(settlement.settled_net_usd * (1 - settings.user_revenue_share) * settings.php_per_usd, 6)
from public.reward_economy_settings as settings
where settings.singleton = true;
alter table public.publisher_revenue_settlements
  add constraint publisher_settlement_split_matches_net
  check (round(platform_profit_usd + user_pool_usd, 8) = settled_net_usd);