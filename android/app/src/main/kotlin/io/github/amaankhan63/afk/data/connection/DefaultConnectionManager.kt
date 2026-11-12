package io.github.amaankhan63.afk.data.connection

import io.github.amaankhan63.afk.data.protocol.AfkError
import io.github.amaankhan63.afk.data.protocol.ClientMessage
import io.github.amaankhan63.afk.data.protocol.ServerMessage
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull

/**
 * [ConnectionManager] over one [AfkSocket]. A single loop in [scope] opens the socket, reads its
 * frames and events in order, and after a drop waits [backoff] before the next try.
 */
class DefaultConnectionManager(
    private val socket: AfkSocket,
    private val backoff: Backoff,
    private val scope: CoroutineScope,
    private val clientName: String
) : ConnectionManager {
    private val mutableState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    override val state: StateFlow<ConnectionState> = mutableState.asStateFlow()

    /**
     * Buffering: 64 frames, then the loop suspends until collectors catch up while later frames
     * wait in [inbox], so none is dropped. No replay: a collector sees only frames that arrive
     * after it subscribed, so subscribe before [start].
     */
    private val frames = MutableSharedFlow<ServerMessage>(extraBufferCapacity = 64)
    override val incoming: SharedFlow<ServerMessage> = frames.asSharedFlow()

    /** The socket's frames and events in the order it emitted them; unbounded, so never lossy. */
    private val inbox = Channel<Inbound>(Channel.UNLIMITED)

    /** Ends the wait before the next try; conflated, so at most one waits to be taken. */
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val pending = ConcurrentHashMap<String, CompletableDeferred<ServerMessage>>()
    private val requestCount = AtomicLong()
    private val lock = Any()

    /** The latest connect loop. Guarded by [lock]. */
    private var loop: Job? = null

    /** Held by a loop from its first open until its `finally` is done, so loops never overlap. */
    private val loopMutex = Mutex()

    init {
        // Undispatched: both subscribe before any open(). Unconfined: each value is queued on the
        // thread that emits it before the socket emits the next one, so an `error` and the close
        // right behind it reach the loop in that order.
        scope.launch(Dispatchers.Unconfined, CoroutineStart.UNDISPATCHED) {
            socket.incoming.collect { inbox.trySend(Inbound.Frame(it)) }
        }
        scope.launch(Dispatchers.Unconfined, CoroutineStart.UNDISPATCHED) {
            socket.events.collect { inbox.trySend(Inbound.Event(it)) }
        }
    }

    override fun start(endpoint: Endpoint, token: String) {
        synchronized(lock) {
            // Cancelled here, not by the new loop: a loop cancelled before it ran cancels nothing.
            loop?.cancel()
            loop = scope.launch { loopMutex.withLock { connectUntilStopped(endpoint, token) } }
        }
    }

    override fun stop() {
        synchronized(lock) { loop?.cancel() }
        socket.close()
        mutableState.value = ConnectionState.Disconnected
        failPending(ERROR_DISCONNECTED, "stopped")
    }

    override suspend fun request(msg: ClientMessage, timeoutMs: Long): ServerMessage {
        val id = "r${requestCount.incrementAndGet()}"
        val stamped = requireNotNull(msg.withRequestId(id)) {
            "${msg::class.simpleName} gets no reply"
        }
        val reply = CompletableDeferred<ServerMessage>()
        // Registered before the state check, so a connection that ends after the check fails it.
        pending[id] = reply
        try {
            if (state.value !is ConnectionState.Connected || !socket.send(stamped)) {
                throw AfkError(ERROR_DISCONNECTED, "not connected to the daemon")
            }
            return withTimeout(timeoutMs) { reply.await() }
        } finally {
            pending.remove(id)
        }
    }

    override fun send(msg: ClientMessage) {
        if (state.value is ConnectionState.Connected) socket.send(msg)
    }

    override fun onNetworkLost() {
        inbox.trySend(Inbound.NetworkLost)
    }

    override fun onNetworkAvailable() {
        wake.trySend(Unit)
    }

    /** Connects, reconnecting after drops, until cancelled, rejected or given a bad endpoint. */
    private suspend fun connectUntilStopped(endpoint: Endpoint, token: String) {
        try {
            var attempt = 0
            mutableState.value = ConnectionState.Connecting(attempt)
            while (true) {
                discardStale()
                try {
                    socket.open(endpoint, token, clientName)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // OkHttp cannot build a URL from it (bad host or port); a retry would not help.
                    fail(ERROR_BAD_ENDPOINT, e.message ?: e.javaClass.name)
                    return
                }
                when (val end = readUntilEnd()) {
                    is End.Rejected -> {
                        fail(end.error.code, end.error.message)
                        return
                    }

                    is End.Dropped -> {
                        if (end.greeted) attempt = 0
                        val wait = backoff.delayMs(attempt++)
                        // State first: a request registered after this sees it and fails fast.
                        mutableState.value = ConnectionState.Connecting(attempt)
                        failPending(ERROR_DISCONNECTED, "connection lost")
                        // A wake-up from before this drop is not about this wait.
                        wake.tryReceive()
                        withTimeoutOrNull(wait) { wake.receive() }
                    }
                }
            }
        } finally {
            socket.close()
            if (state.value !is ConnectionState.Failed) {
                mutableState.value = ConnectionState.Disconnected
            }
            failPending(ERROR_DISCONNECTED, "connection closed")
        }
    }

    /** Handles the current connection's frames until it ends or the daemon rejects this client. */
    private suspend fun readUntilEnd(): End {
        var greeted = false
        while (true) {
            when (val item = inbox.receive()) {
                is Inbound.Event -> when (item.event) {
                    is SocketEvent.Closed, is SocketEvent.Failure -> return End.Dropped(greeted)
                    SocketEvent.Opened, is SocketEvent.DecodeFailure -> Unit
                }

                // The socket would only notice when its pings run out.
                Inbound.NetworkLost -> {
                    socket.close()
                    return End.Dropped(greeted)
                }

                is Inbound.Frame -> {
                    val msg = item.message
                    if (msg is ServerMessage.Hello) {
                        greeted = true
                        mutableState.value = ConnectionState.Connected(msg)
                    }
                    msg.replyId?.let { pending.remove(it)?.complete(msg) }
                    frames.emit(msg)
                    if (msg is ServerMessage.Error && msg.id == null && msg.code in REJECTIONS) {
                        return End.Rejected(msg)
                    }
                }
            }
        }
    }

    /** Drops what an earlier connection left in the inbox; the next one has sent nothing yet. */
    private fun discardStale() {
        do {
            val stale = inbox.tryReceive()
        } while (stale.isSuccess)
    }

    /** Ends in the terminal [ConnectionState.Failed]; pending requests fail with the same code. */
    private fun fail(code: String, message: String) {
        mutableState.value = ConnectionState.Failed(code)
        failPending(code, message)
    }

    private fun failPending(code: String, message: String) {
        for (id in pending.keys) pending.remove(id)?.completeExceptionally(AfkError(code, message))
    }

    private sealed interface Inbound {
        data class Frame(val message: ServerMessage) : Inbound

        data class Event(val event: SocketEvent) : Inbound

        data object NetworkLost : Inbound
    }

    private sealed interface End {
        data class Dropped(val greeted: Boolean) : End

        data class Rejected(val error: ServerMessage.Error) : End
    }

    private companion object {
        /** Codes of the id-less `error` with which the daemon refuses this client and hangs up. */
        val REJECTIONS = setOf("unauthorized", "protocol_mismatch")
    }
}

