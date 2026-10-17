'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const CashpawsCurrencyEngine = require('./server/CashpawsCurrencyEngine');

const USERNAME = 'test_user_ambion';
const ADS_TO_SIMULATE = 10;
const COINS_PER_AD = 25;
const GROSS_REVENUE_PER_AD_USD = 0.02;
const USD_TO_PHP = 100;
const TEST_REPORT_ID = 'cashpaws-simulate-earning-test-user-ambion';
const engine = new CashpawsCurrencyEngine();

function printBlock(title, payload) {
  console.log(`\n========== ${title} ==========`);
  for (const [key, value] of Object.entries(payload)) {
    const formatted = typeof value === 'object' && value !== null
      ? JSON.stringify(value, null, 2)
      : String(value);
    console.log(`${key}: ${formatted}`);
  }
  console.log('========================================');
}

function verifyAudit(summary) {
  const expected = {
    grossUsd: '0.2000',
    platformUsd: '0.1800',
    userUsd: '0.0200',
    platformPhp: '18.00',
    userPhp: '2.00'
  };
  const actual = {
    grossUsd: summary.grossNetworkRevenue.usd,
    platformUsd: summary.platformProtectedCut90Percent.usd,
    userUsd: summary.userWalletAllocation10Percent.usd,
    platformPhp: summary.platformProtectedCut90Percent.php,
    userPhp: summary.userWalletAllocation10Percent.php
  };
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`Revenue audit mismatch for ${key}: expected ${value}, received ${actual[key]}`);
    }
  }
  return actual;
}

function runMock() {
  console.log('MODE: MOCK ONLY. No Supabase records were read or written.');
  const summary = engine.calculateTransactionSummary(ADS_TO_SIMULATE * COINS_PER_AD, ADS_TO_SIMULATE);
  const audit = verifyAudit(summary);
  const responses = [
    ['PROFILE CREATION', { created: true, user_id: 'mock-user-ambion', username: USERNAME }],
    ['REWARDED ADS', { date_utc: new Date().toISOString().slice(0, 10), rewarded_ads_watched: ADS_TO_SIMULATE, max_daily_ads: 10 }],
    ['WALLET SYNC', { coin_balance: 250, accumulated_usd: '0.0025', accumulated_php: '0.25' }],
    ['90/10 REVENUE AUDIT', { ...audit, verified_impressions: ADS_TO_SIMULATE }]
  ];
  for (const [title, response] of responses) printBlock(title, response);
}

