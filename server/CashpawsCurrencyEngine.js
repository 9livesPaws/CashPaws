'use strict';

class CashpawsCurrencyEngine {
  constructor() {
    this.REV_PER_AD_VIEW_USD = 0.020;
    this.USD_TO_PHP_EXCHANGE_RATE = 100;
    this.COINS_PER_PHP = 1000;
    this.COINS_PER_USD = 100000;
    this.PLATFORM_PROFIT_TARGET_PERCENT = 0.90;
    this.USER_YIELD_TARGET_PERCENT = 0.10;
    this.STRICT_DAILY_AD_CEILING = 10;
    this.STRICT_DAILY_COIN_CEILING = 250;
    this.COIN_REWARD_PER_AD = 25;
    this.MINIMUM_CASHOUT_FLOOR_USD = 10.00;
    this.MINIMUM_CASHOUT_FLOOR_PHP = 570.00;
    this.USER_VALUE_PER_COIN_USD = 1 / this.COINS_PER_USD;
    this.MINIMUM_CASHOUT_COINS = Math.ceil(this.MINIMUM_CASHOUT_FLOOR_USD * this.COINS_PER_USD);
  }

  validateDailyClaim({ adsAlreadyWatched, coinsAlreadyEarned, requestedAds = 1, requestedCoins } = {}) {
    const coins = requestedCoins ?? requestedAds * this.COIN_REWARD_PER_AD;
    this.#assertNonNegativeInteger(adsAlreadyWatched, 'adsAlreadyWatched');
    this.#assertNonNegativeInteger(coinsAlreadyEarned, 'coinsAlreadyEarned');
    this.#assertNonNegativeInteger(requestedAds, 'requestedAds');
    this.#assertNonNegativeInteger(coins, 'requestedCoins');

    if (adsAlreadyWatched + requestedAds > this.STRICT_DAILY_AD_CEILING) {
      throw new RangeError('Daily rewarded-ad limit reached.');
    }
    if (coinsAlreadyEarned + coins > this.STRICT_DAILY_COIN_CEILING) {
      throw new RangeError('Daily coin earning limit reached.');
    }

    return {
      accepted: true,
      adsAfterClaim: adsAlreadyWatched + requestedAds,
      coinsAfterClaim: coinsAlreadyEarned + coins,
      remainingAds: this.STRICT_DAILY_AD_CEILING - adsAlreadyWatched - requestedAds,
      remainingCoins: this.STRICT_DAILY_COIN_CEILING - coinsAlreadyEarned - coins
    };
  }

  calculateTransactionSummary(totalCoinsClaimed, validatedAdViews, alreadyPaidUsd = 0) {
    this.#assertNonNegativeInteger(totalCoinsClaimed, 'totalCoinsClaimed');
    this.#assertNonNegativeInteger(validatedAdViews, 'validatedAdViews');
    if (!Number.isFinite(alreadyPaidUsd) || alreadyPaidUsd < 0) {
      throw new RangeError('alreadyPaidUsd must be a non-negative number.');
    }

    const grossRevenueGeneratedUSD = validatedAdViews * this.REV_PER_AD_VIEW_USD;
    const grossRevenueGeneratedPHP = grossRevenueGeneratedUSD * this.USD_TO_PHP_EXCHANGE_RATE;
    const corporateNetProfitUSD = grossRevenueGeneratedUSD * this.PLATFORM_PROFIT_TARGET_PERCENT;
    const corporateNetProfitPHP = grossRevenueGeneratedPHP * this.PLATFORM_PROFIT_TARGET_PERCENT;
    const allocatedUserValueUSD = grossRevenueGeneratedUSD * this.USER_YIELD_TARGET_PERCENT;
    const allocatedUserValuePHP = grossRevenueGeneratedPHP * this.USER_YIELD_TARGET_PERCENT;
    const userRevenueAvailableUSD = Math.max(0, allocatedUserValueUSD - alreadyPaidUsd);
    const userCoinsBackedByVerifiedAds = Math.min(
      totalCoinsClaimed,
      validatedAdViews * this.COIN_REWARD_PER_AD
    );
    const walletValueBackedByAdsUSD = userCoinsBackedByVerifiedAds * this.USER_VALUE_PER_COIN_USD;
    const cashoutEligibleValueUSD = Math.min(userRevenueAvailableUSD, walletValueBackedByAdsUSD);
    const cashoutEligibleValuePHP = cashoutEligibleValueUSD * this.USD_TO_PHP_EXCHANGE_RATE;
    const progressPercentageToMinimumFloor = Math.min(
      cashoutEligibleValueUSD / this.MINIMUM_CASHOUT_FLOOR_USD * 100,
      100
    );

    return {
      systemMetrics: {
        totalCoinsEvaluated: totalCoinsClaimed,
        validatedImpressionsCount: validatedAdViews,
        coinsBackedByVerifiedAds: userCoinsBackedByVerifiedAds,
        unbackedCoins: totalCoinsClaimed - userCoinsBackedByVerifiedAds,
        coinsPerPhp: this.COINS_PER_PHP,
        coinsPerUsd: this.COINS_PER_USD
      },
      grossNetworkRevenue: {
        usd: grossRevenueGeneratedUSD.toFixed(4),
        php: grossRevenueGeneratedPHP.toFixed(2)
      },
      platformProtectedCut90Percent: {
        usd: corporateNetProfitUSD.toFixed(4),
        php: corporateNetProfitPHP.toFixed(2)
      },
      userWalletAllocation10Percent: {
        usd: allocatedUserValueUSD.toFixed(4),
        php: allocatedUserValuePHP.toFixed(2),
        alreadyPaidUsd: alreadyPaidUsd.toFixed(4),
        availableUsd: userRevenueAvailableUSD.toFixed(4)
      },
      cashoutStatus: {
        isMinimumFloorSatisfied: cashoutEligibleValueUSD >= this.MINIMUM_CASHOUT_FLOOR_USD
          && userCoinsBackedByVerifiedAds >= this.MINIMUM_CASHOUT_COINS,
        payoutProgressPercent: `${progressPercentageToMinimumFloor.toFixed(2)}%`,
        eligibleValueUSD: cashoutEligibleValueUSD.toFixed(4),
        eligibleValuePHP: cashoutEligibleValuePHP.toFixed(2),
        minimumRequiredUSD: this.MINIMUM_CASHOUT_FLOOR_USD.toFixed(2),
        minimumRequiredPHP: this.MINIMUM_CASHOUT_FLOOR_PHP.toFixed(2),
        minimumRequiredCoins: this.MINIMUM_CASHOUT_COINS
      }
    };
  }

  #assertNonNegativeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer.`);
    }
  }
}

module.exports = CashpawsCurrencyEngine;
