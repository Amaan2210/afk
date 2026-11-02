package io.github.amaankhan63.afk.data.pairing

import io.github.amaankhan63.afk.data.connection.Endpoint
import io.github.amaankhan63.afk.data.protocol.AfkJson
import kotlinx.serialization.Serializable

/** What the app needs to reach one daemon: its address and this device's token. */
data class PairingPayload(val host: String, val port: Int = 2350, val token: String) {
    fun endpoint() = Endpoint(host, port)
}

/** Reads the JSON that `afk pair` shows as a QR code (protocol.md, "Handshake"). */
object PairingCodec {
    /** The payload in [raw], or a failure when [raw] is not a usable version-1 pairing payload. */
    fun parse(raw: String): Result<PairingPayload> = try {
        val wire = AfkJson.json.decodeFromString(WirePayload.serializer(), raw)
        require(wire.afk == FORMAT_VERSION) { "unsupported pairing format ${wire.afk}" }
        val host = wire.host.trim()
        val token = wire.token.trim()
        require(host.isNotEmpty()) { "blank host" }
        require(token.isNotEmpty()) { "blank token" }
        require(wire.port in 1..65535) { "port ${wire.port} is outside 1..65535" }
        Result.success(PairingPayload(host, wire.port, token))
    } catch (e: IllegalArgumentException) {
        // SerializationException included: not JSON, not an object, or a field missing or mistyped.
        Result.failure(e)
    }

    private const val FORMAT_VERSION = 1

    @Serializable
    private data class WirePayload(
        val afk: Int,
        val host: String,
        val port: Int = 2350,
        val token: String
    )
}
