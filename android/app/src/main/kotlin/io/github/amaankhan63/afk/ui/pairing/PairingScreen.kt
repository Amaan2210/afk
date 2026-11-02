package io.github.amaankhan63.afk.ui.pairing

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

/** Pairs the app with a daemon: scan the QR code from `afk pair` or type its values; test; save. */
@Composable
fun PairingScreen(onPaired: () -> Unit) {
    val viewModel: PairingViewModel = hiltViewModel()
    val state by viewModel.ui.collectAsStateWithLifecycle()
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        // No contents when the person backs out of the scanner.
        result.contents?.let(viewModel::onScanned)
    }
    PairingContent(
        state = state,
        onScan = { scanner.launch(scanOptions()) },
        onEdit = viewModel::onEdit,
        onTest = viewModel::testConnection,
        onSave = { viewModel.save(onPaired) }
    )
}

@Composable
internal fun PairingContent(
    state: PairingUiState,
    onScan: () -> Unit,
    onEdit: (host: String, port: String, token: String) -> Unit,
    onTest: () -> Unit,
    onSave: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Pair with your computer",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() }
            )
            Text(
                text = "Run afk pair on your computer and scan the QR code it shows, " +
                    "or type its host, port and token below.",
                style = MaterialTheme.typography.bodyMedium
            )
            Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
                Text("Scan QR code")
            }
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
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedButton(
                    onClick = onTest,
                    enabled = !state.testing && state.host.isNotBlank() && state.token.isNotBlank()
                ) {
                    Text("Test connection")
                }
                if (state.testing) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .size(24.dp)
                            .semantics { contentDescription = "Testing connection" }
                    )
                }
            }
            state.result?.let { TestResultText(it) }
            Button(
                onClick = onSave,
                enabled = state.result is TestResult.Ok,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Save")
            }
        }
    }
}

/** Read out by TalkBack when it appears or changes. */
@Composable
private fun TestResultText(result: TestResult) {
    val (text, color) = when (result) {
        is TestResult.Ok -> "Connected to ${result.hostname}" to MaterialTheme.colorScheme.primary
        is TestResult.Failed -> result.reason to MaterialTheme.colorScheme.error
    }
    Text(
        text = text,
        color = color,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
    )
}

private fun scanOptions(): ScanOptions = ScanOptions()
    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
    .setPrompt("Scan the QR code that afk pair shows")
    .setBeepEnabled(false)
    // Follows the device's rotation; the manifest lifts zxing's landscape-only declaration.
    .setOrientationLocked(false)
