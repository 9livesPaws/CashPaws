# CashPaws

Mobile-first rewards PWA prototype with Home, Walk, Receipt, and Redeem tabs.

## Run locally

Serve `public/` with any static HTTP server. For example:

```sh
python3 -m http.server 4173 --directory public
```

Open `http://localhost:4173`. The app stores its demo balance, streak, spins, receipts, and withdrawal requests in browser local storage. Use **Reset demo data** on Home to reset it.

## Rewards

- Coin display anchors are 1,000 coins per ₱1 PHP and 100,000 coins per $1 USD.
- Cashpaws retains 90% of eligible finalized publisher revenue; 10% is allocated to users. The $10 USD and ₱570 PHP payout floors are separate configured channel thresholds, not exchange-rate equivalents under those coin anchors.
- Users may earn at most 250 coins in a UTC day and watch at most 10 rewarded ads in that period. Ad rewards are 25 coins each; a shared daily ledger prevents parallel requests from exceeding the coin ceiling.
- The streak, wheel, and walk remain demo experiences. Their local preview rewards are capped together at 250 coins/day; they do not create revenue backing or authorize a payout.
- Walk tracking is simulated. Receipt selection only records a file name locally and does not upload or award coins.
- The currency engine calculates payout eligibility only from separately supplied, server-verified ad impressions; it does not infer ad views from total wallet coins. Run its tests with `node --test server/test/CashpawsCurrencyEngine.test.js`.
- Withdrawal requests are not connected to a payment processor. AdMob is not connected in the web preview; it exposes `window.CashPawsAds.showRewardedVideo()` as an integration hook.

The $0.02 per-ad figure is a planning baseline, not a guaranteed eCPM. Actual settlements, fraud review, and payment processing must be connected before production cashouts.

## Supabase

`supabase/migrations/20261017000000_rewards_economy.sql` defines profiles, wallets, daily ad/coin activity, withdrawals, row-level security, verified-ad recording, and revenue-backed payouts. It expects Supabase Auth and creates each profile from the auth-user trigger. The static PWA is not yet connected to a Supabase project; production use needs authenticated RPC calls, signed AdMob SSV verification, and server-side receipt review. Do not put a Supabase service-role key in browser code.

### Earning pipeline test

Run `node simulate_earning.js` for a mock-only transaction report. To write to Supabase, configure `.env` from `.env.example` with a dedicated test project URL and service-role key, set `SUPABASE_TEST_MODE=true`, apply all migrations, then run the same command. The cloud test creates or reuses `test_user_ambion`, simulates verified reward RPC calls, and upserts a clearly named test settlement. It intentionally refuses to overwrite partial daily test data. Never point this test at production.

## Deploy

`.github/workflows/deploy.yml` publishes `public/` to GitHub Pages on pushes to `main`. Set the repository's Pages source to **GitHub Actions**.

## Android wrapper

The `android/` project wraps `public/` in a WebView and adds a native adaptive banner. It uses Google's AdMob **test** app and ad-unit IDs; replace them only with registered production IDs before a Play Store release. Rewarded coin grants must be issued by the backend after AdMob server-side verification, never from the Android reward callback alone.

Build with Android Studio or `gradle -p android assembleDebug` after installing the Android SDK and configuring `ANDROID_HOME` or `ANDROID_SDK_ROOT`. This workspace currently has Java/Gradle but no Android SDK, so an APK cannot be built here.