package io.github.amaankhan63.afk.ui.newsession

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.DirEntry
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import io.github.amaankhan63.afk.data.protocol.SessionKind
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository
import io.github.amaankhan63.afk.data.sessions.FakeSessionsRepository.Create
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
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

    /** The ids [vm] hands the screen from now on, until the test ends. */
    private fun TestScope.createdIds(): List<String> {
        val created = mutableListOf<String>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            vm.created.toList(created)
        }
        return created
    }

    @Test fun startSendsCreateWithArgsAndPrompt() = runTest {
        val created = createdIds()
        val reply = CompletableDeferred<Result<String>>()
        repo.createReply = reply

        vm.start()
        assertTrue("no folder yet", repo.created.isEmpty())

        vm.pick("D:\\Repos\\app")
        vm.setPrompt("Run tests")
        assertTrue(vm.ui.value.canStart)
        vm.start()
        // Still starting: a second tap creates nothing.
        assertTrue(vm.ui.value.starting)
        vm.start()
        reply.complete(Result.success("s_new"))

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
        // Over: the screen opens the session, and nothing is left waiting.
        assertFalse(vm.ui.value.starting)
    }

    /** A rotation while the session starts: its id waits for the screen that comes back. */
    @Test fun theCreatedIdWaitsForTheScreen() = runTest {
        vm.pick("D:\\Repos\\app")
        vm.start()

        val created = createdIds()

        assertEquals(listOf("s_new"), created)
    }

    @Test fun shellIgnoresPrompt() {
        vm.pick("D:\\Repos\\app")
        vm.toggleFlag("continue")
        vm.setModel("opus")
        vm.toggleFlag("model")
        vm.setPrompt("dir")
        vm.setKind(SessionKind.shell)
        vm.toggleFlag("skip")

        vm.start()

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
        assertEquals(setOf("yolo"), vm.ui.value.flags)
        vm.toggleFlag("model")
        assertEquals(setOf("yolo", "model"), vm.ui.value.flags)

        vm.setKind(SessionKind.shell)
        assertEquals(emptySet<String>(), vm.ui.value.flags)

        vm.setKind(SessionKind.claude)
        assertEquals(SessionKind.claude, vm.ui.value.kind)
        assertEquals(setOf("skip"), vm.ui.value.flags)
        assertEquals("opus", vm.ui.value.model)
        assertEquals("Run tests", vm.ui.value.prompt)

        vm.toggleFlag("skip")
        assertEquals(emptySet<String>(), vm.ui.value.flags)
    }

    @Test fun startFailureClearsStartingAndSetsError() = runTest {
        val created = createdIds()
        vm.pick("D:\\Repos\\app")
        repo.createResult = Result.failure(AfkError("disconnected", "not connected to the daemon"))

        vm.start()

        assertFalse(vm.ui.value.starting)
        assertEquals("Not connected", vm.ui.value.error)

        repo.createResult = Result.failure(AfkError("bad_request", "cwd D:\\gone does not exist"))
        vm.start()
        assertEquals("cwd D:\\gone does not exist", vm.ui.value.error)
        assertTrue(vm.ui.value.canStart)
        assertEquals(2, repo.created.size)
        assertTrue(created.isEmpty())
    }

    @Test fun createTimeoutSaysTheSessionMayHaveStarted() {
        vm.pick("D:\\Repos\\app")
        repo.createResult = Result.failure(AfkError("timeout", "the daemon did not answer in time"))

        vm.start()

        assertEquals(
            "No reply — the session may have started; check the list",
            vm.ui.value.error
        )
        assertFalse(vm.ui.value.starting)
        assertTrue(vm.ui.value.canStart)

        // Only a create can have happened anyway: an unanswered listing just says so.
        repo.listDirsResult = Result.failure(AfkError("timeout", "the daemon did not answer"))
        vm.browse(null)
        assertEquals("The laptop did not answer; try again", vm.ui.value.error)
    }

    @Test fun aTypedNameIsGivenToTheSession() {
        vm.pick("D:\\Repos\\app")
        vm.setName("  fix login  ")

        vm.start()

        assertEquals("fix login", repo.created.single().name)
    }

    @Test fun aNewerBrowseDropsTheOlderReply() {
        repo.holdListDirs = true
        vm.browse("D:\\a")
        vm.browse("D:\\b")

        repo.dirsReply("D:\\b").complete(Result.success(listing("D:\\b")))
        repo.dirsReply("D:\\a").complete(Result.success(listing("D:\\a")))

        assertEquals(listOf("D:\\a", "D:\\b"), repo.listedDirs)
        assertEquals(listing("D:\\b"), vm.ui.value.browse)
        assertEquals(listOf("D:\\b\\recent"), vm.ui.value.recent)
    }

    /** The picker shows progress while a listing is under way, and only then. */
    @Test fun browsingHoldsWhileAListingIsUnderWay() {
        repo.holdListDirs = true
        assertFalse(vm.ui.value.browsing)

        vm.browse("D:\\a")
        assertTrue(vm.ui.value.browsing)
        repo.dirsReply("D:\\a").complete(Result.success(listing("D:\\a")))
        assertFalse(vm.ui.value.browsing)

        // An older reply ends nothing: the newer listing is still under way.
        vm.browse("D:\\b")
        vm.browse("D:\\c")
        repo.dirsReply("D:\\b").complete(Result.success(listing("D:\\b")))
        assertTrue(vm.ui.value.browsing)
        repo.dirsReply("D:\\c").complete(Result.failure(AfkError("bad_request", "gone")))
        assertFalse(vm.ui.value.browsing)

        vm.browse("D:\\d")
        vm.pick("D:\\Repos\\app")
        assertFalse(vm.ui.value.browsing)
    }

    @Test fun pickDropsTheListingInFlight() {
        repo.holdListDirs = true
        vm.browse("D:\\a")

        vm.pick("D:\\Repos\\app")
        repo.dirsReply("D:\\a").complete(Result.success(listing("D:\\a")))

        assertNull(vm.ui.value.browse)
        assertEquals(emptyList<String>(), vm.ui.value.recent)
        assertEquals("D:\\Repos\\app", vm.ui.value.cwd)
    }

    @Test fun blankPromptIsNoneAndAPromptGoesAsTyped() {
        vm.pick("D:\\Repos\\app")
        vm.setPrompt("   ")
        vm.start()

        val typed = NewSessionViewModel(repo)
        typed.pick("D:\\Repos\\app")
        typed.setPrompt(" Run  tests\n")
        typed.start()

        assertEquals(listOf(null, " Run  tests\n"), repo.created.map { it.prompt })
    }

    /** A listing of [path] with one sub-folder and one recent folder, both under [path]. */
    private fun listing(path: String) = ServerMessage.FsDirs(
        id = "r_$path",
        path = path,
        parent = "D:\\",
        dirs = listOf(DirEntry("sub", "$path\\sub")),
        recent = listOf("$path\\recent")
    )
}
