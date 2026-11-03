package io.github.amaankhan63.afk.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

val LocalAfkPalette: ProvidableCompositionLocal<AfkPalette> =
    staticCompositionLocalOf { Palettes.palette(AfkThemeId.Graphite, dark = true) }

/** The theme [AfkTheme] shows: Dynamic only where Android supports it, else Graphite. */
val LocalAfkThemeId: ProvidableCompositionLocal<AfkThemeId> =
    staticCompositionLocalOf { AfkThemeId.Graphite }

/** Whether [AfkTheme] is dark, by its mode or, for System, by the system's. */
val LocalAfkDark: ProvidableCompositionLocal<Boolean> = staticCompositionLocalOf { true }

@Composable
fun AfkTheme(id: AfkThemeId, mode: ThemeMode, content: @Composable () -> Unit) {
    val dark =
        when (mode) {
            ThemeMode.System -> isSystemInDarkTheme()
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
        }
    val resolved = Palettes.resolvesDynamic(id, Build.VERSION.SDK_INT)
    val palette = Palettes.palette(resolved, dark)
    val context = LocalContext.current
    // resolvesDynamic already falls back below Android 12; the SDK check repeats it where lint
    // can see it.
    val colorScheme =
        if (resolved == AfkThemeId.Dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        } else {
            palette.toColorScheme(dark)
        }
    val phosphor = resolved == AfkThemeId.Phosphor
    CompositionLocalProvider(
        LocalAfkPalette provides palette,
        LocalAfkThemeId provides resolved,
        LocalAfkDark provides dark
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = if (phosphor) PhosphorTypography else AfkTypography,
            shapes = if (phosphor) PhosphorShapes else AfkShapes,
            content = content
        )
    }
}

/**
 * Maps every palette-derived slot so no component falls back to Material's baseline purple.
 * The error* slots keep Material's baseline red: the palette has no red token.
 */
internal fun AfkPalette.toColorScheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        primaryContainer = accentSoft,
        onPrimaryContainer = accent,
        secondary = accent,
        onSecondary = onAccent,
        secondaryContainer = accentSoft,
        onSecondaryContainer = accent,
        tertiary = accent,
        onTertiary = onAccent,
        tertiaryContainer = accentSoft,
        onTertiaryContainer = accent,
        background = bg,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = surface2,
        onSurfaceVariant = text2,
        surfaceTint = accent,
        surfaceDim = bg,
        surfaceBright = surface2,
        surfaceContainerLowest = bg,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = surface2,
        surfaceContainerHighest = surface2,
        outline = border,
        outlineVariant = border,
        inverseSurface = text,
        inverseOnSurface = bg,
        inversePrimary = accentSoft,
        scrim = Color.Black
    )
}
