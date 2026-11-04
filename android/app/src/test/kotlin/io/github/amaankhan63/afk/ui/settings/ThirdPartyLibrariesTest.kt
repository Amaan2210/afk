package io.github.amaankhan63.afk.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The About screen's credits: every library bundled in the APK, with an owner and a source. */
class ThirdPartyLibrariesTest {
    private val names = THIRD_PARTY_LIBRARIES.map { it.name }

    @Test fun everyBundledLibraryIsCredited() {
        val bundled = listOf(
            "AndroidX and Jetpack Compose",
            "Dagger and Hilt",
            "Kotlin standard library",
            "kotlinx.coroutines",
            "kotlinx.serialization",
            "OkHttp",
            "Okio",
            "ZXing",
            "ZXing Android Embedded"
        )
        for (name in bundled) assertTrue("$name is not credited", name in names)
    }

    @Test fun everyEntryHasAnOwnerAndAnHttpsSource() {
        for (library in THIRD_PARTY_LIBRARIES) {
            assertTrue(library.name, library.name.isNotBlank())
            assertTrue(library.name, library.owner.isNotBlank())
            assertTrue(library.url, library.url.startsWith("https://"))
        }
    }

    @Test fun entriesAreUniqueAndSortedByNameIgnoringCase() {
        assertEquals(names.distinct(), names)
        assertEquals(names.sortedBy { it.lowercase() }, names)
    }
}
