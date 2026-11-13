package io.github.amaankhan63.afk.ui.settings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.amaankhan63.afk.ui.settings.sections.AboutSection
import io.github.amaankhan63.afk.ui.settings.sections.AppearanceSection
import io.github.amaankhan63.afk.ui.settings.sections.LaptopSection
import io.github.amaankhan63.afk.ui.settings.sections.NotificationsSection
import io.github.amaankhan63.afk.ui.settings.sections.StatusStripSection
import io.github.amaankhan63.afk.ui.settings.sections.TerminalSection
import kotlinx.coroutines.launch

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
    var naming by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
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
                onUnpair = { confirmUnpair = true },
                onRename = { naming = true }
            )
            AppearanceSection(
                settings = settings,
                onTheme = viewModel::setTheme,
                onMode = viewModel::setMode,
                onAlwaysDark = viewModel::setAlwaysDark
            )
            StatusStripSection(settings.stripChips, onChip = viewModel::setChip)
            NotificationsSection(
                prefs = settings.notifications,
                onChange = viewModel::setNotif,
                onSound = {
                    if (!openNotificationSettings(context)) {
                        scope.launch { snackbar.showSnackbar("Open Android's settings for AFK") }
                    }
                }
            )
            TerminalSection(
                fontSizeSp = settings.terminalFontSp,
                keyBar = settings.keyBar,
                fontSaveFailures = fontSaveFailures,
                onFontSize = viewModel::setFontSize,
                onKeyBar = viewModel::setKeyBar,
                swipeTabs = settings.swipeTabs,
                onSwipeTabs = viewModel::setSwipeTabs,
                wordSuggestions = settings.wordSuggestions,
                onWordSuggestions = viewModel::setWordSuggestions
            )
            AboutSection(state.version, onLicenses = onAbout)
        }
    }
    if (confirmUnpair) {
        UnpairDialog(
            hostname = state.hostname,
            connected = state.connected,
            onConfirm = {
                confirmUnpair = false
                viewModel.unpair()
            },
            onDismiss = { confirmUnpair = false }
        )
    }
    if (naming) {
        LaptopNameDialog(
            current = state.laptopName.orEmpty(),
            onDismiss = { naming = false },
            onSave = {
                naming = false
                viewModel.setLaptopName(it)
            }
        )
    }
}

/** Opens Android's notification settings for this app, where each kind's sound is set. */
private fun openNotificationSettings(context: Context): Boolean {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
        context.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        false
    }
}

/** What unpairing does, before it does it: [connected], it ends everything AFK runs. */
internal fun unpairWarning(hostname: String?, connected: Boolean): String {
    val laptop = hostname ?: "the laptop"
    return if (connected) {
        "This ends every AFK session on $laptop, closes their windows and stops AFK there. " +
            "To use AFK again, run afk pair on the laptop."
    } else {
        "The laptop is not connected, so the app only forgets it. Sessions on it keep running " +
            "until you run afk unpair there."
    }
}

@Composable
private fun UnpairDialog(
    hostname: String?,
    connected: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (connected) "Unpair and stop all sessions?" else "Unpair this laptop?") },
        text = { Text(unpairWarning(hostname, connected)) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(
                    text = if (connected) "Unpair and stop" else "Unpair",
                    color = MaterialTheme.colorScheme.error
                )
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

/** Asks what to call the laptop, starting from [current]; blank is the computer's own name. */
@Composable
private fun LaptopNameDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Name this laptop") },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(LAPTOP_NAME_MAX) },
                label = { Text("Name") },
                supportingText = { Text("Leave empty to use the computer's own name") },
                singleLine = true
            )
        },
        confirmButton = { TextButton(onClick = { onSave(name) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

/** The longest name the laptop takes. */
private const val LAPTOP_NAME_MAX = 40
