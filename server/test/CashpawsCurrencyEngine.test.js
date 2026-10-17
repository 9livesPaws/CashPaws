'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CashpawsCurrencyEngine = require('../CashpawsCurrencyEngine');

test('splits verified publisher revenue 90% platform and 10% user', () => {
  const engine = new CashpawsCurrencyEngine();
  const summary = engine.calculateTransactionSummary(250, 10);

  assert.equal(summary.grossNetworkRevenue.usd, '0.2000');
  assert.equal(summary.platformProtectedCut90Percent.usd, '0.1800');
  assert.equal(summary.userWalletAllocation10Percent.usd, '0.0200');
  assert.equal(summary.grossNetworkRevenue.php, '20.00');
  assert.equal(summary.platformProtectedCut90Percent.php, '18.00');
  assert.equal(summary.userWalletAllocation10Percent.php, '2.00');
  assert.equal(summary.systemMetrics.coinsPerPhp, 1000);
  assert.equal(summary.systemMetrics.coinsPerUsd, 100000);
  assert.equal(1000 / summary.systemMetrics.coinsPerUsd, 0.01);
});

test('requires 1,000,000 verified-backed coins and $10 of user allocation for cashout', () => {
  const engine = new CashpawsCurrencyEngine();
  const summary = engine.calculateTransactionSummary(1000000, 40000);

  assert.equal(summary.cashoutStatus.minimumRequiredUSD, '10.00');
  assert.equal(summary.cashoutStatus.minimumRequiredPHP, '570.00');
  assert.equal(summary.cashoutStatus.isMinimumFloorSatisfied, true);
});

test('does not treat unverified wallet coins as cashout backing', () => {
  const engine = new CashpawsCurrencyEngine();
  const summary = engine.calculateTransactionSummary(1000000, 0);

  assert.equal(summary.systemMetrics.unbackedCoins, 1000000);
  assert.equal(summary.cashoutStatus.isMinimumFloorSatisfied, false);
});

test('enforces both daily ad and total coin ceilings', () => {
  const engine = new CashpawsCurrencyEngine();
  assert.equal(engine.validateDailyClaim({ adsAlreadyWatched: 0, coinsAlreadyEarned: 0, requestedAds: 10 }).coinsAfterClaim, 250);
  assert.throws(() => engine.validateDailyClaim({ adsAlreadyWatched: 10, coinsAlreadyEarned: 250 }), /ad limit/i);
  assert.throws(() => engine.validateDailyClaim({ adsAlreadyWatched: 0, coinsAlreadyEarned: 240, requestedAds: 1 }), /coin earning limit/i);
});
