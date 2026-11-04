package io.github.amaankhan63.afk.ui.settings

/** A library bundled in the APK, credited on the About screen; [url] is its source. */
internal data class ThirdPartyLibrary(val name: String, val owner: String, val url: String)

/**
 * Every third-party library the release APK bundles, by name. All are under the Apache License
 * 2.0, whose text the About screen shows once. The Termux terminal emulator is credited apart,
 * with its notice. Test and debug-only dependencies do not ship and are not listed.
 */
internal val THIRD_PARTY_LIBRARIES: List<ThirdPartyLibrary> = listOf(
    ThirdPartyLibrary(
        "AndroidX and Jetpack Compose",
        "The Android Open Source Project",
        "https://github.com/androidx/androidx"
    ),
    ThirdPartyLibrary("Dagger and Hilt", "The Dagger Authors", "https://github.com/google/dagger"),
    ThirdPartyLibrary(
        "Kotlin standard library",
        "JetBrains s.r.o. and Kotlin contributors",
        "https://github.com/JetBrains/kotlin"
    ),
    ThirdPartyLibrary(
        "kotlinx.coroutines",
        "JetBrains s.r.o. and contributors",
        "https://github.com/Kotlin/kotlinx.coroutines"
    ),
    ThirdPartyLibrary(
        "kotlinx.serialization",
        "JetBrains s.r.o. and contributors",
        "https://github.com/Kotlin/kotlinx.serialization"
    ),
    ThirdPartyLibrary("OkHttp", "Square, Inc.", "https://github.com/square/okhttp"),
    ThirdPartyLibrary("Okio", "Square, Inc.", "https://github.com/square/okio"),
    ThirdPartyLibrary("ZXing", "ZXing authors", "https://github.com/zxing/zxing"),
    ThirdPartyLibrary(
        "ZXing Android Embedded",
        "JourneyApps",
        "https://github.com/journeyapps/zxing-android-embedded"
    )
)
