update public.reward_economy_settings
set user_revenue_share = 0.1000,
    coins_per_usd = 100000,
    php_per_usd = 100.000000,
    minimum_cashout_usd = 10.00,
    minimum_cashout_php = 570.00,
    updated_at = now()
where singleton = true;

update public.wallets
set accumulated_usd = round(coin_balance::numeric / 100000, 4),
    accumulated_php = round(coin_balance::numeric / 1000, 2);

update public.publisher_revenue_settlements as settlement
set user_pool_usd = round(settlement.settled_net_usd * settings.user_revenue_share, 8),
    platform_profit_usd = round(settlement.settled_net_usd * (1 - settings.user_revenue_share), 8),
    user_pool_php = round(settlement.settled_net_usd * settings.user_revenue_share * settings.php_per_usd, 6),
    platform_profit_php = round(settlement.settled_net_usd * (1 - settings.user_revenue_share) * settings.php_per_usd, 6)
from public.reward_economy_settings as settings
where settings.singleton = true;