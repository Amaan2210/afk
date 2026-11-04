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
import androidx.compose.ui.semantics.Role
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

/** Termux's notice, and the Apache License 2.0 that it and every bundled library are under. */
internal const val TERMUX_NOTICE = "licenses/NOTICE.txt"
internal const val APACHE_LICENSE = "licenses/APACHE-2.0.txt"

private const val SOURCE_URL = "https://github.com/AmaanKhan63/afk"
private const val APACHE = "Apache License 2.0"
private const val UNREADABLE = "The license text could not be read."

/** The two licence texts the About screen shows, as packaged in assets. */
internal data class LicenseTexts(val termuxNotice: String, val apacheLicense: String)

/** Reads both texts. Off the main thread: it blocks. */
internal fun readLicenseTexts(assets: AssetManager): LicenseTexts {
    fun read(path: String) = assets.open(path).bufferedReader().use { it.readText() }
    return LicenseTexts(termuxNotice = read(TERMUX_NOTICE), apacheLicense = read(APACHE_LICENSE))
}

/**
 * About: the app's name and version, a link to its source, and its licenses: AFK's own (MIT),
 * the Termux terminal emulator it includes, with Termux's notice, every other bundled library
 * with its owner and a link to its source, and the Apache License 2.0 they are all under, in
 * full.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    val assets = LocalContext.current.assets
    val uriHandler = LocalUriHandler.current
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    // Null while they are read.
    val texts by produceState<LicenseTexts?>(initialValue = null) {
        value = withContext(Dispatchers.IO) {
            try {
                readLicenseTexts(assets)
            } catch (e: IOException) {
                LicenseTexts(termuxNotice = UNREADABLE, apacheLicense = UNREADABLE)
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
            texts = texts,
            onOpen = { url ->
                // Throws when no app on the phone opens web links.
                try {
                    uriHandler.openUri(url)
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
    texts: LicenseTexts?,
    onOpen: (String) -> Unit,
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
            LinkRow(
                title = "Source",
                note = SOURCE_URL.removePrefix("https://"),
                onClick = { onOpen(SOURCE_URL) }
            )
        }
        SettingsGroup("Licenses") {
            SettingRow(title = "AFK", note = "MIT")
            RowDivider()
            SettingRow(title = "Terminal emulator", note = "Termux ($APACHE)")
            if (texts != null) LicenseText(texts.termuxNotice)
        }
        SettingsGroup("Libraries") {
            THIRD_PARTY_LIBRARIES.forEachIndexed { index, library ->
                if (index > 0) RowDivider()
                LinkRow(
                    title = library.name,
                    note = "${library.owner} · $APACHE",
                    onClick = { onOpen(library.url) }
                )
            }
        }
        SettingsGroup(APACHE) {
            SettingRow(title = "Full text", note = "Covers the terminal emulator and the libraries")
            if (texts != null) LicenseText(texts.apacheLicense)
        }
    }
}

/** A row that opens a link: [title] over [note], a chevron at the end, a button to TalkBack. */
@Composable
private fun LinkRow(title: String, note: String, onClick: () -> Unit) {
    SettingRow(
        title = title,
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick),
        note = note
    ) {
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
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
