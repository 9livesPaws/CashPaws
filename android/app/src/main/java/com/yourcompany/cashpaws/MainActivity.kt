package com.yourcompany.cashpaws

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private var rewardedAd: RewardedAd? = null
    private var interstitialAd: InterstitialAd? = null
    private var interstitialLoadInProgress = false
    private lateinit var adContainerView: FrameLayout
    private lateinit var appWebView: WebView
    private var adView: AdView? = null
    private val interstitialCooldownPreferences by lazy {
        getSharedPreferences("cashpaws_interstitial_cooldown", MODE_PRIVATE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        appWebView = findViewById(R.id.app_web_view)
        adContainerView = findViewById(R.id.bottom_ad_banner_container)
        configureWebView()

        MobileAds.initialize(this) {
            runOnUiThread {
                loadAdaptiveBanner()
                loadRewardedAdAsset()
                loadInterstitialAdAsset()
            }
        }
    }

    private fun configureWebView() {
        appWebView.settings.javaScriptEnabled = true
        appWebView.settings.domStorageEnabled = true
        appWebView.settings.allowFileAccess = true
        appWebView.settings.allowFileAccessFromFileURLs = false
        appWebView.settings.allowUniversalAccessFromFileURLs = false
        appWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
                val url = request.url
                return url.scheme != "file" || url.path?.startsWith("/android_asset/") != true
            }
        }
        appWebView.webChromeClient = WebChromeClient()
        appWebView.addJavascriptInterface(CashpawsJavaScriptBridge(), "CashpawsNativeAds")
        appWebView.loadUrl("file:///android_asset/index.html")
    }

    private fun loadAdaptiveBanner() {
        adContainerView.post {
            val density = resources.displayMetrics.density
            val widthDp = (adContainerView.width / density).toInt().coerceAtLeast(1)
            val size = AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(this, widthDp)
            val banner = AdView(this).apply {
                adUnitId = BuildConfig.ADMOB_BANNER_AD_UNIT_ID
                setAdSize(size)
                adListener = object : AdListener() {
                    override fun onAdFailedToLoad(error: LoadAdError) {
                        Toast.makeText(this@MainActivity, "Banner ad unavailable", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            adContainerView.removeAllViews()
            adContainerView.addView(
                banner,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
            adView = banner
            banner.loadAd(AdRequest.Builder().build())
        }
    }

    private fun loadRewardedAdAsset() {
        if (rewardedAd != null) return
        RewardedAd.load(
            this,
            BuildConfig.ADMOB_REWARDED_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    rewardedAd = null
                }

                override fun onAdLoaded(ad: RewardedAd) {
                    rewardedAd = ad
                }
            }
        )
    }

    /**
     * Call with an authenticated opaque AdMob user ID and server-issued custom data.
     * The server must verify AdMob SSV before recording any coins.
     */
    fun showUserRewardedAdPlacement(
        admobUserId: String,
        signedCustomData: String,
        requestId: String = ""
    ) {
        if (admobUserId.isBlank() || signedCustomData.isBlank()) {
            Toast.makeText(this, "Sign in before requesting a rewarded ad", Toast.LENGTH_SHORT).show()
            notifyRewardResult(requestId, completed = false)
            return
        }

        val ad = rewardedAd
        if (ad == null) {
            Toast.makeText(this, "Ad is loading. Please try again shortly.", Toast.LENGTH_SHORT).show()
            loadRewardedAdAsset()
            notifyRewardResult(requestId, completed = false)
            return
        }

        rewardedAd = null
        ad.setServerSideVerificationOptions(
            ServerSideVerificationOptions.Builder()
                .setUserId(admobUserId)
                .setCustomData(signedCustomData)
                .build()
        )
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                loadRewardedAdAsset()
            }

            override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
                loadRewardedAdAsset()
                notifyRewardResult(requestId, completed = false)
                Toast.makeText(this@MainActivity, "The ad could not be shown", Toast.LENGTH_SHORT).show()
            }
        }
        ad.show(this) {
            Toast.makeText(
                this,
                "Reward received. Verifying securely with Cashpaws…",
                Toast.LENGTH_LONG
            ).show()
            notifyRewardResult(requestId, completed = true)
            appWebView.evaluateJavascript(
                "window.dispatchEvent(new Event('cashpaws:reward-verification-pending'))",
                null
            )
        }
    }

    private fun loadInterstitialAdAsset() {
        if (interstitialAd != null || interstitialLoadInProgress || isFinishing || isDestroyed) return
        interstitialLoadInProgress = true
        InterstitialAd.load(
            this,
            BuildConfig.ADMOB_INTERSTITIAL_AD_UNIT_ID,
            AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    interstitialLoadInProgress = false
                    interstitialAd = null
                }

                override fun onAdLoaded(ad: InterstitialAd) {
                    interstitialLoadInProgress = false
                    interstitialAd = ad
                }
            }
        )
    }

    private fun showInterstitialForNavigation(profileSessionId: String) {
        val sessionKey = profileSessionId.trim().take(200).ifBlank { "anonymous" }
        val preferenceKey = "last_shown_${sessionKey.hashCode()}"
        val now = SystemClock.elapsedRealtime()
        val lastShown = interstitialCooldownPreferences.getLong(preferenceKey, 0L)
        if (lastShown > 0L && now - lastShown < INTERSTITIAL_COOLDOWN_MS) return

        val ad = interstitialAd
        if (ad == null) {
            loadInterstitialAdAsset()
            return
        }

        interstitialAd = null
        interstitialCooldownPreferences.edit().putLong(preferenceKey, now).apply()
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() {
                loadInterstitialAdAsset()
            }

            override fun onAdFailedToShowFullScreenContent(error: com.google.android.gms.ads.AdError) {
                loadInterstitialAdAsset()
            }
        }
        ad.show(this)
    }

    private fun notifyRewardResult(requestId: String, completed: Boolean) {
        if (requestId.isBlank() || !::appWebView.isInitialized) return
        val detail = JSONObject()
            .put("requestId", requestId)
            .put("completed", completed)
            .toString()
        appWebView.post {
            appWebView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('cashpaws:rewarded-ad-result',{detail:$detail}))",
                null
            )
        }
    }

    private inner class CashpawsJavaScriptBridge {
        @JavascriptInterface
        fun onPrimaryNavigationChange(tab: String, profileSessionId: String) {
            if (tab !in setOf("home", "walk", "receipt", "redeem")) return
            runOnUiThread { showInterstitialForNavigation(profileSessionId) }
        }

        @JavascriptInterface
        fun showRewardedVideo(requestId: String, admobUserId: String, signedCustomData: String) {
            runOnUiThread {
                showUserRewardedAdPlacement(admobUserId, signedCustomData, requestId)
            }
        }

        @JavascriptInterface
        fun openExternalLegalPage(page: String) {
            val legalFile = when (page) {
                "privacy" -> "privacy.html"
                "terms" -> "terms.html"
                else -> return
            }
            runOnUiThread {
                val baseUri = Uri.parse(BuildConfig.CASHPaws_PUBLIC_BASE_URL)
                if (baseUri.scheme != "https" || !baseUri.path.orEmpty().endsWith("/")) return@runOnUiThread
                val legalUri = baseUri.buildUpon().appendPath(legalFile).build()
                val browserIntent = Intent(Intent.ACTION_VIEW, legalUri)
                if (browserIntent.resolveActivity(packageManager) != null) {
                    startActivity(browserIntent)
                } else {
                    Toast.makeText(this@MainActivity, "No browser is available to open this page", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        adView?.resume()
        appWebView.onResume()
    }

    override fun onPause() {
        adView?.pause()
        appWebView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        adView?.destroy()
        adView = null
        appWebView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000L
    }
}