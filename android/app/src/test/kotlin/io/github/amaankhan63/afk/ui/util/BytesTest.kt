package io.github.amaankhan63.afk.ui.util

import org.junit.Assert.assertEquals
import org.junit.Test

class BytesTest {
    @Test fun gigabytesOneDecimal() = assertEquals("12.6 GB", humanBytes(13_529_146_982))

    @Test fun terabytesOneDecimal() = assertEquals("2.5 TB", humanBytes(2_748_779_069_440))

    @Test fun megabytesAndBelowNoDecimal() {
        assertEquals("0 B", humanBytes(0))
        assertEquals("512 B", humanBytes(512))
        assertEquals("2 KB", humanBytes(2_048))
        assertEquals("700 MB", humanBytes(734_003_200))
    }

    @Test fun unitsAre1024Based() {
        assertEquals("1023 B", humanBytes(1_023))
        assertEquals("1 KB", humanBytes(1_024))
        assertEquals("1.0 GB", humanBytes(1_073_741_824))
    }
}
