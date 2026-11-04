package io.github.amaankhan63.afk.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Robolectric: the About screen reads Termux's notice and the Apache licence from the assets. */
@RunWith(RobolectricTestRunner::class)
class AboutLicensesTest {
    private val assets = RuntimeEnvironment.getApplication().assets

    private fun read(path: String) = assets.open(path).bufferedReader().use { it.readText() }

    @Test fun licenseIsTheApacheLicense() {
        val license = read(APACHE_LICENSE)
        assertTrue(license.isNotBlank())
        assertTrue(license.contains("Apache License"))
    }

    @Test fun noticeNamesTermux() {
        val notice = read(TERMUX_NOTICE)
        assertTrue(notice.isNotBlank())
        assertTrue(notice.contains("Termux"))
    }

    @Test fun screenReadsTheNoticeAndTheLicenseAsSeparateTexts() {
        val texts = readLicenseTexts(assets)
        assertEquals(read(TERMUX_NOTICE), texts.termuxNotice)
        assertEquals(read(APACHE_LICENSE), texts.apacheLicense)
    }
}
