package io.github.amaankhan63.afk.ui.newsession

import io.github.amaankhan63.afk.data.protocol.SessionKind

/**
 * A launch flag the new-session form offers as a chip. [label] is the flag as the agent's command
 * line gets it; a chip that [needsValue] is followed there by the value typed for it.
 */
data class FlagChip(val id: String, val label: String, val needsValue: Boolean = false)

/** The launch flags each agent offers, and the arguments a selection of them makes. */
object LaunchFlags {
    private val CLAUDE = listOf(
        FlagChip("skip", "--dangerously-skip-permissions"),
        FlagChip("continue", "--continue"),
        FlagChip("model", "--model", needsValue = true)
    )
    private val CODEX = listOf(
        FlagChip("yolo", "--dangerously-bypass-approvals-and-sandbox"),
        FlagChip("model", "--model", needsValue = true)
    )

    /** The chips of [kind], in the order the form shows them; a shell has none. */
    fun chipsFor(kind: SessionKind): List<FlagChip> = when (kind) {
        SessionKind.claude -> CLAUDE
        SessionKind.codex -> CODEX
        SessionKind.shell -> emptyList()
    }

    /**
     * The arguments of [kind]'s chips whose ids are in [selected], in chip order; ids of other
     * agents' chips are ignored. A chip that needs a value carries [model], trimmed, and is
     * dropped while that is blank.
     */
    fun args(kind: SessionKind, selected: Set<String>, model: String?): List<String> {
        val value = model?.trim().orEmpty()
        return chipsFor(kind)
            .filter { it.id in selected }
            .flatMap { chip ->
                when {
                    !chip.needsValue -> listOf(chip.label)
                    value.isEmpty() -> emptyList()
                    else -> listOf(chip.label, value)
                }
            }
    }
}
