(() => {
  "use strict";

  const STORAGE_KEY = "cashpaws-rewards-v1";
  const COINS_PER_PHP = 1000;
  const COINS_PER_USD = 100000;
  const PLATFORM_REVENUE_SHARE = 0.9;
  const USER_REVENUE_SHARE = 1 - PLATFORM_REVENUE_SHARE;
  const DAILY_COIN_CEILING = 250;
  const DAILY_SPIN_LIMIT = 5;
  const STREAK_REWARDS = [25, 30, 35, 40, 45, 50, 250];
  const WHEEL_REWARDS = [10, 15, 20, 25, 30, 40];
  const WALK_REWARD = 25;
  const DISPLAY_PHP_PER_USD = 100;
  const PET_CATALOG = [
    { id: "maine-coon", name: "Maine Coon", symbol: "pet-maine-coon", type: "cat", ads: 5, coins: 250 },
    { id: "siamese", name: "Siamese", symbol: "pet-siamese", type: "cat", ads: 1, coins: 250 },
    { id: "tabby", name: "Tabby", symbol: "pet-tabby", type: "cat", ads: 1, coins: 250 },
    { id: "british-shorthair", name: "British Shorthair", symbol: "pet-british", type: "cat", ads: 5, coins: 250 },
    { id: "calico", name: "Calico", symbol: "pet-calico", type: "cat", ads: 5, coins: 250 },
    { id: "bulldog", name: "Bulldog", symbol: "pet-bulldog", type: "dog", ads: 3, coins: 150 },
    { id: "german-shepherd", name: "German Shepherd", symbol: "pet-shepherd", type: "dog", ads: 3, coins: 150 },
    { id: "husky", name: "Husky", symbol: "pet-husky", type: "dog", ads: 3, coins: 150 },
    { id: "poodle", name: "Poodle", symbol: "pet-poodle", type: "dog", ads: 3, coins: 150 },
    { id: "corgi", name: "Corgi", symbol: "pet-corgi", type: "dog", ads: 5, coins: 250 }
  ];
  const AVERAGE_DAILY_COINS = DAILY_COIN_CEILING;
  const REQUIRED_SETTLED_USD_PER_DAY = AVERAGE_DAILY_COINS / COINS_PER_USD / USER_REVENUE_SHARE;
  const payoutOptions = {
    GCash: { currency: "PHP", tiers: [10, 20, 50, 100, 500, 1000] },
    Maya: { currency: "PHP", tiers: [10, 20, 50, 100, 500, 1000] },
    PayPal: { currency: "PHP", tiers: [10, 20, 50, 100, 500, 1000] }
  };
  const formatters = {
    PHP: new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }),
    USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
  };
  const numberFormat = new Intl.NumberFormat("en-US");
  const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const initialState = {
    coins: 12000, streakCount: 3, lastCheckIn: yesterday.toISOString(), lastCheckInDay: localDay(yesterday),
    premiumSpins: 0, usePremiumSpin: false, spinDay: localDay(), spinsToday: 0, walkDay: "", withdrawals: [], receipts: [], unlockedPets: [], petAdsProgress: {},
    coinEarnDay: localDay(), coinsEarnedToday: 0, username: "", avatarDataUrl: ""
  };

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && Number.isInteger(stored.coins) && Array.isArray(stored.withdrawals)) {
        return {
          ...initialState,
          ...stored,
          receipts: Array.isArray(stored.receipts) ? stored.receipts : [],
          unlockedPets: Array.isArray(stored.unlockedPets) ? stored.unlockedPets : [],
          petAdsProgress: stored.petAdsProgress && typeof stored.petAdsProgress === "object" ? stored.petAdsProgress : {},
          username: typeof stored.username === "string" ? stored.username.slice(0, 24) : "",
          avatarDataUrl: typeof stored.avatarDataUrl === "string" && stored.avatarDataUrl.startsWith("data:image/") ? stored.avatarDataUrl : ""
        };
      }
    } catch (error) {
      console.warn("CashPaws could not read saved demo data.", error);
    }
    return { ...initialState, withdrawals: [], receipts: [] };
  }

  let state = loadState();
  const revenueBacking = { coins: 0, phpPerUsd: null, backendReady: false };
  let installPrompt = null;
  let toastTimer = null;
  let wheelRotation = 0;
  const formatMoney = (amount, currency) => formatters[currency].format(amount);
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error("CashPaws could not save demo data.", error);
      showToast("Browser storage is unavailable. This change may not persist.");
      return false;
    }
  }

  function awardDemoCoins(requestedCoins) {
    if (state.coinEarnDay !== localDay()) {
      state.coinEarnDay = localDay();
      state.coinsEarnedToday = 0;
    }
    const remaining = Math.max(0, DAILY_COIN_CEILING - state.coinsEarnedToday);
    const awarded = Math.min(Math.max(0, Math.floor(requestedCoins)), remaining);
    state.coins += awarded;
    state.coinsEarnedToday += awarded;
    return awarded;
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3400);
  }

  function checkInOnOpen() {
    const today = localDay();
    const previousCheckIn = state.lastCheckIn ? new Date(state.lastCheckIn) : null;
    const previousDay = previousCheckIn && !Number.isNaN(previousCheckIn.getTime())
      ? new Date(previousCheckIn.getFullYear(), previousCheckIn.getMonth(), previousCheckIn.getDate())
      : null;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (state.lastCheckInDay === today) return null;
    if (previousDay?.getTime() === todayStart.getTime()) return null;
    const followingDay = previousDay ? new Date(previousDay) : null;
    followingDay?.setDate(followingDay.getDate() + 1);
    const nextCount = followingDay?.getTime() === todayStart.getTime() ? state.streakCount + 1 : 1;
    const rewardDay = ((nextCount - 1) % 7) + 1;
    const requestedCoins = STREAK_REWARDS[rewardDay - 1];
    state.streakCount = nextCount;
    state.lastCheckIn = new Date().toISOString();
    state.lastCheckInDay = today;
    const coinsAwarded = awardDemoCoins(requestedCoins);
    if (rewardDay === 7) state.premiumSpins += 1;
    saveState();
    return { rewardDay, coinsAwarded, earnedPremium: rewardDay === 7 };
  }

  function renderWallet() {
    document.querySelector("#coin-balance").textContent = numberFormat.format(state.coins);
    document.querySelector("#redeem-balance").textContent = numberFormat.format(state.coins);
    document.querySelector("#revenue-backed-balance").textContent = numberFormat.format(revenueBacking.coins);
    document.querySelector("#daily-coin-average").textContent = numberFormat.format(AVERAGE_DAILY_COINS);
    document.querySelector("#daily-revenue-target").textContent = formatMoney(REQUIRED_SETTLED_USD_PER_DAY, "USD");
    document.querySelector("#daily-user-allocation").textContent = formatMoney(REQUIRED_SETTLED_USD_PER_DAY * USER_REVENUE_SHARE, "USD");
  }

  function renderProfile() {
    const username = document.querySelector("#profile-username");
    if (document.activeElement !== username) username.value = state.username;
    const savedAvatar = document.querySelector("#avatar-preview");
    const fallbackAvatar = document.querySelector("#avatar-fallback");
    if (state.avatarDataUrl) {
      savedAvatar.src = state.avatarDataUrl;
      savedAvatar.hidden = false;
      fallbackAvatar.hidden = true;
    } else {
      savedAvatar.hidden = true;
      fallbackAvatar.hidden = false;
    }
  }

  function handleAvatarChange(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 512 * 1024) {
      showToast("Choose an image smaller than 512 KB.");
      event.currentTarget.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      state.avatarDataUrl = reader.result;
      saveState();
      renderProfile();
      showToast("Profile avatar updated.");
    };
    reader.onerror = () => showToast("The selected avatar could not be read.");
    reader.readAsDataURL(file);
    event.currentTarget.value = "";
  }

  function renderStreak() {
    const day = ((state.streakCount - 1) % 7) + 1;
    document.querySelector("#streak-count").textContent = `${state.streakCount} day${state.streakCount === 1 ? "" : "s"}`;
    document.querySelector("#streak-reward").textContent = `${numberFormat.format(STREAK_REWARDS[day - 1])} coins today`;
    document.querySelectorAll("[data-streak-day]").forEach((item) => {
      const itemDay = Number(item.dataset.streakDay);
      item.classList.toggle("is-current", itemDay === day);
      item.classList.toggle("is-complete", itemDay < day);
    });
  }

  function renderWheel() {
    if (state.spinDay !== localDay()) {
      state.spinDay = localDay();
      state.spinsToday = 0;
      saveState();
    }
    const atLimit = state.spinsToday >= DAILY_SPIN_LIMIT;
    const button = document.querySelector("#spin-button");
    button.disabled = atLimit;
    button.textContent = atLimit ? "Daily Spins Used" : "Spin Wheel (Watch Ad to Unlock)";
    document.querySelector("#spin-count").textContent = `${state.spinsToday} / ${DAILY_SPIN_LIMIT} spins used`;
    document.querySelector("#spin-limit-note").hidden = !atLimit;
    const premiumButton = document.querySelector("#premium-toggle");
    premiumButton.disabled = state.premiumSpins < 1;
    premiumButton.setAttribute("aria-pressed", String(state.usePremiumSpin));
    premiumButton.textContent = state.usePremiumSpin ? "Premium spin armed" : `Premium spins: ${state.premiumSpins}`;
  }

  function renderWalk() {
    const complete = state.walkDay === localDay();
    const button = document.querySelector("#walk-button");
    button.disabled = complete;
    button.textContent = complete ? "Today's walk logged" : "Simulate a 1 km walk";
    document.querySelector("#walk-status").textContent = complete
      ? "Nice work. Your daily demo walk is complete."
      : "One simulated walk is available each day.";
  }

  function renderReceipts() {
    document.querySelector("#receipt-list").innerHTML = state.receipts.length
      ? state.receipts.map((receipt) => `<li class="receipt-row"><span class="receipt-file">${escapeHTML(receipt.name)}</span><span class="receipt-status">Pending review</span></li>`).join("")
      : '<li class="muted-copy">No receipts submitted yet.</li>';
  }

  function renderPetCollection(type, containerId) {
    const container = document.getElementById(containerId);
    const companions = PET_CATALOG.filter((pet) => pet.type === type);
    container.innerHTML = companions.map((pet) => {
      const unlocked = state.unlockedPets.includes(pet.id);
      return `<article class="pet-tile">
        <div class="pet-portrait-card"><span class="pet-level" aria-hidden="true">${unlocked ? "✓" : "✦"}</span><svg viewBox="0 0 180 180" role="img" aria-label="${escapeHTML(pet.name)} companion"><use href="pets.svg#${pet.symbol}"/></svg></div>
        <p class="pet-caption">${escapeHTML(pet.name)}</p>
        <button class="pet-unlock" type="button" data-pet-unlock="${pet.id}" ${unlocked ? "disabled" : ""} aria-label="${unlocked ? `${escapeHTML(pet.name)} is already unlocked` : `Watch an ad to unlock ${escapeHTML(pet.name)}`}" aria-pressed="${unlocked}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" stroke-linejoin="round"/></svg><span>+1 Ad</span></button>
      </article>`;
    }).join("");
  }

  function renderPetGallery() {
    renderPetCollection("cat", "cat-pets");
    renderPetCollection("dog", "dog-pets");
  }

  function getSelectedPayout() {
    const platform = document.querySelector("#payout-platform").value;
    const amount = Number(document.querySelector("#payout-tier").value);
    const configuration = payoutOptions[platform];
    if (!configuration || !configuration.tiers.includes(amount)) return null;
    const coinCost = configuration.currency === "USD"
      ? amount * COINS_PER_USD
      : amount * COINS_PER_PHP;
    return { platform, currency: configuration.currency, amount, coinCost };
  }

  function renderPayoutOptions() {
    const platform = document.querySelector("#payout-platform").value;
    const configuration = payoutOptions[platform];
    document.querySelector("#payout-tier").innerHTML = configuration.tiers.map((amount) => {
      const coinCost = configuration.currency === "USD"
        ? amount * COINS_PER_USD
        : amount * COINS_PER_PHP;
      const costLabel = `${numberFormat.format(coinCost)} coins`;
      return `<option value="${amount}">${formatMoney(amount, configuration.currency)} · ${costLabel}</option>`;
    }).join("");
    document.querySelector("#payout-currency-note").textContent = configuration.currency === "PHP"
      ? "1,000 coins = ₱1.00 PHP · 100,000 coins = $1.00 USD"
      : "100,000 coins = $1.00 USD · ₱100.00 PHP equivalent";
    updateWithdrawalButton();
  }

  function updateWithdrawalButton() {
    const selection = getSelectedPayout();
    const account = document.querySelector("#payout-account").value.trim();
    const hasCost = selection !== null && Number.isInteger(selection.coinCost);
    const enoughCoins = hasCost && state.coins >= selection.coinCost;
    const enoughBacking = hasCost && revenueBacking.coins >= selection.coinCost;
    document.querySelector("#confirm-withdrawal").disabled = !selection || !account || !enoughCoins || !enoughBacking || !revenueBacking.backendReady;
    document.querySelector("#tier-cost").textContent = hasCost ? `${numberFormat.format(selection.coinCost)} coins` : "Waiting for a trusted FX rate";
    const balanceMessage = !selection ? "Choose a payout tier."
      : !hasCost ? "PHP cashouts need a trusted server FX rate."
        : !enoughCoins ? `You need ${numberFormat.format(selection.coinCost - state.coins)} more earned coins.`
            : !enoughBacking ? `Need ${numberFormat.format(selection.coinCost)} coins backed by finalized publisher revenue; ${numberFormat.format(revenueBacking.coins)} backed so far.`
              : !revenueBacking.backendReady ? "Cashouts stay disabled until the authenticated revenue service is connected."
                : "Your earned balance and finalized-revenue backing cover this tier.";
    document.querySelector("#balance-check").textContent = balanceMessage;
  }

  function renderWithdrawals() {
    document.querySelector("#withdrawal-list").innerHTML = state.withdrawals.length
      ? [...state.withdrawals].reverse().map((item) => `<li class="withdrawal-row"><div><strong>${escapeHTML(item.platform)} · ${formatMoney(item.amount, item.currency)}</strong><small>${escapeHTML(item.account)} · ${escapeHTML(item.date)}</small></div><span class="receipt-status">${escapeHTML(item.status)}</span></li>`).join("")
      : '<li class="muted-copy">No demo withdrawal requests yet.</li>';
  }

  function renderAll() {
    renderWallet();
    renderProfile();
    renderStreak();
    renderWheel();
    renderWalk();
    renderReceipts();
    renderWithdrawals();
    renderPetGallery();
    updateWithdrawalButton();
  }

  async function watchDailyAd() {
    const ads = window.CashPawsAds;
    const backend = window.CashPawsBackend;
    if (typeof ads?.showRewardedVideo !== "function" || typeof backend?.claimDailyAdReward !== "function") {
      showToast("Rewarded ads are not connected in this preview.");
      return;
    }
    try {
      const result = await ads.showRewardedVideo();
      if (result !== true && result?.rewarded !== true && result?.completed !== true) {
        showToast("Watch the full ad to complete this reward.");
        return;
      }
      const claim = await backend.claimDailyAdReward();
      if (!claim?.verified) throw new Error("The server has not verified this ad yet.");
      showToast("Ad verified. Your wallet has been synchronized.");
      window.dispatchEvent(new Event("cashpaws:refresh-wallet"));
    } catch (error) {
      showToast(error.message || "This ad reward could not be verified.");
    }
  }

  async function unlockPet(button) {
    const pet = PET_CATALOG.find((entry) => entry.id === button.dataset.petUnlock);
    if (!pet || state.unlockedPets.includes(pet.id)) return;
    const ads = window.CashPawsAds;
    const backend = window.CashPawsBackend;
    if (typeof ads?.showRewardedVideo !== "function" || typeof backend?.unlockPetFromVerifiedAd !== "function") {
      showToast("Pet unlocks need a connected rewarded-ad and verification service.");
      return;
    }
    button.disabled = true;
    try {
      const result = await ads.showRewardedVideo();
      if (result !== true && result?.rewarded !== true && result?.completed !== true) {
        showToast("Watch the full ad to make progress toward this companion.");
        return;
      }
      const unlock = await backend.unlockPetFromVerifiedAd({ petId: pet.id, coinCost: pet.coins });
      if (!unlock?.verified || !Number.isInteger(unlock.coinBalance)) {
        throw new Error("The server has not verified this ad and coin balance yet.");
      }
      state.coins = unlock.coinBalance;
      state.petAdsProgress[pet.id] = Number(unlock.adsCompleted) || 0;
      if (unlock.unlocked) state.unlockedPets.push(pet.id);
      saveState();
      renderAll();
      showToast(unlock.unlocked ? `${pet.name} joined your companions.` : `${pet.name} ad progress saved.`);
    } catch (error) {
      showToast(error.message || "This companion could not be unlocked.");
    } finally {
      const currentButton = document.querySelector(`[data-pet-unlock="${pet.id}"]`);
      if (currentButton && !state.unlockedPets.includes(pet.id)) currentButton.disabled = false;
    }
  }

  async function refreshRevenueStatus() {
    const backend = window.CashPawsBackend;
    if (typeof backend?.getRevenueStatus !== "function") return;
    try {
      const result = await backend.getRevenueStatus();
      const backedCoins = Number(result?.availableBackedCoins);
      const phpPerUsd = Number(result?.phpPerUsd);
      revenueBacking.coins = Number.isFinite(backedCoins) ? Math.max(0, Math.floor(backedCoins)) : 0;
      revenueBacking.phpPerUsd = Number.isFinite(phpPerUsd) && phpPerUsd > 0 ? phpPerUsd : null;
      revenueBacking.backendReady = typeof backend.requestWithdrawal === "function";
      renderAll();
    } catch (error) {
      revenueBacking.coins = 0;
      revenueBacking.phpPerUsd = null;
      revenueBacking.backendReady = false;
      console.error("CashPaws could not refresh settled revenue status.", error);
      renderAll();
    }
  }

  async function spinWheel() {
    if (state.spinsToday >= DAILY_SPIN_LIMIT) {
      alert("You have used all 5 spins today. An AdMob Rewarded Video ad must finish playing to reset your spin counter.");
      return;
    }
    const premium = state.usePremiumSpin && state.premiumSpins > 0;
    const ads = window.CashPawsAds;
    const backend = window.CashPawsBackend;
    if ((!premium && typeof ads?.showRewardedVideo !== "function")
      || typeof backend?.claimWheelReward !== "function") {
      showToast("Connect a rewarded-ad provider and secure reward service to spin.");
      return;
    }
    const button = document.querySelector("#spin-button");
    button.disabled = true;
    try {
      if (!premium) {
        const adResult = await ads.showRewardedVideo();
        if (adResult !== true && adResult?.rewarded !== true && adResult?.completed !== true) {
          showToast("Watch the full ad to unlock this spin.");
          return;
        }
      }
      const result = await backend.claimWheelReward({ usePremium: premium });
      if (!result?.verified || !Number.isInteger(result.coinBalance)) {
        throw new Error("The server has not verified this spin reward.");
      }
      const rewardIndex = Math.floor(Math.random() * WHEEL_REWARDS.length);
      wheelRotation += 1440 + ((360 - ((wheelRotation + rewardIndex * 60 + 30) % 360)) % 360);
      document.querySelector("#reward-wheel").style.transform = `rotate(${wheelRotation}deg)`;
      state.coins = result.coinBalance;
      state.spinsToday = Number.isInteger(result.spinsToday) ? result.spinsToday : state.spinsToday + 1;
      if (premium) {
        state.premiumSpins = Math.max(0, state.premiumSpins - 1);
        state.usePremiumSpin = false;
      }
      saveState();
      renderAll();
      showToast(`Reward secured: +${numberFormat.format(result.coinsAwarded || 0)} coins`);
    } catch (error) {
      showToast(error.message || "This spin could not be verified.");
    } finally {
      button.disabled = false;
      renderWheel();
    }
  }

  async function requestRewardedAd() {
    const provider = window.CashPawsAds;
    if (!provider || typeof provider.showRewardedVideo !== "function") {
      alert("An AdMob Rewarded Video ad must finish playing to reset your spin counter. AdMob is not configured in this web demo.");
      return;
    }
    try {
      const result = await provider.showRewardedVideo();
      if (result !== true && result?.rewarded !== true && result?.completed !== true) {
        showToast("The ad was not completed. Your spin limit has not changed.");
        return;
      }
      state.spinDay = localDay();
      state.spinsToday = 0;
      saveState();
      renderWheel();
      showToast("Rewarded ad completed. Your 5 daily spins are available again.");
    } catch (error) {
      console.error("Rewarded ad did not complete.", error);
      showToast("The rewarded ad could not be completed.");
    }
  }

  function logWalk() {
    if (state.walkDay === localDay()) return;
    state.walkDay = localDay();
    const awarded = awardDemoCoins(WALK_REWARD);
    saveState();
    renderAll();
    showToast(awarded ? `Walk logged: +${numberFormat.format(awarded)} coins` : "Daily 250 coin earning limit reached.");
  }

  function handleReceiptUpload(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      showToast("Choose an image no larger than 8 MB.");
      event.currentTarget.value = "";
      return;
    }
    state.receipts.push({ id: crypto.randomUUID(), name: file.name, status: "pending", createdAt: new Date().toISOString() });
    saveState();
    renderReceipts();
    event.currentTarget.value = "";
    showToast("Receipt queued for review. No coins are awarded before verification.");
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    const selection = getSelectedPayout();
    const account = document.querySelector("#payout-account").value.trim();
    const backend = window.CashPawsBackend;
    if (!selection || !Number.isInteger(selection.coinCost) || !account
      || state.coins < selection.coinCost || revenueBacking.coins < selection.coinCost
      || typeof backend?.requestWithdrawal !== "function") {
      updateWithdrawalButton();
      return;
    }
    const button = document.querySelector("#confirm-withdrawal");
    button.disabled = true;
    button.textContent = "Submitting…";
    try {
      const result = await backend.requestWithdrawal({
        platform: selection.platform,
        account,
        amount: selection.amount,
        currency: selection.currency,
        coinCost: selection.coinCost
      });
      if (!Number.isInteger(result?.pointsBalance) || !result?.withdrawal) {
        throw new Error("Withdrawal service returned an invalid response.");
      }
      state.coins = result.pointsBalance;
      state.withdrawals.push({
        id: result.withdrawal.id,
        platform: selection.platform,
        account,
        amount: selection.amount,
        currency: selection.currency,
        coinCost: selection.coinCost,
        status: result.withdrawal.status || "pending",
        date: new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date())
      });
      saveState();
      await refreshRevenueStatus();
      renderAll();
      showToast("Withdrawal request submitted.");
    } catch (error) {
      console.error("CashPaws withdrawal request failed.", error);
      showToast(error.message || "Withdrawal request failed. Try again.");
    } finally {
      button.textContent = "Confirm withdrawal";
      updateWithdrawalButton();
    }
  }

  function setActiveTab(tab) {
    document.querySelectorAll("[data-screen]").forEach((screen) => { screen.hidden = screen.dataset.screen !== tab; });
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelector("main").scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
  document.querySelectorAll("[data-legal-page]").forEach((link) => link.addEventListener("click", (event) => {
    const nativeBridge = window.CashpawsNativeAds;
    if (typeof nativeBridge?.openExternalLegalPage !== "function") return;
    event.preventDefault();
    nativeBridge.openExternalLegalPage(link.dataset.legalPage);
  }));
  document.querySelector("#profile-username").addEventListener("input", (event) => {
    state.username = event.currentTarget.value.trim().slice(0, 24);
    saveState();
  });
  document.querySelector("#avatar-file").addEventListener("change", handleAvatarChange);
  document.querySelector("#watch-daily-ad-button").addEventListener("click", watchDailyAd);
  document.querySelectorAll(".pet-rail").forEach((rail) => rail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pet-unlock]");
    if (button) unlockPet(button);
  }));
  document.querySelector("#spin-button").addEventListener("click", spinWheel);
  document.querySelector("#watch-ad-button").addEventListener("click", requestRewardedAd);
  document.querySelector("#walk-button").addEventListener("click", logWalk);
  document.querySelector("#map-walk-link").addEventListener("click", () => setActiveTab("walk"));
  document.querySelector("#receipt-input").addEventListener("change", handleReceiptUpload);
  document.querySelector("#payout-platform").addEventListener("change", renderPayoutOptions);
  document.querySelector("#payout-tier").addEventListener("change", updateWithdrawalButton);
  document.querySelector("#payout-account").addEventListener("input", updateWithdrawalButton);
  document.querySelector("#withdrawal-form").addEventListener("submit", submitWithdrawal);
  document.querySelector("#premium-toggle").addEventListener("click", () => {
    if (state.premiumSpins < 1) return;
    state.usePremiumSpin = !state.usePremiumSpin;
    saveState();
    renderWheel();
  });
  document.querySelector("#clear-demo").addEventListener("click", () => {
    if (!confirm("Reset this browser's CashPaws demo balance and activity?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = { ...initialState, withdrawals: [], receipts: [] };
    checkInOnOpen();
    renderAll();
    showToast("Demo data reset.");
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelector("#install-app").hidden = false;
  });
  document.querySelector("#install-app").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelector("#install-app").hidden = true;
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Offline support is unavailable.", error)));
  }

  const checkInReward = checkInOnOpen();
  renderAll();
  renderProfile();
  refreshRevenueStatus();
  if (checkInReward) {
    const premium = checkInReward.earnedPremium ? " + 1 premium spin" : "";
    showToast(`Day ${checkInReward.rewardDay} streak reward: +${numberFormat.format(checkInReward.coinsAwarded)} coins${premium}`);
  }
})();