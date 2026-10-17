plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ADMOB_APPLICATION_ID = "ca-app-pub-6655685917040449~9877811783"
val ADMOB_REWARDED_AD_UNIT_ID = "ca-app-pub-6655685917040449/1007085551"
val ADMOB_BANNER_AD_UNIT_ID = "ca-app-pub-6655685917040449/3377650918"
val ADMOB_INTERSTITIAL_AD_UNIT_ID = "ca-app-pub-6655685917040449/1974351160"
val CASHPaws_PUBLIC_BASE_URL = providers.gradleProperty("cashpawsPublicBaseUrl")
    .orElse("https://9livespaws.github.io/CashPaws/")
    .get()

android {
    namespace = "com.yourcompany.cashpaws"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yourcompany.cashpaws"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        manifestPlaceholders["admobApplicationId"] = ADMOB_APPLICATION_ID
        buildConfigField("String", "ADMOB_REWARDED_AD_UNIT_ID", "\"$ADMOB_REWARDED_AD_UNIT_ID\"")
        buildConfigField("String", "ADMOB_BANNER_AD_UNIT_ID", "\"$ADMOB_BANNER_AD_UNIT_ID\"")
        buildConfigField("String", "ADMOB_INTERSTITIAL_AD_UNIT_ID", "\"$ADMOB_INTERSTITIAL_AD_UNIT_ID\"")
        buildConfigField("String", "CASHPaws_PUBLIC_BASE_URL", "\"$CASHPaws_PUBLIC_BASE_URL\"")
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets.getByName("main").assets.srcDir("../../public")
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.gms:play-services-ads:24.5.0")
}