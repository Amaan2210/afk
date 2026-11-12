import type pino from "pino";
import type { ServerMessage } from "../../protocol/index.js";
import type { ChatHub } from "../agents/hub.js";
import type { DaemonConfig } from "../config.js";
import type { DeviceStore } from "../devices.js";
import type { RecentFolders } from "../fs.js";
import type { KeepAwakeController } from "../keepawake.js";
import type { AfkPaths } from "../paths.js";
import type { SessionRegistry } from "../sessions/registry.js";
import type { StatsSampler } from "../stats.js";
import type { AnsweredPendings } from "./answered.js";
import type { ClientConn } from "./client-conn.js";

export interface WsDeps {
  config: DaemonConfig;
  paths: AfkPaths;
  registry: SessionRegistry;
  hub: ChatHub;
  stats: StatsSampler;
  keepAwake: KeepAwakeController;
  recent: RecentFolders;
  version: string;
  log: pino.Logger;
  saveConfig: (c: DaemonConfig) => Promise<void>;
  /** Stops the daemon, for `daemon.stop`; undefined when whoever started it gave no way to. */
  requestStop?: (reason: string) => void;
  /**
   * Opens a window on this machine attached to the session, for one a phone started: no session
   * runs out of sight.
   */
  openWindow?: (sessionId: string) => void;
  /** Called once an authenticated client's socket has closed. */
  onClientGone?: () => void;
  /** Reported in `hello` when the daemon listens on a Tailscale address. */
  tailscaleIp?: string;
  /** Pause between the chunks of a `pending.answer` (default 50 ms). */
  answerChunkDelayMs?: number;
  /** How long a new socket may take to send `auth` (default 5 s). */
  authTimeoutMs?: number;
  /** Ping interval; a socket that has not answered the previous ping is dropped (default 30 s). */
  heartbeatMs?: number;
  /** How long `close()` waits for clients to finish the closing handshake (default 1 s). */
  closeGraceMs?: number;
}

/** Close codes the daemon uses besides the standard ones. */
export const CLOSE_UNAUTHORIZED = 4001;
export const CLOSE_PROTOCOL_MISMATCH = 4002;
export const CLOSE_GOING_AWAY = 1001;

/** What connections and handlers share: the daemon's parts and the other clients. */
export interface WsContext {
  readonly deps: WsDeps;
  readonly devices: DeviceStore;
  /** Pendings already answered, so a repeated answer types nothing. */
  readonly answered: AnsweredPendings;
  readonly authTimeoutMs: number;
  readonly answerChunkDelayMs: number;
  /** Saves `deps.config`; saves run one at a time, as they all write the same file. */
  save(): Promise<void>;
  /** The authenticated connections. */
  clients(): ClientConn[];
  /** Sends `msg` to every authenticated client `filter` accepts (all by default). */
  broadcast(msg: ServerMessage, filter?: (c: ClientConn) => boolean): void;
  /** Forgets a connection once its socket has closed. */
  remove(conn: ClientConn): void;
}
