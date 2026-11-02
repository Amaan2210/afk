package io.github.amaankhan63.afk.ui.sessions

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import io.github.amaankhan63.afk.data.connection.ConnectionState
import io.github.amaankhan63.afk.data.protocol.DaemonInfo
import io.github.amaankhan63.afk.data.protocol.DeviceInfo
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.Session
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.protocol.SessionState
import io.github.amaankhan63.afk.data.protocol.Stats
import io.github.amaankhan63.afk.data.sessions.StateFilter
import io.github.amaankhan63.afk.ui.theme.AfkTheme
import io.github.amaankhan63.afk.ui.theme.AfkThemeId
import io.github.amaankhan63.afk.ui.theme.ThemeMode
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SessionsScreenTest {
    @get:Rule val rule = createComposeRule()

    @Test fun needsInputCardIsRenderedFirstAndFabPresent() {
        rule.setContent {
            AfkTheme(AfkThemeId.Graphite, ThemeMode.Dark) {
                SessionsScreen(
                    state = sampleState(),
                    onOpen = {},
                    onNew = {},
                    onSettings = {},
                    onQuery = {},
                    onFilter = {}
                )
            }
        }
        val firstCard = rule.onNodeWithTag("session-list").onChildren().onFirst()
        firstCard.assert(hasTestTag("session-s_needs"))
        rule.onNodeWithText("New session").assertIsDisplayed()
    }

    @Test fun resumeIsOfferedOnlyForAnEndedAgentSession() {
        showScreen()

        longPress("s_needs")

        rule.onNodeWithText("Kill").assertIsDisplayed()
        rule.onNodeWithText("Resume").assertDoesNotExist()
    }

    @Test fun endedSessionOffersResumeButNotKill() {
        showScreen()

        longPress("s_ended")

        rule.onNodeWithText("Resume").assertIsDisplayed()
        rule.onNodeWithText("Kill").assertDoesNotExist()
    }

    @Test fun resumeFromTheSheet() {
        val resumed = mutableListOf<String>()
        showScreen(onResume = { resumed += it })

        longPress("s_ended")
        rule.onNodeWithText("Resume").performClick()
        rule.waitForIdle()

        assertEquals(listOf("s_ended"), resumed)
    }

    @Test fun renameStartsFromTheCurrentName() {
        val renamed = mutableListOf<Pair<String, String>>()
        showScreen(onRename = { id, name -> renamed += id to name })

        longPress("s_done")
        rule.onNodeWithText("Rename").performClick()
        val nameField = rule.onNode(hasSetTextAction() and hasAnyAncestor(isDialog()))
        nameField.assert(hasText("remote-dev"))
        nameField.performTextReplacement("afk")
        rule.onNodeWithText("Rename").performClick()
        rule.waitForIdle()

        assertEquals(listOf("s_done" to "afk"), renamed)
    }

    @Test fun killAsksFirst() {
        val killed = mutableListOf<String>()
        showScreen(onKill = { killed += it })

        longPress("s_work")
        rule.onNodeWithText("Kill").performClick()
        rule.onNodeWithText("Kill shop-estimator?").assertIsDisplayed()
        assertEquals(emptyList<String>(), killed)
        rule.onNodeWithText("Kill").performClick()
        rule.waitForIdle()

        assertEquals(listOf("s_work"), killed)
    }

    @Test fun actionsStayOpenUntilTheSessionIsRemoved() {
        val state = showScreen()

        longPress("s_work")
        rule.onNodeWithText("Rename").performClick()
        val nameField = rule.onNode(hasSetTextAction() and hasAnyAncestor(isDialog()))
        nameField.performTextReplacement("estimates")

        // The agent finishes and the Working filter hides the session: the dialog keeps the draft.
        rule.runOnIdle {
            state.value =
                state.value.copy(sessions = state.value.sessions.filterNot { it.id == "s_work" })
        }
        rule.onNodeWithTag("session-s_work").assertDoesNotExist()
        nameField.assert(hasText("estimates"))

        // The daemon removes the session: its dialog goes with it.
        rule.runOnIdle {
            val left = state.value.allSessions.filterNot { it.id == "s_work" }
            state.value = state.value.copy(allSessions = left)
        }
        rule.onNodeWithText("Rename session").assertDoesNotExist()
    }

    /** Shows [state] and returns it, so a test can change what the screen shows. */
    private fun showScreen(
        onRename: (String, String) -> Unit = { _, _ -> },
        onKill: (String) -> Unit = {},
        onResume: (String) -> Unit = {},
        state: MutableState<SessionsUiState> = mutableStateOf(sampleState())
    ): MutableState<SessionsUiState> {
        rule.setContent {
            AfkTheme(AfkThemeId.Graphite, ThemeMode.Dark) {
                SessionsScreen(
                    state = state.value,
                    onOpen = {},
                    onNew = {},
                    onSettings = {},
                    onQuery = {},
                    onFilter = {},
                    onRename = onRename,
                    onKill = onKill,
                    onResume = onResume
                )
            }
        }
        return state
    }

    private fun longPress(id: String) {
        rule.onNodeWithTag("session-list").performScrollToNode(hasTestTag("session-$id"))
        rule.onNodeWithTag("session-$id").performTouchInput { longClick() }
    }

    private val sampleSessions = listOf(
        session(
            "s_needs",
            "web-platform",
            SessionKind.claude,
            SessionState.needs_input,
            lastMessage = "Which auth approach should I use?",
            gitBranch = "feature/ci",
            subagentsRunning = 2,
            agentSessionId = "c1"
        ),
        session(
            "s_done",
            "remote-dev",
            SessionKind.claude,
            SessionState.finished,
            lastMessage = "Added README and CI workflow. Tests pass.",
            gitBranch = "main",
            agentSessionId = "c2"
        ),
        session(
            "s_work",
            "shop-estimator",
            SessionKind.codex,
            SessionState.working,
            lastMessage = "● Edit(src/parsers/estimate.ts)",
            gitBranch = "main",
            agentSessionId = "x1"
        ),
        session("s_shell", "ToolKit", SessionKind.shell, SessionState.idle),
        session(
            "s_ended",
            "api",
            SessionKind.claude,
            SessionState.ended,
            lastMessage = "Done.",
            agentSessionId = "c3"
        )
    )

    private fun sampleState() = SessionsUiState(
        sessions = sampleSessions,
        allSessions = sampleSessions,
        counts = mapOf(
            StateFilter.All to 5,
            StateFilter.NeedsYou to 1,
            StateFilter.Working to 1,
            StateFilter.Done to 2
        ),
        stats = Stats("2026-10-30T10:00:00.000Z", 13_529_146_982, 14_925_000_000, 34.0, true),
        hostname = "DESKTOP-EXAMPLE",
        connection = ConnectionState.Connected(
            ServerMessage.Hello(
                protocol = 1,
                daemon = DaemonInfo("0.1.0", "DESKTOP-EXAMPLE", "win32", "100.84.12.9"),
                device = DeviceInfo("dev_1", "Pixel")
            )
        )
    )

    private fun session(
        id: String,
        name: String,
        kind: SessionKind,
        state: SessionState,
        lastMessage: String? = null,
        gitBranch: String? = null,
        subagentsRunning: Int = 0,
        agentSessionId: String? = null
    ) = Session(
        id = id,
        name = name,
        cwd = "D:\\projects\\$name",
        kind = kind,
        state = state,
        createdAt = "2026-10-30T09:00:00.000Z",
        lastActivityAt = "2026-10-30T10:00:00.000Z",
        gitBranch = gitBranch,
        agentSessionId = agentSessionId,
        lastMessage = lastMessage,
        subagentsRunning = subagentsRunning
    )
}
