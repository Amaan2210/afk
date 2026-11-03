package io.github.amaankhan63.afk.data.settings

import io.github.amaankhan63.afk.ui.session.DEFAULT_STRIP_CHIPS
import io.github.amaankhan63.afk.ui.session.StripChip
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.ThemeMode

/** The smallest terminal font size Settings and a pinch allow, in sp. */
const val MIN_TERMINAL_FONT_SP = 10

/** The largest terminal font size Settings and a pinch allow, in sp. */
const val MAX_TERMINAL_FONT_SP = 20

/**
 * The app's own settings, kept on the phone; the laptop's live in the daemon. [stripChips] are the
 * status strip's chips in the order it shows them.
 */
data class AppSettings(
    val theme: AfkThemeId = AfkThemeId.Graphite,
    val mode: ThemeMode = ThemeMode.System,
    val alwaysDarkTerminal: Boolean = false,
    val stripChips: List<StripChip> = DEFAULT_STRIP_CHIPS,
    val notifications: NotificationPrefs = NotificationPrefs(),
    val terminalFontSp: Int = 12,
    val keyBar: Boolean = true
)
