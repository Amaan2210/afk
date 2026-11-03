package io.github.amaankhan63.afk.ui.newsession

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DirEntry
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository.Create
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // setMain, resetMain, UnconfinedTestDispatcher
class NewSessionViewModelTest {
    private val repo = FakeSessionsRepository()
    private lateinit var vm: NewSessionViewModel

    private val repos = ServerMessage.FsDirs(
        id = "r1",
        path = "D:\\Repos",
        parent = "D:\\",
        dirs = listOf(DirEntry("app", "D:\\Repos\\app"), DirEntry("api", "D:\\Repos\\api")),
        recent = listOf("D:\\Repos\\app")
    )

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        vm = NewSessionViewModel(repo)
    }

    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun startSendsCreateWithArgsAndPrompt() {
        val created = mutableListOf<String>()

        vm.start { created += it }
        assertTrue("no folder yet", repo.created.isEmpty())

        vm.pick("D:\\Repos\\app")
        vm.setPrompt("Run tests")
        assertTrue(vm.ui.value.canStart)
        vm.start { created += it }
        // Still starting while the screen moves on: a second tap creates nothing.
        vm.start { created += it }

        assertEquals(
            listOf(
                Create(
                    "D:\\Repos\\app",
                    SessionKind.claude,
                    listOf("--dangerously-skip-permissions"),
                    null,
                    "Run tests"
                )
            ),
            repo.created
        )
        assertEquals(listOf("s_new"), created)
        assertTrue(vm.ui.value.starting)
        assertFalse(vm.ui.value.canStart)
    }

    @Test fun shellIgnoresPrompt() {
        vm.pick("D:\\Repos\\app")
        vm.toggleFlag("continue")
        vm.setModel("opus")
        vm.toggleFlag("model")
        vm.setPrompt("dir")
        vm.setKind(SessionKind.shell)
        vm.toggleFlag("skip")

        vm.start {}

        assertEquals(
            listOf(Create("D:\\Repos\\app", SessionKind.shell, emptyList(), null, null)),
            repo.created
        )
    }

    @Test fun browseFailureKeepsListingAndSetsError() {
        repo.listDirsResult = Result.success(repos)
        vm.browse("D:\\Repos")
        repo.listDirsResult =
            Result.failure(AfkError("bad_request", "cwd must be an absolute path to a folder"))

        vm.browse("D:\\Repos\\gone")

        assertEquals(listOf("D:\\Repos", "D:\\Repos\\gone"), repo.listedDirs)
        assertEquals(repos, vm.ui.value.browse)
        assertEquals("cwd must be an absolute path to a folder", vm.ui.value.error)

        vm.clearError()
        assertNull(vm.ui.value.error)
        assertEquals(repos, vm.ui.value.browse)
    }

    @Test fun pickSetsCwdAndClosesSheet() {
        repo.listDirsResult = Result.success(repos)
        vm.browse(null)
        assertEquals(listOf<String?>(null), repo.listedDirs)
        assertEquals(repos, vm.ui.value.browse)
        assertEquals(listOf("D:\\Repos\\app"), vm.ui.value.recent)

        vm.pick("  D:\\Repos\\api ")

        assertEquals("D:\\Repos\\api", vm.ui.value.cwd)
        assertNull(vm.ui.value.browse)
        assertEquals(listOf("D:\\Repos\\app"), vm.ui.value.recent)
    }

    @Test fun switchingKindResetsFlags() {
        vm.toggleFlag("continue")
        vm.setModel("opus")
        vm.setPrompt("Run tests")
        assertEquals(setOf("skip", "continue"), vm.ui.value.flags)

        // The agent already chosen keeps its chips.
        vm.setKind(SessionKind.claude)
        assertEquals(setOf("skip", "continue"), vm.ui.value.flags)

        vm.setKind(SessionKind.codex)
        assertEquals(emptySet<String>(), vm.ui.value.flags)
        vm.toggleFlag("yolo")
        assertEquals(setOf("yolo"), vm.ui.value.flags)

        vm.setKind(SessionKind.claude)
        assertEquals(SessionKind.claude, vm.ui.value.kind)
        assertEquals(setOf("skip"), vm.ui.value.flags)
        assertEquals("opus", vm.ui.value.model)
        assertEquals("Run tests", vm.ui.value.prompt)

        vm.toggleFlag("skip")
        assertEquals(emptySet<String>(), vm.ui.value.flags)
    }

    @Test fun startFailureClearsStartingAndSetsError() {
        val created = mutableListOf<String>()
        vm.pick("D:\\Repos\\app")
        repo.createResult = Result.failure(AfkError("disconnected", "not connected to the daemon"))

        vm.start { created += it }

        assertFalse(vm.ui.value.starting)
        assertEquals("Not connected", vm.ui.value.error)

        repo.createResult = Result.failure(AfkError("timeout", "the daemon did not answer in time"))
        vm.start { created += it }
        assertEquals("Not connected", vm.ui.value.error)

        repo.createResult = Result.failure(AfkError("bad_request", "cwd D:\\gone does not exist"))
        vm.start { created += it }
        assertEquals("cwd D:\\gone does not exist", vm.ui.value.error)
        assertTrue(vm.ui.value.canStart)
        assertEquals(3, repo.created.size)
        assertTrue(created.isEmpty())
    }
}
