package io.github.amaankhan63.afk.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily

val AfkTypography = Typography()

private fun TextStyle.mono() = copy(fontFamily = FontFamily.Monospace)

/** Phosphor's monospace UI: every default Material style with the monospace family. */
val PhosphorTypography =
    Typography(
        displayLarge = AfkTypography.displayLarge.mono(),
        displayMedium = AfkTypography.displayMedium.mono(),
        displaySmall = AfkTypography.displaySmall.mono(),
        headlineLarge = AfkTypography.headlineLarge.mono(),
        headlineMedium = AfkTypography.headlineMedium.mono(),
        headlineSmall = AfkTypography.headlineSmall.mono(),
        titleLarge = AfkTypography.titleLarge.mono(),
        titleMedium = AfkTypography.titleMedium.mono(),
        titleSmall = AfkTypography.titleSmall.mono(),
        bodyLarge = AfkTypography.bodyLarge.mono(),
        bodyMedium = AfkTypography.bodyMedium.mono(),
        bodySmall = AfkTypography.bodySmall.mono(),
        labelLarge = AfkTypography.labelLarge.mono(),
        labelMedium = AfkTypography.labelMedium.mono(),
        labelSmall = AfkTypography.labelSmall.mono()
    )
