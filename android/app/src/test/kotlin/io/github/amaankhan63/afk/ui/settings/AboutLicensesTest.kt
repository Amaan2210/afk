package io.github.amaankhan63.afk.ui.settings

import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Robolectric: the About screen reads Termux's notice and licence from the packaged assets. */
@RunWith(RobolectricTestRunner::class)
class AboutLicensesTest {
    private val assets = RuntimeEnvironment.getApplication().assets

    private fun read(path: String) = assets.open(path).bufferedReader().use { it.readText() }

    @Test fun licenseIsTheApacheLicense() {
        val license = read(TERMUX_LICENSE)
        assertTrue(license.isNotBlank())
        assertTrue(license.contains("Apache License"))
    }

    @Test fun noticeNamesTermux() {
        val notice = read(TERMUX_NOTICE)
        assertTrue(notice.isNotBlank())
        assertTrue(notice.contains("Termux"))
    }

    @Test fun screenShowsTheNoticeThenTheLicense() {
        val text = readTermuxLicenses(assets)
        assertTrue(text.startsWith(read(TERMUX_NOTICE)))
        assertTrue(text.endsWith(read(TERMUX_LICENSE)))
    }
}
