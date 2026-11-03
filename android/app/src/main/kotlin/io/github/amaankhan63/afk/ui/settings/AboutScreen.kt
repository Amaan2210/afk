package io.github.amaankhan63.afk.ui.settings

import android.content.res.AssetManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.BuildConfig
import io.github.amaankhan63.afk.ui.settings.sections.RowDivider
import io.github.amaankhan63.afk.ui.settings.sections.SettingRow
import io.github.amaankhan63.afk.ui.settings.sections.SettingsGroup
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Termux's notice and the Apache License 2.0 it is released under, as packaged in assets. */
internal const val TERMUX_NOTICE = "licenses/NOTICE.txt"
internal const val TERMUX_LICENSE = "licenses/TERMUX-LICENSE.txt"

private const val SOURCE_URL = "https://github.com/AmaanKhan63/afk"

/** The notice, then the license, as the About screen shows them. Off the main thread: it blocks. */
internal fun readTermuxLicenses(assets: AssetManager): String =
    listOf(TERMUX_NOTICE, TERMUX_LICENSE).joinToString("\n\n") { path ->
        assets.open(path).bufferedReader().use { it.readText() }
    }

/**
 * About: the app's name and version, a link to its source, and its licenses: AFK's own (MIT) and
 * the Apache License 2.0 of the Termux terminal emulator it includes, whose notice and license
 * text it shows in full.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    val assets = LocalContext.current.assets
    val uriHandler = LocalUriHandler.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // Null while it is read.
    val termux by produceState<String?>(initialValue = null) {
        value = withContext(Dispatchers.IO) {
            try {
                readTermuxLicenses(assets)
            } catch (e: IOException) {
                "The license text could not be read."
            }
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("About") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        AboutContent(
            version = BuildConfig.VERSION_NAME,
            termux = termux,
            onSource = {
                // Throws when no app on the phone opens web links.
                try {
                    uriHandler.openUri(SOURCE_URL)
                } catch (e: IllegalArgumentException) {
                    scope.launch { snackbar.showSnackbar("No app here opens web links") }
                }
            },
            modifier = Modifier.padding(padding).consumeWindowInsets(padding)
        )
    }
}

@Composable
private fun AboutContent(
    version: String,
    termux: String?,
    onSource: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("AFK", style = type.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Version $version", style = type.bodyMedium, color = colors.onSurfaceVariant)
            Text(
                "Remote control for Claude Code and Codex sessions",
                style = type.bodyMedium,
                color = colors.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
        SettingsGroup("Project") {
            SettingRow(
                title = "Source",
                modifier = Modifier.clickable(onClick = onSource),
                note = SOURCE_URL.removePrefix("https://")
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = colors.onSurfaceVariant
                )
            }
        }
        SettingsGroup("Licenses") {
            SettingRow(title = "AFK", note = "MIT")
            RowDivider()
            SettingRow(title = "Terminal emulator", note = "Termux (Apache License 2.0)")
            if (termux != null) LicenseText(termux)
        }
    }
}

/** [text] in monospace, selectable, on a tinted block; the screen scrolls it. */
@Composable
private fun LicenseText(text: String) {
    val colors = MaterialTheme.colorScheme
    SelectionContainer {
        Text(
            text = text,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
                .background(colors.surfaceContainerHighest, MaterialTheme.shapes.small)
                .padding(10.dp),
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = colors.onSurfaceVariant
        )
    }
}
