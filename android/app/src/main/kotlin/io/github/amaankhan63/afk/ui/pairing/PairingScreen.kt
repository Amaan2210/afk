package io.github.amaankhan63.afk.ui.pairing

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/** The three things to do before the code can be scanned, in order. */
private val STEPS = listOf(
    "Install Tailscale on the laptop and on this phone, and sign in to the same account on both.",
    "On the laptop, open a terminal and run:",
    "Scan the QR code it shows."
)
private const val PAIR_COMMAND = "afk pair"
private const val COMMAND_STEP = 1

/**
 * Pairs the app with a laptop: scan the QR code from `afk pair`, or type its values. Either way
 * the values are tested, and saved once the laptop accepts them.
 */
@Composable
fun PairingScreen(onPaired: () -> Unit) {
    val viewModel: PairingViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val notice by viewModel.notice.collectAsStateWithLifecycle()
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        // No contents when the person backs out of the scanner.
        val code = result.contents ?: return@rememberLauncherForActivityResult
        if (viewModel.onScanned(code)) viewModel.connect(onPaired)
    }
    PairingContent(
        state = state,
        notice = notice,
        onScan = { scanner.launch(scanOptions()) },
        onEdit = viewModel::onEdit,
        onConnect = { viewModel.connect(onPaired) }
    )
}

@Composable
internal fun PairingContent(
    state: PairingUiState,
    notice: String?,
    onScan: () -> Unit,
    onEdit: (host: String, port: String, token: String) -> Unit,
    onConnect: () -> Unit,
    modifier: Modifier = Modifier
) {
    var byHand by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    // Why the last try failed, as a pop-up at the bottom; a new try clears it first.
    val failure = (state.result as? TestResult.Failed)?.reason
    LaunchedEffect(failure) {
        if (failure != null) snackbar.showSnackbar(failure, duration = SnackbarDuration.Long)
    }
    Surface(modifier = modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.safeDrawingPadding()) {
            // In the middle of the screen; scrolls once it is taller than the screen.
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)
            ) {
                Text(
                    text = "Pair with your laptop",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() }
                )
                notice?.let { Notice(it) }
                STEPS.forEachIndexed { index, text ->
                    Step(index + 1, text, command = PAIR_COMMAND.takeIf { index == COMMAND_STEP })
                }
                Button(
                    onClick = onScan,
                    enabled = !state.testing,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                ) {
                    Text("Scan QR code", style = MaterialTheme.typography.titleMedium)
                }
                Status(state)
                TextButton(onClick = { byHand = !byHand }) {
                    Text(if (byHand) "Hide the details" else "Type the details instead")
                }
                if (byHand) Details(state, onEdit, onConnect)
            }
            SnackbarHost(hostState = snackbar, modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
}

/** Why the app is back at this screen. */
@Composable
private fun Notice(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer, MaterialTheme.shapes.medium)
            .padding(12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.onErrorContainer,
        style = MaterialTheme.typography.bodyMedium
    )
}

/** One numbered step; [command] is what to type, shown as code under the text. */
@Composable
private fun Step(number: Int, text: String, command: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = number.toString(),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(text, style = MaterialTheme.typography.bodyLarge)
            if (command != null) {
                Text(
                    text = command,
                    modifier = Modifier
                        .background(
                            MaterialTheme.colorScheme.surfaceContainerHighest,
                            MaterialTheme.shapes.small
                        )
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }
}

/** The test under way. */
@Composable
private fun Status(state: PairingUiState) {
    if (!state.testing) return
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.semantics { contentDescription = "Connecting to the laptop" }
    ) {
        CircularProgressIndicator(modifier = Modifier.size(24.dp))
        Text("Connecting to the laptop…")
    }
}

/** The code's three values, typed, and the button that tries them. */
@Composable
private fun Details(
    state: PairingUiState,
    onEdit: (host: String, port: String, token: String) -> Unit,
    onConnect: () -> Unit
) {
    Text(
        text = "afk pair prints these under the QR code.",
        style = MaterialTheme.typography.bodyMedium
    )
    OutlinedTextField(
        value = state.host,
        onValueChange = { onEdit(it, state.port, state.token) },
        label = { Text("Host") },
        placeholder = { Text("100.84.12.9") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Next
        ),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = state.port,
        onValueChange = { onEdit(state.host, it, state.token) },
        label = { Text("Port") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Number,
            imeAction = ImeAction.Next
        ),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = state.token,
        onValueChange = { onEdit(state.host, state.port, it) },
        label = { Text("Token") },
        singleLine = true,
        // Password: keyboards neither suggest nor learn it. Shown in clear to ease typing.
        keyboardOptions = KeyboardOptions(
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Password,
            imeAction = ImeAction.Done
        ),
        modifier = Modifier.fillMaxWidth()
    )
    OutlinedButton(
        onClick = onConnect,
        enabled = !state.testing && state.host.isNotBlank() && state.token.isNotBlank(),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text("Connect")
    }
}

private fun scanOptions(): ScanOptions = ScanOptions()
    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
    .setPrompt("Scan the QR code that afk pair shows")
    .setBeepEnabled(false)
    // Follows the device's rotation; the manifest lifts zxing's landscape-only declaration.
    .setOrientationLocked(false)
