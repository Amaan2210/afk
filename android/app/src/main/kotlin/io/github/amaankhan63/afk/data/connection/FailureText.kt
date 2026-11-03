package io.github.amaankhan63.afk.data.connection

/**
 * What a connection that ended in [ConnectionState.Failed] with [code] means, naming [host], the
 * laptop's name or address ("the laptop" when unknown). The sessions screen's banner and the
 * connection notification both say it this way.
 */
fun failureText(code: String, host: String?): String = if (code == ERROR_BAD_ENDPOINT) {
    "Can't reach ${host ?: "the laptop"}"
} else {
    "Connection refused: $code"
}
