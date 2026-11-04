package io.github.amaankhan63.afk.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.ui.settings.sections.AboutSection
import io.github.amaankhan63.afk.ui.settings.sections.AppearanceSection
import io.github.amaankhan63.afk.ui.settings.sections.LaptopSection
import io.github.amaankhan63.afk.ui.settings.sections.NotificationsSection
import io.github.amaankhan63.afk.ui.settings.sections.StatusStripSection
import io.github.amaankhan63.afk.ui.settings.sections.TerminalSection

/**
 * Settings: the paired laptop, then the app's appearance, status strip, notifications and
 * terminal, then About. Each change is saved as it is made. [onUnpaired] runs once the laptop is
 * forgotten; [onAbout] opens the licenses.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit, onUnpaired: () -> Unit, onAbout: () -> Unit = {}) {
    val viewModel: SettingsViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val fontSaveFailures by viewModel.fontSaveFailures.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var confirmUnpair by rememberSaveable { mutableStateOf(false) }
    val leave by rememberUpdatedState(onUnpaired)
    LaunchedEffect(viewModel) {
        viewModel.errors.collect { snackbar.showSnackbar(it.message ?: it.code) }
    }
    LaunchedEffect(viewModel) {
        viewModel.unpaired.collect { leave() }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .consumeWindowInsets(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val settings = state.settings
            LaptopSection(
                state = state,
                onKeepAwake = viewModel::setKeepAwake,
                onUnpair = { confirmUnpair = true }
            )
            AppearanceSection(
                settings = settings,
                onTheme = viewModel::setTheme,
                onMode = viewModel::setMode,
                onAlwaysDark = viewModel::setAlwaysDark
            )
            StatusStripSection(settings.stripChips, onChip = viewModel::setChip)
            NotificationsSection(settings.notifications, onChange = viewModel::setNotif)
            TerminalSection(
                fontSizeSp = settings.terminalFontSp,
                keyBar = settings.keyBar,
                fontSaveFailures = fontSaveFailures,
                onFontSize = viewModel::setFontSize,
                onKeyBar = viewModel::setKeyBar
            )
            AboutSection(state.version, onLicenses = onAbout)
        }
    }
    if (confirmUnpair) {
        UnpairDialog(
            hostname = state.hostname,
            onConfirm = {
                confirmUnpair = false
                viewModel.unpair()
            },
            onDismiss = { confirmUnpair = false }
        )
    }
}

@Composable
private fun UnpairDialog(hostname: String?, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Unpair this laptop?") },
        text = {
            Text(
                "The app forgets ${hostname ?: "the laptop"} and stops connecting to it. " +
                    "Pair again with its QR code. " +
                    "The laptop still lists this phone until you run afk unpair there."
            )
        },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Unpair") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
