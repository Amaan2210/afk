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
import androidx.compose.ui.platform.LocalContext

val LocalAfkPalette: ProvidableCompositionLocal<AfkPalette> =
    staticCompositionLocalOf { Palettes.palette(AfkThemeId.Graphite, dark = true) }

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
    val colorScheme =
        when {
            resolved != AfkThemeId.Dynamic -> palette.toColorScheme(dark)
            dark -> dynamicDarkColorScheme(context)
            else -> dynamicLightColorScheme(context)
        }
    val phosphor = resolved == AfkThemeId.Phosphor
    CompositionLocalProvider(LocalAfkPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = if (phosphor) PhosphorTypography else AfkTypography,
            shapes = if (phosphor) PhosphorShapes else AfkShapes,
            content = content
        )
    }
}

private fun AfkPalette.toColorScheme(dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = accent,
        onPrimary = onAccent,
        background = bg,
        onBackground = text,
        surface = surface,
        onSurface = text,
        surfaceVariant = surface2,
        onSurfaceVariant = text2,
        outline = border,
        primaryContainer = accentSoft,
        onPrimaryContainer = accent
    )
}
