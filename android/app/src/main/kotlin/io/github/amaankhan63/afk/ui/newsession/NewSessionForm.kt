package io.github.amaankhan63.afk.ui.newsession

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.ui.components.agentLabel

private val AGENTS = listOf(SessionKind.claude, SessionKind.codex, SessionKind.shell)
private val CHECK_SIZE = FilterChipDefaults.IconSize

/** The form as [state] describes it. The model's field shows while a chip needs it. */
@Composable
internal fun NewSessionForm(
    state: NewSessionUiState,
    onChooseFolder: () -> Unit,
    onKind: (SessionKind) -> Unit,
    onToggleFlag: (String) -> Unit,
    onModel: (String) -> Unit,
    onPrompt: (String) -> Unit,
    modifier: Modifier = Modifier,
    onName: (String) -> Unit = {}
) {
    val chips = LaunchFlags.chipsFor(state.kind)
    Column(
        modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Label("Folder")
        FolderField(state.cwd, onChooseFolder)
        OutlinedTextField(
            value = state.name,
            onValueChange = onName,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            label = { Text("Name · optional") },
            placeholder = { Text("The folder's name") },
            singleLine = true
        )
        Label("Agent")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            AGENTS.forEachIndexed { index, kind ->
                SegmentedButton(
                    selected = kind == state.kind,
                    onClick = { onKind(kind) },
                    shape = SegmentedButtonDefaults.itemShape(index, AGENTS.size),
                    icon = {}
                ) { Text(agentLabel(kind), maxLines = 1) }
            }
        }
        if (chips.isNotEmpty()) {
            Label("Flags")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                chips.forEach { chip ->
                    val selected = chip.id in state.flags
                    FilterChip(
                        selected = selected,
                        onClick = { onToggleFlag(chip.id) },
                        label = { Text(chip.label, fontFamily = FontFamily.Monospace) },
                        leadingIcon = if (selected) {
                            { Icon(Icons.Default.Check, null, Modifier.size(CHECK_SIZE)) }
                        } else {
                            null
                        }
                    )
                }
            }
        }
        if (chips.any { it.needsValue && it.id in state.flags }) {
            OutlinedTextField(
                value = state.model,
                onValueChange = onModel,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Model") },
                // A model's id is not a word to correct.
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
                singleLine = true
            )
        }
        if (state.kind != SessionKind.shell) {
            OutlinedTextField(
                value = state.prompt,
                onValueChange = onPrompt,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                label = { Text("First prompt · optional") },
                minLines = 3
            )
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(
        text = text,
        modifier = Modifier.padding(top = 12.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.labelMedium
    )
}

/** The chosen folder, or a prompt to choose one; a tap opens the picker. */
@Composable
private fun FolderField(cwd: String, onClick: () -> Unit) {
    val chosen = cwd.isNotBlank()
    val hint = MaterialTheme.colorScheme.onSurfaceVariant
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().semantics { role = Role.Button }
    ) {
        Row(
            Modifier.padding(start = 16.dp, end = 12.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (chosen) cwd else "Choose a folder…",
                modifier = Modifier.weight(1f),
                color = if (chosen) Color.Unspecified else hint,
                fontFamily = if (chosen) FontFamily.Monospace else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
    }
}
