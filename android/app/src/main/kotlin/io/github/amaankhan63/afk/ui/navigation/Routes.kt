package io.github.amaankhan63.afk.ui.navigation

import android.net.Uri

/** The app's screens as navigation routes. */
object Routes {
    const val PAIRING = "pairing"
    const val SESSIONS = "sessions"
    const val NEW = "new"
    const val SETTINGS = "settings"
    const val ABOUT = "about"

    /** The session screen's and the thread screen's arguments. */
    const val ARG_ID = "id"
    const val ARG_THREAD_ID = "threadId"

    /** The patterns [session] and [thread] fill. */
    const val SESSION = "session/{$ARG_ID}"
    const val THREAD = "session/{$ARG_ID}/thread/{$ARG_THREAD_ID}"

    private const val LINK_SCHEME = "afk"
    private const val LINK_HOST = "session"
    private val LINK_ID = Regex("[A-Za-z0-9._-]{1,64}")

    fun session(id: String) = "session/$id"

    fun thread(id: String, threadId: String) = "session/$id/thread/$threadId"

    /**
     * The route `afk://session/<id>` opens, or null for any other link. The link comes from
     * outside the app, so only an id of letters, digits, `.`, `_` and `-` (at most 64, and not `.`
     * or `..`) becomes a route.
     */
    fun parseDeepLink(uri: Uri): String? {
        if (uri.scheme != LINK_SCHEME || uri.host != LINK_HOST) return null
        val id = uri.pathSegments.singleOrNull() ?: return null
        if (!LINK_ID.matches(id) || id == "." || id == "..") return null
        return session(id)
    }
}
