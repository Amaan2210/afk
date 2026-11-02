package io.github.amaankhan63.afk.data.sessions

import io.github.amaankhan63.afk.data.protocol.Base64Codec
import io.github.amaankhan63.afk.data.protocol.ServerMessage

/** One frame of a session's terminal stream, its bytes decoded. Frames compare by content. */
sealed interface PtyFrame {
    /** The screen and scrollback at [cols] × [rows]; replaces whatever was shown before. */
    data class Snapshot(val cols: Int, val rows: Int, val bytes: ByteArray) : PtyFrame {
        override fun equals(other: Any?): Boolean = other is Snapshot &&
            cols == other.cols &&
            rows == other.rows &&
            bytes.contentEquals(other.bytes)

        override fun hashCode(): Int = 31 * (31 * cols + rows) + bytes.contentHashCode()
    }

    /** Output to append. */
    data class Data(val bytes: ByteArray) : PtyFrame {
        override fun equals(other: Any?): Boolean =
            other is Data && bytes.contentEquals(other.bytes)

        override fun hashCode(): Int = bytes.contentHashCode()
    }

    /** Another client resized the terminal. */
    data class Resized(val cols: Int, val rows: Int) : PtyFrame
}

/** This message as a frame of [sessionId]'s terminal; null if it is not one or is not decodable. */
internal fun ServerMessage.ptyFrameOf(sessionId: String): PtyFrame? = when {
    this is ServerMessage.PtySnapshot && this.sessionId == sessionId ->
        Base64Codec.decode(data)?.let { PtyFrame.Snapshot(cols, rows, it) }

    this is ServerMessage.PtyData && this.sessionId == sessionId ->
        Base64Codec.decode(data)?.let { PtyFrame.Data(it) }

    this is ServerMessage.PtyResized && this.sessionId == sessionId -> PtyFrame.Resized(cols, rows)

    else -> null
}