async function runSupabaseTest() {
  if (process.env.SUPABASE_TEST_MODE !== 'true') {
    throw new Error('Refusing cloud writes. Set SUPABASE_TEST_MODE=true in a dedicated test-project .env to opt in.');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. The service-role key is used only by this local test script.');
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: settings, error: settingsError } = await supabase
    .from('reward_economy_settings')
    .select('user_revenue_share, coins_per_usd, php_per_usd, minimum_cashout_php, daily_rewarded_ad_limit, coins_per_rewarded_ad')
    .eq('singleton', true)
    .single();
  if (settingsError) throw settingsError;
  if (Number(settings.user_revenue_share) !== 0.1
      || settings.coins_per_usd !== 100000
      || Number(settings.php_per_usd) !== USD_TO_PHP
      || Number(settings.minimum_cashout_php) !== 570
      || settings.daily_rewarded_ad_limit !== ADS_TO_SIMULATE
      || settings.coins_per_rewarded_ad !== COINS_PER_AD) {
    throw new Error(`Test database economy settings do not match the expected matrix: ${JSON.stringify(settings)}`);
  }
  printBlock('SUPABASE CONNECTION', { connected: true, economy_settings: settings });

  let { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('user_id, auth_user_id, username')
    .eq('username', USERNAME)
    .maybeSingle();
  if (profileError) throw profileError;

  let createdAuthUserId = null;
  if (!profile) {
    const runTag = crypto.randomUUID();
    const { data: authResult, error: authError } = await supabase.auth.admin.createUser({
      email: `test_user_ambion-${runTag}@example.test`,
      password: crypto.randomBytes(32).toString('base64url'),
      email_confirm: true,
      user_metadata: { username: USERNAME }
    });
    if (authError) throw authError;
    createdAuthUserId = authResult.user.id;

    const { data: createdProfile, error: createdProfileError } = await supabase
      .from('user_profiles')
      .select('user_id, auth_user_id, username')
      .eq('auth_user_id', createdAuthUserId)
      .single();
    if (createdProfileError) {
      throw new Error(`Auth user created, but its profile trigger did not create a profile: ${createdProfileError.message}`);
    }
    profile = createdProfile;
  }
  if (profile.username !== USERNAME) throw new Error(`Unexpected test profile username: ${profile.username}`);
  printBlock('PROFILE RECORD', { response: profile, created_auth_user: Boolean(createdAuthUserId) });

  const utcDate = new Date().toISOString().slice(0, 10);
  const [{ data: dailyAds, error: adsReadError }, { data: dailyCoins, error: coinsReadError }, { data: wallet, error: walletReadError }] = await Promise.all([
    supabase.from('daily_ad_activity').select('log_id, user_id, ad_date, rewarded_ads_watched, banner_impressions, last_ad_timestamp').eq('user_id', profile.user_id).eq('ad_date', utcDate).maybeSingle(),
    supabase.from('daily_coin_activity').select('activity_id, user_id, earning_day, coins_earned').eq('user_id', profile.user_id).eq('earning_day', utcDate).maybeSingle(),
    supabase.from('wallets').select('wallet_id, user_id, coin_balance, accumulated_php, accumulated_usd').eq('user_id', profile.user_id).single()
  ]);
  if (adsReadError) throw adsReadError;
  if (coinsReadError) throw coinsReadError;
  if (walletReadError) throw walletReadError;

  const testAlreadyComplete = dailyAds?.rewarded_ads_watched === ADS_TO_SIMULATE
    && dailyCoins?.coins_earned === ADS_TO_SIMULATE * COINS_PER_AD
    && wallet.coin_balance === ADS_TO_SIMULATE * COINS_PER_AD;
  const testHasPartialData = Boolean(dailyAds?.rewarded_ads_watched || dailyCoins?.coins_earned || wallet.coin_balance);
  if (!testAlreadyComplete && testHasPartialData) {
    throw new Error('The named test profile contains partial or non-test activity. Refusing to overwrite its wallet or daily records. Reset this dedicated test profile first.');
  }

  const adResponses = [];
  if (!testAlreadyComplete) {
    for (let adNumber = 1; adNumber <= ADS_TO_SIMULATE; adNumber += 1) {
      const { data, error } = await supabase.rpc('record_verified_rewarded_ad', {
        requested_user_id: profile.user_id,
        admob_transaction: `simulate-earning-${profile.user_id}-${utcDate}-${adNumber}`
      });
      if (error) throw new Error(`Rewarded ad ${adNumber}/${ADS_TO_SIMULATE} failed: ${error.message}`);
      adResponses.push(data);
    }
  }
  printBlock('REWARDED AD WRITES', {
    utc_date: utcDate,
    calls: testAlreadyComplete ? 'Already at the target 10/10; no duplicate ad events added.' : adResponses,
    ads_expected: ADS_TO_SIMULATE,
    coins_expected: ADS_TO_SIMULATE * COINS_PER_AD
  });

  const grossUsd = ADS_TO_SIMULATE * GROSS_REVENUE_PER_AD_USD;
  const split = {
    ad_impressions: ADS_TO_SIMULATE,
    settled_net_usd: grossUsd.toFixed(2),
    platform_profit_usd: (grossUsd * 0.9).toFixed(2),
    user_pool_usd: (grossUsd * 0.1).toFixed(2),
    platform_profit_php: (grossUsd * 0.9 * USD_TO_PHP).toFixed(2),
    user_pool_php: (grossUsd * 0.1 * USD_TO_PHP).toFixed(2)
  };
  verifyAudit(engine.calculateTransactionSummary(ADS_TO_SIMULATE * COINS_PER_AD, ADS_TO_SIMULATE));

  const { data: settlement, error: settlementError } = await supabase
    .from('publisher_revenue_settlements')
    .upsert({
      provider_report_id: TEST_REPORT_ID,
      settled_net_usd: split.settled_net_usd,
      settled_at: new Date().toISOString(),
      ad_impressions: split.ad_impressions,
      platform_profit_usd: split.platform_profit_usd,
      user_pool_usd: split.user_pool_usd,
      platform_profit_php: split.platform_profit_php,
      user_pool_php: split.user_pool_php
    }, { onConflict: 'provider_report_id' })
    .select('provider_report_id, ad_impressions, settled_net_usd, platform_profit_usd, user_pool_usd, platform_profit_php, user_pool_php')
    .single();
  if (settlementError) throw new Error(`Revenue settlement write failed. Apply the revenue split migration first: ${settlementError.message}`);
  printBlock('REVENUE SETTLEMENT WRITE', settlement);

  const [{ data: finalAds, error: finalAdsError }, { data: finalCoins, error: finalCoinsError }, { data: finalWallet, error: finalWalletError }] = await Promise.all([
    supabase.from('daily_ad_activity').select('ad_date, rewarded_ads_watched, banner_impressions, last_ad_timestamp').eq('user_id', profile.user_id).eq('ad_date', utcDate).single(),
    supabase.from('daily_coin_activity').select('earning_day, coins_earned, updated_at').eq('user_id', profile.user_id).eq('earning_day', utcDate).single(),
    supabase.from('wallets').select('coin_balance, accumulated_php, accumulated_usd').eq('user_id', profile.user_id).single()
  ]);
  if (finalAdsError) throw finalAdsError;
  if (finalCoinsError) throw finalCoinsError;
  if (finalWalletError) throw finalWalletError;

  const walletExpected = ADS_TO_SIMULATE * COINS_PER_AD;
  if (finalAds.rewarded_ads_watched !== ADS_TO_SIMULATE
      || finalCoins.coins_earned !== walletExpected
      || finalWallet.coin_balance !== walletExpected
      || Number(finalWallet.accumulated_usd).toFixed(4) !== '0.0025'
      || Number(finalWallet.accumulated_php).toFixed(2) !== '0.25') {
    throw new Error(`Live read-back did not match the expected 10-ad/250-coin state: ${JSON.stringify({ finalAds, finalCoins, finalWallet })}`);
  }
  printBlock('LIVE WALLET READ-BACK', { daily_ad_activity: finalAds, daily_coin_activity: finalCoins, wallets: finalWallet });
  printBlock('90/10% MARGIN AUDIT', split);
  console.log('\nSUCCESS: Supabase test records were read back and verified. The test profile and settlement row remain in the test project.');
}

async function main() {
  if (process.env.SUPABASE_TEST_MODE !== 'true') {
    runMock();
    return;
  }
  await runSupabaseTest();
}

main().catch((error) => {
  console.error('\nSIMULATION FAILED:', error.message);
  process.exitCode = 1;
});
