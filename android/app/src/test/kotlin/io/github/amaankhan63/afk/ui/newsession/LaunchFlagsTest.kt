package io.github.amaankhan63.afk.ui.newsession

import io.github.amaankhan63.afk.data.protocol.SessionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchFlagsTest {
    @Test fun claudeSkipProducesFlag() {
        assertEquals(
            listOf("skip", "continue", "model"),
            LaunchFlags.chipsFor(SessionKind.claude).map { it.id }
        )
        assertEquals(
            listOf("--dangerously-skip-permissions"),
            LaunchFlags.args(SessionKind.claude, setOf("skip"), null)
        )
    }

    @Test fun modelFlagCarriesValue() {
        assertEquals(
            listOf("--model", "opus"),
            LaunchFlags.args(SessionKind.claude, setOf("model"), "opus")
        )
        // Chip order, whatever the selection's; a blank model drops its flag.
        assertEquals(
            listOf("--dangerously-skip-permissions", "--continue", "--model", "opus"),
            LaunchFlags.args(SessionKind.claude, setOf("model", "continue", "skip"), " opus ")
        )
        assertEquals(
            listOf("--continue"),
            LaunchFlags.args(SessionKind.claude, setOf("continue", "model"), " ")
        )
        assertEquals(
            listOf("--dangerously-bypass-approvals-and-sandbox", "--model", "gpt-5"),
            LaunchFlags.args(SessionKind.codex, setOf("model", "yolo", "skip"), "gpt-5")
        )
    }

    @Test fun shellHasNoChips() {
        assertTrue(LaunchFlags.chipsFor(SessionKind.shell).isEmpty())
        assertEquals(
            emptyList<String>(),
            LaunchFlags.args(SessionKind.shell, setOf("skip", "model"), "opus")
        )
    }
}