/** The request id a frame answers, or null for a frame that answers none. */
private val ServerMessage.replyId: String?
    get() = when (this) {
        is ServerMessage.Ack -> id
        is ServerMessage.Error -> id
        is ServerMessage.FsDirs -> id
        is ServerMessage.DaemonSettingsMsg -> id
        else -> null
    }

/** This message under request id [id], or null for a message the daemon does not answer. */
private fun ClientMessage.withRequestId(id: String): ClientMessage? = when (this) {
    is ClientMessage.SessionCreate -> copy(id = id)

    is ClientMessage.SessionKill -> copy(id = id)

    is ClientMessage.SessionResume -> copy(id = id)

    is ClientMessage.SessionRename -> copy(id = id)

    is ClientMessage.PtySubscribe -> copy(id = id)

    is ClientMessage.ChatSubscribe -> copy(id = id)

    is ClientMessage.PendingAnswer -> copy(id = id)

    is ClientMessage.FsListDirs -> copy(id = id)

    is ClientMessage.DaemonSettingsGet -> copy(id = id)

    is ClientMessage.DaemonSettingsSet -> copy(id = id)

    is ClientMessage.DaemonStop -> copy(id = id)

    is ClientMessage.DeviceAdd -> copy(id = id)

    is ClientMessage.DeviceList -> copy(id = id)

    is ClientMessage.DeviceRemove -> copy(id = id)

    is ClientMessage.Auth,
    is ClientMessage.PtyUnsubscribe,
    is ClientMessage.PtyInput,
    is ClientMessage.PtyResize,
    is ClientMessage.ChatUnsubscribe -> null
}
