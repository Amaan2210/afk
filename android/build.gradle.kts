// AGP 9 compiles Kotlin itself (built-in Kotlin), so there is no org.jetbrains.kotlin.android
// plugin. The Kotlin plugins below also lift AGP's Kotlin Gradle plugin to the catalog's version.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ktlint) apply false
}
