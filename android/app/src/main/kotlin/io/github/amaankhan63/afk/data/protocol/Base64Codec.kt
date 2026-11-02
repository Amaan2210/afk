package io.github.amaankhan63.afk.data.protocol

import java.util.Base64

/**
 * The protocol's byte payloads (terminal I/O) as standard base64 text. Built on [java.util.Base64]
 * (API 26+), so plain JVM tests run it too.
 */
object Base64Codec {
    fun encode(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    /** The bytes [text] encodes, or null when it is not valid base64. */
    fun decode(text: String): ByteArray? = try {
        Base64.getDecoder().decode(text)
    } catch (e: IllegalArgumentException) {
        null
    }
}
