# AFK Service and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the laptop side of AFK: the `afk` daemon that owns agent terminal sessions on Windows, the `afk` CLI that launches, attaches, pairs and relays hooks, and the protocol both sides share.

**Architecture:** A single Node + TypeScript package (`afkdev`, binary `afk`). The daemon spawns one PowerShell per session through node-pty (ConPTY), mirrors it into a headless xterm for snapshots, tails the agent's transcript files to build a normalised chat stream, receives hook and status-line relays over loopback HTTP, and serves everything to clients over an authenticated WebSocket on the Tailscale interface. The CLI is a thin client of that daemon plus the per-session injection that makes hand-typed `claude`/`codex` tracked.

**Tech Stack:** Node ≥ 22 (ESM), TypeScript 5 strict, `node-pty` 1.1 (prebuilt ConPTY binaries), `@xterm/headless` + `@xterm/addon-serialize`, `ws`, `zod` + `zod-to-json-schema`, `commander`, `qrcode-terminal`, `koffi` (Win32 power request), `pino`. Tests with `vitest`. Lint with ESLint + Prettier. Build with `tsc`.

**Spec:** `docs/superpowers/specs/2026-10-30-afk-design.md` (sections 4–9, 11) and `protocol/protocol.md`. The Android half is `docs/superpowers/plans/2026-10-30-afk-android-plan.md`; it consumes `protocol/examples/*.json` produced by Task 2 here.

## Global Constraints

- Node `>=22`; package name `afkdev`, version starts `0.1.0`, binary `afk`, ESM only, TypeScript `strict: true`.
- Protocol version `1`; default port `2350`; daemon binds the Tailscale IPv4 and `127.0.0.1` only; never `0.0.0.0` unless `config.bind` says so.
- Loopback HTTP relays (`afk hook`, `afk statusline`) must always exit `0`, within 2 s, even when the daemon is down.
- Never read-modify-write the user's `~/.claude/settings.json` or `~/.codex/config.toml`; injection is per session via `--settings <file>` and `-c notify=…`.
- Session-scoped PowerShell functions only; the user's profile and PATH are untouched.
- Defaults from the spec: ring buffer 2 MB, retention 24 h, keep-awake grace 10 min, detach chord `Ctrl+]` then `d`, snapshot scrollback 2000 lines.
- Config and logs under `%LOCALAPPDATA%\afk\` on Windows (`~/.config/afk` elsewhere); token files user-readable only.
- Every file has one responsibility; no source file over ~300 lines without a comment explaining why.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), one commit per task minimum.
- CI runs lint, tests and build on `windows-latest` and `ubuntu-latest`; PTY integration tests are skipped off Windows with `it.skipIf(process.platform !== "win32")`.
- MIT license at the repo root.

## Review Focus

1. **Paths with spaces and non-ASCII** (`D:\Naya Repos\…`): launch lines, `--settings` paths and profile paths must be quoted for PowerShell. Pinned in Task 5 (`renderSessionProfile`, `buildClaudeLaunch` tests) and Task 7 (`create` writes a quoted launch line).
2. **Daemon down while an agent fires hooks:** relays must not block or fail the agent. Pinned in Task 18 (relay tests against a closed port).
3. **Multi-byte UTF-8 split across PTY chunks or transcript reads:** bytes must arrive intact. Pinned in Task 6 (`SessionProcess` forwards raw bytes) and Task 8 (`JsonlTailer` partial-line test).
4. **Unknown transcript line types and unknown hook events** (new Claude Code versions): must be ignored, never throw. Pinned in Task 8 (`api-request-blob` fixture line) and Task 9 (`mapClaudeHook` unknown event).
5. **Two clients with different terminal sizes:** no resize ping-pong; the most recent input/connect wins. Pinned in Task 13 (`pty.resize` broadcast test).

---

### Task 1: Repository and service scaffold

**Files:**
- Create: `LICENSE` (MIT, holder "AFK contributors"), `README.md` (title, one-paragraph description, "Status: in development", links to the spec and plans), `CONTRIBUTING.md` (how to run service tests, commit style), `.editorconfig`
- Create: `service/package.json`, `service/tsconfig.json`, `service/vitest.config.ts`, `service/eslint.config.js`, `service/.prettierrc`, `service/src/index.ts`, `service/src/version.ts`
- Create: `.github/workflows/service.yml`
- Test: `service/test/version.test.ts`

**Interfaces:**
- Produces: `VERSION: string` exported from `service/src/version.ts` (read from `package.json` at build time via a generated file or `createRequire`); npm scripts `build`, `test`, `lint`, `format`, `typecheck`, `dev` (`tsx src/cli.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// service/test/version.test.ts
import { VERSION } from "../src/version.js";
import pkg from "../package.json" with { type: "json" };
it("exports the package version", () => { expect(VERSION).toBe(pkg.version); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd service && npm test -- version`
Expected: FAIL (module not found / npm scripts missing)

- [ ] **Step 3: Create the package**

`service/package.json`: `name: "afkdev"`, `version: "0.1.0"`, `type: "module"`, `bin: { "afk": "./dist/cli.js" }`, `engines: { node: ">=22" }`, `files: ["dist"]`, scripts above, devDependencies `typescript`, `vitest`, `tsx`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `@types/node`. `tsconfig.json`: `module: NodeNext`, `target: ES2022`, `strict`, `outDir: dist`, `rootDir: src`, `resolveJsonModule`. `src/version.ts` exports `VERSION`. `src/index.ts` re-exports `VERSION`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd service && npm install && npm test -- version`
Expected: PASS

- [ ] **Step 5: Add lint, format, CI**

`eslint.config.js` with `typescript-eslint` recommended; `.prettierrc` `{ "printWidth": 100, "semi": true, "singleQuote": false }`. `.github/workflows/service.yml`: matrix `os: [windows-latest, ubuntu-latest]`, Node 22, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, working directory `service`.

Run: `cd service && npm run lint && npm run typecheck && npm run build`
Expected: all exit 0; `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add LICENSE README.md CONTRIBUTING.md .editorconfig service .github/workflows/service.yml
git commit -m "chore: scaffold afkdev service package with CI"
```

---

### Task 2: Protocol schemas, types, examples, schema emit

**Files:**
- Create: `service/src/protocol/shared.ts`, `service/src/protocol/client.ts`, `service/src/protocol/server.ts`, `service/src/protocol/index.ts`, `service/src/protocol/emit-schema.ts`
- Create: `protocol/examples/*.json` (one file per message type listed in `protocol/protocol.md`, named `<type>.json`, e.g. `session.create.json`, `pty.data.json`, `hello.json`, `ack.session.create.json` for acks with result fields)
- Create: `protocol/afk-protocol.schema.json` (generated)
- Test: `service/test/protocol/messages.test.ts`, `service/test/protocol/examples.test.ts`

**Interfaces:**
- Produces (zod schemas and inferred types, from `service/src/protocol/index.ts`): `SessionSchema`/`Session`, `PendingSchema`/`Pending`, `ChatEventSchema`/`ChatEvent`, `StripSchema`/`Strip`, `StatsSchema`/`Stats`, `DaemonSettingsSchema`/`DaemonSettings`, `ClientMessageSchema`/`ClientMessage` (discriminated union on `type`), `ServerMessageSchema`/`ServerMessage`, `parseClientMessage(raw: unknown): ClientMessage` (throws `ZodError`), `parseServerMessage(raw: unknown): ServerMessage`, `PROTOCOL_VERSION = 1`, `DEFAULT_PORT = 2350`, `ErrorCode = "unauthorized" | "protocol_mismatch" | "bad_request" | "not_found" | "session_ended" | "internal"`.

- [ ] **Step 1: Write the failing tests**

```ts
// service/test/protocol/messages.test.ts
it("parses a session.create message", () => {
  const m = parseClientMessage({ type: "session.create", id: "r1", cwd: "D:\\p", kind: "claude", args: ["--dangerously-skip-permissions"] });
  expect(m.type).toBe("session.create");
});
it("rejects an unknown kind", () => {
  expect(() => parseClientMessage({ type: "session.create", id: "r1", cwd: "D:\\p", kind: "gemini", args: [] })).toThrow();
});
it("requires id on requests that expect a reply", () => {
  expect(() => parseClientMessage({ type: "session.kill", sessionId: "s_1" })).toThrow();
});
it("accepts a Session with pending question", () => {
  const s = SessionSchema.parse({ id: "s_abc", name: "p", cwd: "D:\\p", kind: "claude", state: "needs_input", createdAt: "2026-10-30T13:00:00.000Z", lastActivityAt: "2026-10-30T13:00:00.000Z", subagentsRunning: 0, pending: { kind: "question", id: "q1", text: "Which?", multiSelect: false, allowsText: true, options: [{ label: "A", recommended: true }, { label: "B" }] } });
  expect(s.pending?.kind).toBe("question");
});
it("exposes constants", () => { expect(PROTOCOL_VERSION).toBe(1); expect(DEFAULT_PORT).toBe(2350); });

// service/test/protocol/examples.test.ts
it.each(exampleFiles)("example %s parses with the matching schema", (file) => {
  const msg = JSON.parse(readFileSync(file, "utf8"));
  const parsed = isClientType(msg.type) ? parseClientMessage(msg) : parseServerMessage(msg);
  expect(parsed.type).toBe(msg.type);
});
it("committed JSON schema matches the emitted schema", () => {
  expect(JSON.parse(readFileSync("../protocol/afk-protocol.schema.json", "utf8"))).toEqual(buildJsonSchema());
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd service && npm test -- protocol`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement the schemas**

`shared.ts`: the five shared types from `protocol/protocol.md` §Shared types, field for field, as zod objects (`.strict()` off so additive fields pass). `client.ts`: one zod object per client message, `ClientMessageSchema = z.discriminatedUnion("type", [...])`. `server.ts`: same for daemon messages; `ack` is `z.object({ type: z.literal("ack"), id: z.string() }).passthrough()`. `index.ts`: re-exports, `parseClientMessage`, `parseServerMessage`, `PROTOCOL_VERSION`, `DEFAULT_PORT`, `ErrorCodeSchema`. `emit-schema.ts`: `buildJsonSchema(): object` via `zod-to-json-schema` with `{ $schema, title: "AFK protocol v1", definitions: { ClientMessage, ServerMessage, Session, ChatEvent, Strip, Stats, DaemonSettings } }`, and a `main` that writes `protocol/afk-protocol.schema.json`; npm script `protocol:emit`.

- [ ] **Step 4: Write the examples**

One JSON file per message type in `protocol/examples/`, using the values in `protocol/protocol.md` (port 2350, hostname `AMAN-LAPTOP`, session id `s_abcdefghijkl`, a `needs_input` session with a two-option question, a `pty.data` with base64 of `"hi\r\n"`, a `notify` for `finished`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd service && npm run protocol:emit && npm test -- protocol`
Expected: PASS; `protocol/afk-protocol.schema.json` created.

- [ ] **Step 6: Commit**

```bash
git add service/src/protocol service/test/protocol protocol/examples protocol/afk-protocol.schema.json service/package.json
git commit -m "feat(protocol): zod schemas, JSON schema emit and examples for protocol v1"
```

---

### Task 3: Session state reducer

**Files:**
- Create: `service/src/daemon/sessions/state.ts`
- Test: `service/test/daemon/sessions/state.test.ts`

**Interfaces:**
- Produces:
```ts
export type AgentSignal =
  | { kind: "turn_start" }
  | { kind: "turn_end"; lastMessage?: string }
  | { kind: "pending"; pending: Pending }
  | { kind: "pending_cleared"; pendingId?: string }
  | { kind: "subagent_start" }
  | { kind: "subagent_stop" }
  | { kind: "user_input" }
  | { kind: "process_exit"; exitCode: number };
export type NotifyKind = "needs_input" | "finished" | "subagent_finished";
export interface StateSlice { state: SessionState; pending?: Pending; subagentsRunning: number; lastMessage?: string; exitCode?: number }
export const initialSlice: StateSlice;   // { state: "idle", subagentsRunning: 0 }
export function reduce(slice: StateSlice, signal: AgentSignal): { slice: StateSlice; notify?: NotifyKind };
```

- [ ] **Step 1: Write the failing tests**

```ts
const q: Pending = { kind: "question", id: "q1", text: "Which?", multiSelect: false, allowsText: true, options: [{ label: "A" }] };
it("turn_start moves idle to working", () => expect(reduce(initialSlice, { kind: "turn_start" }).slice.state).toBe("working"));
it("pending moves working to needs_input and notifies", () => {
  const r = reduce({ ...initialSlice, state: "working" }, { kind: "pending", pending: q });
  expect(r.slice.state).toBe("needs_input"); expect(r.slice.pending).toEqual(q); expect(r.notify).toBe("needs_input");
});
it("pending_cleared returns to working and drops pending", () => {
  const r = reduce({ ...initialSlice, state: "needs_input", pending: q }, { kind: "pending_cleared", pendingId: "q1" });
  expect(r.slice.state).toBe("working"); expect(r.slice.pending).toBeUndefined();
});
it("turn_end with no sub-agents moves to finished with lastMessage and notifies", () => {
  const r = reduce({ ...initialSlice, state: "working" }, { kind: "turn_end", lastMessage: "Done." });
  expect(r.slice).toMatchObject({ state: "finished", lastMessage: "Done." }); expect(r.notify).toBe("finished");
});
it("turn_end while a sub-agent runs is ignored (no notify)", () => {
  const r = reduce({ ...initialSlice, state: "working", subagentsRunning: 1 }, { kind: "turn_end" });
  expect(r.slice.state).toBe("working"); expect(r.notify).toBeUndefined();
});
it("subagent_start/stop count and stop notifies subagent_finished, never below zero", () => {
  let s = reduce({ ...initialSlice, state: "working" }, { kind: "subagent_start" }).slice; expect(s.subagentsRunning).toBe(1);
  const r = reduce(s, { kind: "subagent_stop" }); expect(r.slice.subagentsRunning).toBe(0); expect(r.notify).toBe("subagent_finished");
  expect(reduce(r.slice, { kind: "subagent_stop" }).slice.subagentsRunning).toBe(0);
});
it("user_input moves finished to idle and leaves working alone", () => {
  expect(reduce({ ...initialSlice, state: "finished" }, { kind: "user_input" }).slice.state).toBe("idle");
  expect(reduce({ ...initialSlice, state: "working" }, { kind: "user_input" }).slice.state).toBe("working");
});
it("process_exit moves any state to ended, clears pending, records exitCode", () => {
  const r = reduce({ ...initialSlice, state: "needs_input", pending: q }, { kind: "process_exit", exitCode: 1 });
  expect(r.slice).toMatchObject({ state: "ended", exitCode: 1 }); expect(r.slice.pending).toBeUndefined();
});
it("ended ignores every other signal", () => {
  const ended: StateSlice = { ...initialSlice, state: "ended", exitCode: 0 };
  for (const sig of [{ kind: "turn_start" }, { kind: "pending", pending: q }, { kind: "user_input" }] as AgentSignal[]) expect(reduce(ended, sig).slice).toEqual(ended);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd service && npm test -- state`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `reduce` as a pure function in `state.ts`**

A `switch` on `signal.kind` applying exactly the rules in the tests; no I/O.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd service && npm test -- state`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/sessions/state.ts service/test/daemon/sessions/state.test.ts
git commit -m "feat(daemon): pure session state reducer"
```

---

### Task 4: Config, tokens, paths, logger

**Files:**
- Create: `service/src/daemon/paths.ts`, `service/src/daemon/tokens.ts`, `service/src/daemon/config.ts`, `service/src/daemon/logger.ts`
- Test: `service/test/daemon/tokens.test.ts`, `service/test/daemon/config.test.ts`

**Interfaces:**
- Produces:
```ts
// paths.ts
export function defaultConfigDir(env = process.env, platform = process.platform): string;  // %LOCALAPPDATA%\afk | ~/.config/afk
export interface AfkPaths { configDir: string; configFile: string; localTokenFile: string; logDir: string; sessionsDir: string; lockFile: string }
export function afkPaths(configDir: string): AfkPaths;
// tokens.ts
export function generateToken(): string;                 // 32 random bytes, base64url, no padding
export function hashToken(token: string): string;        // sha256 hex
export function verifyToken(token: string, hash: string): boolean;  // timing-safe
// config.ts
export interface DeviceRecord { id: string; name: string; tokenHash: string; createdAt: string; lastSeenAt?: string }
export interface DaemonConfig { port: number; bind: "tailscale" | "loopback" | string; devices: DeviceRecord[]; localTokenHash: string; settings: DaemonSettings; ringBufferBytes: number; snapshotScrollback: number; shell?: string }
export const defaultConfig: Omit<DaemonConfig, "localTokenHash">;  // port 2350, bind "tailscale", settings { keepAwake: true, keepAwakeGraceMin: 10, retentionHours: 24 }, ringBufferBytes 2097152, snapshotScrollback 2000
export async function loadConfig(paths: AfkPaths): Promise<DaemonConfig>;  // creates dir, config, and local token file (mode 0o600) on first run
export async function saveConfig(paths: AfkPaths, cfg: DaemonConfig): Promise<void>;   // atomic write (tmp + rename)
export async function readLocalToken(paths: AfkPaths): Promise<string>;
// logger.ts
export function createLogger(logDir: string, opts?: { verbose?: boolean; stdout?: boolean }): pino.Logger;  // file afk.log, rotated by size via pino/file or a daily file name
```

- [ ] **Step 1: Write the failing tests**

```ts
it("generateToken is 43 url-safe chars and unique", () => { const a = generateToken(), b = generateToken(); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b); });
it("verifyToken accepts the right token and rejects a wrong one", () => { const t = generateToken(); const h = hashToken(t); expect(verifyToken(t, h)).toBe(true); expect(verifyToken(t + "x", h)).toBe(false); });
it("loadConfig creates defaults and a local token on first run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "afk-")); const paths = afkPaths(dir);
  const cfg = await loadConfig(paths);
  expect(cfg.port).toBe(2350); expect(cfg.settings).toEqual({ keepAwake: true, keepAwakeGraceMin: 10, retentionHours: 24 });
  expect(verifyToken(await readLocalToken(paths), cfg.localTokenHash)).toBe(true);
  expect(existsSync(paths.configFile)).toBe(true);
});
it("saveConfig round-trips and a second loadConfig keeps the same local token", async () => { /* save with port 2351, reload, expect 2351 and same localTokenHash */ });
it("defaultConfigDir uses LOCALAPPDATA on win32 and ~/.config elsewhere", () => {
  expect(defaultConfigDir({ LOCALAPPDATA: "C:\\U\\x\\AppData\\Local" }, "win32")).toBe("C:\\U\\x\\AppData\\Local\\afk");
  expect(defaultConfigDir({ HOME: "/home/x" }, "linux")).toBe("/home/x/.config/afk");
});
```

- [ ] **Step 2: Run them to verify they fail** — `cd service && npm test -- daemon/tokens daemon/config` → FAIL

- [ ] **Step 3: Implement the four modules** with the signatures above; `crypto.randomBytes`, `crypto.timingSafeEqual`, `fs/promises`, `pino` with `pino.destination`.

- [ ] **Step 4: Run them to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/{paths,tokens,config,logger}.ts service/test/daemon
git commit -m "feat(daemon): config, device tokens, paths and logger"
```

---

### Task 5: Shell detection, session profile, launch spec, Claude settings injection

**Files:**
- Create: `service/src/daemon/sessions/shell.ts`, `service/src/daemon/sessions/profile.ts`, `service/src/launch/claude-settings.ts`, `service/src/launch/launch-spec.ts`, `service/src/launch/resolve-binary.ts`
- Test: `service/test/daemon/sessions/profile.test.ts`, `service/test/launch/claude-settings.test.ts`, `service/test/launch/launch-spec.test.ts`, `service/test/launch/resolve-binary.test.ts`

**Interfaces:**
- Produces:
```ts
// shell.ts
export interface ShellInfo { exe: string; kind: "pwsh" | "powershell" }
export async function detectShell(override?: string, which: (name: string) => Promise<string | undefined> = defaultWhich): Promise<ShellInfo>;  // prefers pwsh
export function shellArgs(profilePath: string): string[];  // ["-NoLogo","-NoExit","-ExecutionPolicy","Bypass","-File", profilePath]
// profile.ts
export interface ProfileOptions { sessionId: string; port: number; nodeExe: string; cliEntry: string }
export function renderSessionProfile(o: ProfileOptions): string;   // PowerShell text
// claude-settings.ts
export interface ClaudeHookTarget { nodeExe: string; cliEntry: string }
export const CLAUDE_HOOK_EVENTS = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","Notification","Stop","SubagentStart","SubagentStop","SessionEnd"] as const;
export function renderClaudeSettings(t: ClaudeHookTarget): object;  // { hooks: {...}, statusLine: { type: "command", command, padding: 0 } }
// launch-spec.ts
export interface LaunchContext { sessionId: string; port: number; nodeExe: string; cliEntry: string; sessionDir: string; userArgs: string[]; realBinary: string }
export interface LaunchSpec { exe: string; args: string[]; env: Record<string, string>; filesWritten: string[] }
export async function buildClaudeLaunch(c: LaunchContext): Promise<LaunchSpec>;  // writes <sessionDir>/claude-settings.json, args = ["--settings", file, ...userArgs]
export function buildCodexLaunch(c: LaunchContext): LaunchSpec;                 // args = ["-c", `notify=["<node>","<cli>","hook","codex-notify"]`, ...userArgs]
// resolve-binary.ts
export function resolveAgentBinary(name: "claude" | "codex", env = process.env, platform = process.platform): string | undefined;  // first PATH hit of name + PATHEXT, skipping dirs under the afk package
```

- [ ] **Step 1: Write the failing tests**

```ts
// profile.test.ts
const p = renderSessionProfile({ sessionId: "s_x", port: 2350, nodeExe: "C:\\Program Files\\nodejs\\node.exe", cliEntry: "D:\\Naya Repos\\afk\\service\\dist\\cli.js" });
it("defines claude and codex functions that call afk exec with splatted args", () => {
  expect(p).toMatch(/function claude \{[\s\S]*& "C:\\Program Files\\nodejs\\node\.exe" "D:\\Naya Repos\\afk\\service\\dist\\cli\.js" exec claude @args/);
  expect(p).toMatch(/function codex \{[\s\S]*exec codex @args/);
});
it("exports session env vars", () => { expect(p).toContain(`$env:AFK_SESSION_ID = "s_x"`); expect(p).toContain(`$env:AFK_PORT = "2350"`); });
it("does not dot-source or modify the user's profile", () => { expect(p).not.toMatch(/\$PROFILE/); });

// claude-settings.test.ts
const s = renderClaudeSettings({ nodeExe: "C:\\n\\node.exe", cliEntry: "D:\\a b\\cli.js" }) as any;
it("registers all nine hook events with the quoted relay command", () => {
  for (const ev of CLAUDE_HOOK_EVENTS) expect(s.hooks[ev][0].hooks[0].command).toBe(`"C:\\n\\node.exe" "D:\\a b\\cli.js" hook ${ev}`);
});
it("scopes PreToolUse and PostToolUse to AskUserQuestion", () => { expect(s.hooks.PreToolUse[0].matcher).toBe("AskUserQuestion"); expect(s.hooks.PostToolUse[0].matcher).toBe("AskUserQuestion"); });
it("sets the statusLine relay", () => { expect(s.statusLine).toEqual({ type: "command", command: `"C:\\n\\node.exe" "D:\\a b\\cli.js" statusline`, padding: 0 }); });

// launch-spec.test.ts
it("buildClaudeLaunch writes settings and prepends --settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "afk-"));
  const spec = await buildClaudeLaunch({ sessionId: "s_x", port: 2350, nodeExe: "n", cliEntry: "c", sessionDir: dir, userArgs: ["--dangerously-skip-permissions"], realBinary: "C:\\u\\claude.exe" });
  expect(spec.exe).toBe("C:\\u\\claude.exe");
  expect(spec.args).toEqual(["--settings", join(dir, "claude-settings.json"), "--dangerously-skip-permissions"]);
  expect(spec.env).toMatchObject({ AFK_SESSION_ID: "s_x", AFK_PORT: "2350" });
  expect(JSON.parse(readFileSync(join(dir, "claude-settings.json"), "utf8")).hooks.Stop).toBeDefined();
});
it("buildCodexLaunch injects notify via -c", () => {
  const spec = buildCodexLaunch({ sessionId: "s_x", port: 2350, nodeExe: "C:\\n\\node.exe", cliEntry: "D:\\a b\\cli.js", sessionDir: "x", userArgs: ["--yolo"], realBinary: "codex" });
  expect(spec.args[0]).toBe("-c");
  expect(spec.args[1]).toBe(`notify=["C:\\\\n\\\\node.exe","D:\\\\a b\\\\cli.js","hook","codex-notify"]`);
  expect(spec.args.slice(2)).toEqual(["--yolo"]);
});

// resolve-binary.test.ts
it("finds claude.exe on PATH and skips the afk package dir", () => { /* temp dirs: one containing claude.exe, PATH with afk dir first; expect the temp dir hit */ });
it("returns undefined when absent", () => { expect(resolveAgentBinary("codex", { PATH: "" }, "win32")).toBeUndefined(); });
```

- [ ] **Step 2: Run them to verify they fail** — `cd service && npm test -- profile claude-settings launch-spec resolve-binary` → FAIL

- [ ] **Step 3: Implement the five modules.** The profile also prints one dim line on start (`afk session s_x · detach: Ctrl+] d`) and sets `$Host.UI.RawUI.WindowTitle`. TOML string escaping for the notify array: backslashes doubled, quotes escaped.

- [ ] **Step 4: Run them to verify they pass** — PASS

- [ ] **Step 5: Verify `--settings` precedence against the real Claude Code (manual, Windows)**

Run: `claude --settings <generated file> --print "say hi"` with a generated settings file whose statusLine command writes to a temp file, and confirm the file is written and the user's hooks still fire (watch the Telegram hook). Record the result in `docs/notes/claude-settings-precedence.md`. If `statusLine` from `--settings` does **not** win, change `renderClaudeSettings` to omit `statusLine` and have Task 18's `afk statusline` be installed via the user's settings with instructions in the README (documented fallback from the spec).

Also run `codex -c 'notify=["node","<path to a script that appends its argv to a temp file>"]' exec "say hi"` and confirm the script receives an `agent-turn-complete` JSON argument. If Codex 0.166 rejects the key or uses `[tui] notifications`, update `buildCodexLaunch` and its test to the working form and record it in the same notes file.

- [ ] **Step 6: Commit**

```bash
git add service/src/daemon/sessions/{shell,profile}.ts service/src/launch service/test docs/notes
git commit -m "feat(launch): session profile, Claude settings injection and launch specs"
```

---

### Task 6: PTY session process with headless terminal and ring buffer

**Files:**
- Create: `service/src/util/ring-buffer.ts`, `service/src/daemon/sessions/pty.ts`, `service/src/daemon/sessions/session-process.ts`
- Test: `service/test/util/ring-buffer.test.ts`, `service/test/daemon/sessions/session-process.test.ts`, `service/test/daemon/sessions/pty.integration.test.ts`

**Interfaces:**
- Produces:
```ts
// ring-buffer.ts
export class RingBuffer { constructor(capacity: number); push(chunk: Buffer): void; toBuffer(): Buffer; readonly length: number }
// pty.ts
export interface PtyLike { readonly pid: number; write(data: string | Buffer): void; resize(cols: number, rows: number): void; kill(): void; onData(cb: (data: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void }
export interface PtySpawnOptions { exe: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
export type PtyFactory = (o: PtySpawnOptions) => PtyLike;
export const nodePtyFactory: PtyFactory;   // node-pty with name "xterm-256color", useConpty true
// session-process.ts
export interface SessionProcessOptions extends PtySpawnOptions { ptyFactory: PtyFactory; ringBufferBytes: number; snapshotScrollback: number }
export class SessionProcess {
  constructor(o: SessionProcessOptions);
  readonly pid: number; readonly cols: number; readonly rows: number;
  write(bytes: Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  snapshot(): { cols: number; rows: number; data: Buffer };   // serialized headless terminal incl. scrollback
  onData(cb: (chunk: Buffer) => void): () => void;
  onExit(cb: (exitCode: number) => void): () => void;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// ring-buffer.test.ts
it("keeps only the last capacity bytes", () => { const r = new RingBuffer(4); r.push(Buffer.from("abc")); r.push(Buffer.from("def")); expect(r.toBuffer().toString()).toBe("cdef"); expect(r.length).toBe(4); });
it("handles a chunk larger than capacity", () => { const r = new RingBuffer(2); r.push(Buffer.from("abcd")); expect(r.toBuffer().toString()).toBe("cd"); });

// session-process.test.ts (fake pty)
function fakePty() { /* returns PtyLike with .emitData(str), .emitExit(code), .written: Buffer[] , .size */ }
it("forwards written bytes to the pty", () => { /* write(Buffer.from("ls\r")) → fake.written[0] equals */ });
it("emits raw chunks and keeps multi-byte characters intact across chunk boundaries", () => {
  // emit "é" split as two chunks (0xC3 then 0xA9); concat of received chunks decodes to "é"
});
it("snapshot contains text written to the terminal", () => { /* emitData("hello\r\n"); expect(snapshot().data.toString()).toContain("hello") */ });
it("snapshot reflects the latest resize", () => { /* resize(100, 30); expect(snapshot()).toMatchObject({ cols: 100, rows: 30 }) and fake.size updated */ });
it("exit propagates the code", () => { /* emitExit(3) → onExit cb called with 3 */ });

// pty.integration.test.ts
it.skipIf(process.platform !== "win32")("spawns PowerShell, echoes, snapshots, exits", async () => {
  const p = new SessionProcess({ exe: "powershell.exe", args: ["-NoLogo", "-NoProfile"], cwd: process.cwd(), env: process.env as any, cols: 80, rows: 24, ptyFactory: nodePtyFactory, ringBufferBytes: 1 << 20, snapshotScrollback: 200 });
  const out = await collectUntil(p, "afk-ok", 15000, () => p.write(Buffer.from("Write-Output afk-ok\r")));
  expect(out).toContain("afk-ok"); expect(p.snapshot().data.toString()).toContain("afk-ok");
  p.write(Buffer.from("exit\r")); expect(await exitCode(p, 5000)).toBe(0);
});
```

- [ ] **Step 2: Run them to verify they fail** — FAIL

- [ ] **Step 3: Implement.** `SessionProcess` creates `new Terminal({ cols, rows, scrollback, allowProposedApi: true })` from `@xterm/headless`, loads `SerializeAddon`, writes every pty chunk to both the terminal and the `RingBuffer`, and `snapshot()` returns `Buffer.from(serialize.serialize({ scrollback }))`. node-pty delivers strings; convert with `Buffer.from(data, "utf8")` only at the boundary and keep `Buffer` everywhere else.

- [ ] **Step 4: Run them to verify they pass** — PASS on Windows; integration test skipped elsewhere.

- [ ] **Step 5: Commit**

```bash
git add service/src/util/ring-buffer.ts service/src/daemon/sessions/{pty,session-process}.ts service/test
git commit -m "feat(daemon): PTY session process with headless terminal snapshots"
```

---

### Task 7: Session registry

**Files:**
- Create: `service/src/daemon/sessions/registry.ts`, `service/src/daemon/sessions/launch-line.ts`, `service/src/daemon/sessions/git.ts`, `service/src/util/ids.ts`
- Test: `service/test/daemon/sessions/registry.test.ts`, `service/test/daemon/sessions/launch-line.test.ts`

**Interfaces:**
- Consumes: `SessionProcess`, `PtyFactory` (Task 6); `reduce`, `AgentSignal` (Task 3); `detectShell`, `shellArgs`, `renderSessionProfile` (Task 5); `Session` (Task 2).
- Produces:
```ts
// ids.ts
export function newSessionId(): string;   // "s_" + 12 lowercase base32 chars
// launch-line.ts
export function buildLaunchLine(kind: SessionKind, args: string[], prompt?: string): string | undefined;  // "claude --x \"prompt\"\r"; undefined for shell; throws on shell with args/prompt
// git.ts
export async function currentBranch(cwd: string): Promise<string | undefined>;  // reads .git/HEAD, no child process
// registry.ts
export interface RegistryDeps { ptyFactory: PtyFactory; shell: ShellInfo; sessionsDir: string; port: number; nodeExe: string; cliEntry: string; ringBufferBytes: number; snapshotScrollback: number; retentionHours: number; now?: () => Date; baseEnv?: Record<string, string> }
export interface CreateOptions { cwd: string; kind: SessionKind; args: string[]; name?: string; prompt?: string; cols?: number; rows?: number }
export interface SessionRecord { session: Session; process?: SessionProcess; meta: { transcriptPath?: string; rolloutPath?: string } }
export class SessionRegistry extends EventEmitter {
  constructor(deps: RegistryDeps);
  create(o: CreateOptions): Promise<Session>;
  get(id: string): SessionRecord | undefined;
  list(): Session[];
  kill(id: string): void;
  rename(id: string, name: string): void;
  resume(id: string): Promise<Session>;          // new session, same cwd, "claude --resume <agentSessionId>" / "codex resume <id>"
  signal(id: string, s: AgentSignal): void;      // reduce + emit "updated" (+ "notify")
  setMeta(id: string, m: Partial<SessionRecord["meta"]> & Partial<Pick<Session, "kind" | "agentSessionId" | "lastMessage">>): void;
  input(id: string, bytes: Buffer): void;        // write + signal user_input
  pruneEnded(): void;                            // remove ended sessions older than retentionHours
  stopAll(): void;
}
// events: "updated" (Session), "removed" (sessionId), "notify" ({ kind: NotifyKind; session: Session }), "data" (sessionId, Buffer), "exit" (sessionId, code)
```

- [ ] **Step 1: Write the failing tests**

```ts
// launch-line.test.ts
it("quotes the prompt and ends with CR", () => expect(buildLaunchLine("claude", ["--dangerously-skip-permissions"], 'Fix "it"')).toBe('claude --dangerously-skip-permissions "Fix `"it`""\r'));
it("codex and shell", () => { expect(buildLaunchLine("codex", [], undefined)).toBe("codex\r"); expect(buildLaunchLine("shell", [], undefined)).toBeUndefined(); expect(() => buildLaunchLine("shell", ["x"], undefined)).toThrow(); });

// registry.test.ts (fake pty factory from Task 6 tests; deps.now injectable)
it("create spawns the shell with the session profile in cwd and names after the folder", async () => {
  const s = await reg.create({ cwd: "D:\\Naya Repos\\web-platform", kind: "shell", args: [] });
  expect(s.name).toBe("web-platform"); expect(s.state).toBe("idle"); expect(s.kind).toBe("shell");
  expect(fake.lastSpawn.args).toEqual(["-NoLogo","-NoExit","-ExecutionPolicy","Bypass","-File", join(deps.sessionsDir, s.id, "profile.ps1")]);
  expect(fake.lastSpawn.env.AFK_SESSION_ID).toBe(s.id);
});
it("create for claude types the launch line after the first output chunk", async () => {
  const s = await reg.create({ cwd: "D:\\p", kind: "claude", args: ["--dangerously-skip-permissions"], prompt: "Add login" });
  fake.emitData("PS D:\\p> "); await tick();
  expect(fake.written.map(String)).toContain('claude --dangerously-skip-permissions "Add login"\r');
  expect(s.kind).toBe("claude");
});
it("kill ends the session and emits updated with state ended", async () => { /* kill → fake.killed true; emitExit(0) → list()[0].state "ended" */ });
it("signal applies the reducer and emits notify", async () => { /* signal turn_start; signal turn_end { lastMessage } → updated finished + notify finished */ });
it("pruneEnded removes ended sessions older than retentionHours", async () => { /* now() advanced 25h → removed event */ });
it("resume creates a new session running claude --resume <id>", async () => { /* ended session with agentSessionId "abc" → new session, launch line 'claude --resume abc\r' */ });
it("input writes bytes and moves finished to idle", async () => { /* state finished; input(Buffer.from("x")) → written, state idle */ });
```

- [ ] **Step 2: Run them to verify they fail** — FAIL

- [ ] **Step 3: Implement.** `create` writes `profile.ps1` into `<sessionsDir>/<id>/`, spawns through `SessionProcess` with `env = { ...baseEnv, AFK_SESSION_ID, AFK_PORT }`, subscribes `onData` (emit `"data"`, bump `lastActivityAt`), `onExit` (signal `process_exit`, emit `"exit"`), types the launch line on the first output chunk or after 3 s, whichever first. `gitBranch` is read on create and refreshed on each `signal`. Keep `registry.ts` under 300 lines by putting record bookkeeping in a small `record.ts` if needed.

- [ ] **Step 4: Run them to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/sessions service/src/util/ids.ts service/test/daemon/sessions
git commit -m "feat(daemon): session registry with launch lines, resume and retention"
```

---

### Task 8: JSONL tailer and Claude transcript normaliser

**Files:**
- Create: `service/src/daemon/agents/tail.ts`, `service/src/daemon/agents/summarize.ts`, `service/src/daemon/agents/claude/transcript.ts`, `service/src/daemon/agents/claude/subagents.ts`
- Create fixtures: `service/test/fixtures/claude/main.jsonl`, `service/test/fixtures/claude/agent-abc123.jsonl`
- Test: `service/test/daemon/agents/tail.test.ts`, `service/test/daemon/agents/summarize.test.ts`, `service/test/daemon/agents/claude/transcript.test.ts`, `service/test/daemon/agents/claude/subagents.test.ts`

**Interfaces:**
- Produces:
```ts
// tail.ts
export class JsonlTailer extends EventEmitter { constructor(path: string, opts?: { pollMs?: number; fromStart?: boolean }); start(): void; stop(): void }
// events: "line" (obj: unknown, lineNo: number), "reset" (file truncated/replaced), "error" (never thrown for malformed JSON: such lines are skipped)
// summarize.ts
export function summarizeToolInput(name: string, input: unknown): string;
// Bash → input.command; Edit|Write|Read|NotebookEdit → input.file_path; Grep → `${pattern} in ${path}` (or pattern); Glob → pattern; Agent → description; WebSearch → query; WebFetch → url; default → first string value, truncated to 60 chars with "…"
// claude/transcript.ts
export class ClaudeTranscriptNormalizer {
  constructor(threadId: string);
  push(line: unknown): ChatEvent[];        // 0..n events (upserts by id)
  readonly lastAssistantText: string | undefined;
  readonly pendingQuestion: Pending | undefined;   // from an AskUserQuestion tool_use with no result yet
  readonly subagentLinks: ReadonlyMap<string, string>;  // tool_use id → threadId "agent-<id>"
}
// claude/subagents.ts
export function subagentDirFor(transcriptPath: string): string;      // <dir>/<sessionId>/subagents
export function threadIdForAgentFile(file: string): string;          // "agent-abc123.jsonl" → "agent-abc123"
export class SubagentWatcher extends EventEmitter { constructor(dir: string, pollMs?: number); start(): void; stop(): void }  // "file" (path, threadId)
```

- [ ] **Step 1: Write the fixtures exactly**

`main.jsonl` (one JSON object per line):
1. `{"type":"last-prompt","leafUuid":"u9","sessionId":"sess-1"}`
2. `{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":"sess-1"}`
3. `{"parentUuid":null,"isSidechain":false,"type":"user","uuid":"u1","timestamp":"2026-10-30T13:35:00.000Z","sessionId":"sess-1","cwd":"D:\\p","message":{"role":"user","content":"Add login to the API"}}`
4. `{"parentUuid":"u1","isSidechain":false,"type":"assistant","uuid":"a1","timestamp":"2026-10-30T13:35:02.000Z","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"text","text":"I'll check how sessions are handled today."}]}}`
5. `{"parentUuid":"a1","isSidechain":false,"type":"assistant","uuid":"a2","timestamp":"2026-10-30T13:35:03.000Z","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_1","name":"Grep","input":{"pattern":"session","path":"src/"}}]}}`
6. `{"parentUuid":"a2","isSidechain":false,"type":"user","uuid":"u2","timestamp":"2026-10-30T13:35:04.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"Found 14 matches in 6 files"}]}}`
7. `{"parentUuid":"u2","isSidechain":false,"type":"assistant","uuid":"a3","timestamp":"2026-10-30T13:35:05.000Z","message":{"id":"msg_3","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_2","name":"Agent","input":{"subagent_type":"Explore","description":"find existing auth code","prompt":"Find auth code"}}]}}`
8. `{"parentUuid":"a3","isSidechain":false,"type":"user","uuid":"u3","timestamp":"2026-10-30T13:35:30.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"Auth lives in src/auth.ts"}]},"toolUseResult":{"agentId":"abc123"}}`
9. `{"parentUuid":"u3","isSidechain":false,"type":"assistant","uuid":"a4","timestamp":"2026-10-30T13:35:31.000Z","message":{"id":"msg_4","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_3","name":"AskUserQuestion","input":{"questions":[{"question":"Which auth approach should I use?","header":"Auth","multiSelect":false,"options":[{"label":"Session cookies (Recommended)","description":"Matches the existing app"},{"label":"JWT in Authorization header","description":"Stateless"}]}]}}]}}`
10. `{"type":"api-request-blob","sessionId":"sess-1","hash":"x","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"must be ignored"}]}}`
11. `{"parentUuid":"a4","isSidechain":false,"type":"assistant","uuid":"a5","timestamp":"2026-10-30T13:36:00.000Z","message":{"id":"msg_5","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_4","name":"Bash","input":{"command":"npm test","description":"Run tests"}}]}}`
12. `{"parentUuid":"a5","isSidechain":false,"type":"user","uuid":"u4","timestamp":"2026-10-30T13:36:09.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_4","content":"1 failing","is_error":true}]}}`

`agent-abc123.jsonl`:
1. `{"type":"fork-context-ref","agentId":"abc123","parentSessionId":"sess-1","parentLastUuid":"a3","contextLength":10}`
2. `{"parentUuid":null,"isSidechain":true,"agentId":"abc123","type":"user","uuid":"s1","timestamp":"2026-10-30T13:35:06.000Z","message":{"role":"user","content":"Find auth code"}}`
3. `{"parentUuid":"s1","isSidechain":true,"agentId":"abc123","type":"assistant","uuid":"s2","timestamp":"2026-10-30T13:35:07.000Z","message":{"id":"msg_s1","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"tool_use","id":"toolu_s1","name":"Read","input":{"file_path":"src/auth.ts"}}]}}`
4. `{"parentUuid":"s2","isSidechain":true,"agentId":"abc123","type":"user","uuid":"s3","timestamp":"2026-10-30T13:35:08.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_s1","content":"export function login(){}"}]}}`
5. `{"parentUuid":"s3","isSidechain":true,"agentId":"abc123","type":"assistant","uuid":"s4","timestamp":"2026-10-30T13:35:09.000Z","message":{"id":"msg_s2","type":"message","role":"assistant","model":"claude-fable-5-1","content":[{"type":"text","text":"Auth lives in src/auth.ts"}]}}`

- [ ] **Step 2: Write the failing tests**

```ts
// tail.test.ts
it("emits existing lines then appended lines, skipping malformed JSON", async () => { /* write 2 lines, start, append "{bad", append a valid line; expect 3 line events in order */ });
it("handles a line whose bytes arrive in two writes (multi-byte split)", async () => { /* write first half of a line containing "é" cut between its two bytes, then the rest + "\n"; expect one line event with the intact text */ });
it("emits reset when the file is truncated and resumes from the start", async () => {});
it("waits for a file that does not exist yet", async () => { /* start, then create file with a line; expect the line */ });

// summarize.test.ts
it.each([
  ["Bash", { command: "npm test" }, "npm test"],
  ["Edit", { file_path: "src/a.ts", old_string: "x" }, "src/a.ts"],
  ["Grep", { pattern: "session", path: "src/" }, "session in src/"],
  ["Grep", { pattern: "session" }, "session"],
  ["Agent", { subagent_type: "Explore", description: "find auth" }, "find auth"],
  ["Unknown", { foo: "a".repeat(80) }, "a".repeat(60) + "…"],
])("%s", (name, input, out) => expect(summarizeToolInput(name, input)).toBe(out));

// claude/transcript.test.ts
const lines = readFixtureLines("claude/main.jsonl"); const n = new ClaudeTranscriptNormalizer("main"); const events = lines.flatMap((l) => n.push(l));
it("ignores meta and api-request lines", () => { expect(events.filter((e) => e.id.startsWith("toolu_1")).length).toBe(2); });  // running + ok, not a third from line 10
it("emits user and assistant text", () => {
  expect(events[0]).toMatchObject({ kind: "user", threadId: "main", text: "Add login to the API", at: "2026-10-30T13:35:00.000Z", id: "u1" });
  expect(events[1]).toMatchObject({ kind: "assistant", text: "I'll check how sessions are handled today.", id: "a1" });
});
it("emits Grep running then ok with the result", () => {
  const [run, ok] = events.filter((e) => e.id === "toolu_1");
  expect(run.tool).toEqual({ name: "Grep", summary: "session in src/", status: "running", input: JSON.stringify({ pattern: "session", path: "src/" }) });
  expect(ok.tool).toMatchObject({ status: "ok", result: "Found 14 matches in 6 files" });
});
it("emits a subagent event linked to agent-abc123 and marks it done on result", () => {
  const [start, done] = events.filter((e) => e.id === "toolu_2");
  expect(start).toMatchObject({ kind: "subagent", subagent: { name: "Explore", task: "find existing auth code", status: "running", toolUses: 0 } });
  expect(done.subagent).toMatchObject({ status: "done", threadId: "agent-abc123" });
  expect(n.subagentLinks.get("toolu_2")).toBe("agent-abc123");
});
it("emits a question with recommended flag parsed from the label", () => {
  const q = events.find((e) => e.id === "toolu_3")!;
  expect(q.kind).toBe("question");
  expect(q.pending).toEqual({ kind: "question", id: "toolu_3", text: "Which auth approach should I use?", multiSelect: false, allowsText: true, options: [{ label: "Session cookies", description: "Matches the existing app", recommended: true }, { label: "JWT in Authorization header", description: "Stateless" }] });
  expect(n.pendingQuestion?.id).toBe("toolu_3");
});
it("marks a tool error from is_error and tracks lastAssistantText", () => {
  expect(events.filter((e) => e.id === "toolu_4").at(-1)!.tool!.status).toBe("error");
  expect(n.lastAssistantText).toBe("I'll check how sessions are handled today.");
});

// subagents.test.ts
it("derives the subagent dir and thread id", () => {
  expect(subagentDirFor("C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl")).toBe("C:\\u\\.claude\\projects\\D--p\\sess-1\\subagents");
  expect(threadIdForAgentFile("agent-abc123.jsonl")).toBe("agent-abc123");
});
it("SubagentWatcher reports new agent files", async () => { /* temp dir; start; create agent-x.jsonl; expect "file" with threadId "agent-x" */ });
it("normalises the sub-agent fixture with threadId agent-abc123", () => {
  const n = new ClaudeTranscriptNormalizer("agent-abc123"); const ev = readFixtureLines("claude/agent-abc123.jsonl").flatMap((l) => n.push(l));
  expect(ev.map((e) => e.kind)).toEqual(["user", "tool", "tool", "assistant"]); expect(ev.every((e) => e.threadId === "agent-abc123")).toBe(true);
});
```

- [ ] **Step 3: Run them to verify they fail** — FAIL

- [ ] **Step 4: Implement.** Only lines with top-level `type` `"user"` or `"assistant"` and a `message` object produce events; everything else is ignored. Event ids: `uuid` for text events, the tool_use id for tool/subagent/question events. `recommended` is true when the label contains `(Recommended)` (case-insensitive), which is then stripped from the label. A question's `pending` is cleared when a `tool_result` for its id arrives. The normaliser keeps a map of open tool ids → event so results can upsert.

- [ ] **Step 5: Run them to verify they pass** — PASS

- [ ] **Step 6: Commit**

```bash
git add service/src/daemon/agents service/test/daemon/agents service/test/fixtures/claude
git commit -m "feat(agents): JSONL tailer and Claude transcript normaliser with sub-agent threads"
```

---

### Task 9: Claude hooks and status-line mapping

**Files:**
- Create: `service/src/daemon/agents/claude/hooks.ts`, `service/src/daemon/agents/claude/statusline.ts`
- Create fixtures: `service/test/fixtures/claude/hooks/*.json` (one per event as listed below), `service/test/fixtures/claude/statusline.json`
- Test: `service/test/daemon/agents/claude/hooks.test.ts`, `service/test/daemon/agents/claude/statusline.test.ts`

**Interfaces:**
- Consumes: `AgentSignal` (Task 3), `Pending`, `Strip` (Task 2).
- Produces:
```ts
export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number];
export interface HookMapping { signals: AgentSignal[]; meta?: { agentSessionId?: string; transcriptPath?: string; cwd?: string } }
export function mapClaudeHook(event: string, payload: unknown): HookMapping;   // unknown event or malformed payload → { signals: [] }
export function pendingFromAskUserQuestion(toolUseId: string, toolInput: unknown): Pending | undefined;
export function mapStatusline(payload: unknown, at?: string): Strip;
```

- [ ] **Step 1: Write the fixtures**

- `SessionStart.json`: `{"session_id":"sess-1","transcript_path":"C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl","cwd":"D:\\p","hook_event_name":"SessionStart","source":"startup"}`
- `UserPromptSubmit.json`: `{"session_id":"sess-1","hook_event_name":"UserPromptSubmit","prompt":"Add login"}`
- `PreToolUse.json`: `{"session_id":"sess-1","hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_use_id":"toolu_3","tool_input":{"questions":[{"question":"Which auth approach should I use?","header":"Auth","multiSelect":false,"options":[{"label":"Session cookies (Recommended)","description":"Matches"},{"label":"JWT"}]}]}}`
- `PostToolUse.json`: `{"session_id":"sess-1","hook_event_name":"PostToolUse","tool_name":"AskUserQuestion","tool_use_id":"toolu_3","tool_response":{"answers":{}}}`
- `Notification.permission.json`: `{"session_id":"sess-1","hook_event_name":"Notification","notification_type":"permission_prompt","title":"Permission needed","message":"Claude needs your permission to use Bash"}`
- `Notification.idle.json`: `{"session_id":"sess-1","hook_event_name":"Notification","notification_type":"idle_prompt","message":"Claude is waiting for your input"}`
- `Stop.json`: `{"session_id":"sess-1","hook_event_name":"Stop","stop_hook_active":false}`
- `SubagentStart.json`: `{"session_id":"sess-1","hook_event_name":"SubagentStart","agent_id":"abc123","agent_type":"Explore"}`
- `SubagentStop.json`: `{"session_id":"sess-1","hook_event_name":"SubagentStop","agent_id":"abc123","agent_type":"Explore"}`
- `statusline.json`: `{"session_id":"sess-1","transcript_path":"C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl","cwd":"D:\\p","version":"2.1.314","model":{"id":"claude-fable-5-1","display_name":"Fable 5.1"},"workspace":{"current_dir":"D:\\p","project_dir":"D:\\p"},"cost":{"total_cost_usd":3.6,"total_duration_ms":1920000,"total_api_duration_ms":500000,"total_lines_added":120,"total_lines_removed":8},"context_window":{"total_input_tokens":1200000,"total_output_tokens":32800,"context_window_size":200000,"used_percentage":11.0,"remaining_percentage":89.0},"rate_limits":{"five_hour":{"used_percentage":38.0,"resets_at":"2026-10-30T18:00:00Z"},"seven_day":{"used_percentage":12.5,"resets_at":"2026-11-03T00:00:00Z"}}}`

- [ ] **Step 2: Write the failing tests**

```ts
it("SessionStart yields meta only", () => expect(mapClaudeHook("SessionStart", fx("SessionStart"))).toEqual({ signals: [], meta: { agentSessionId: "sess-1", transcriptPath: "C:\\u\\.claude\\projects\\D--p\\sess-1.jsonl", cwd: "D:\\p" } }));
it("UserPromptSubmit → turn_start", () => expect(mapClaudeHook("UserPromptSubmit", fx("UserPromptSubmit")).signals).toEqual([{ kind: "turn_start" }]));
it("PreToolUse AskUserQuestion → pending question", () => {
  const [s] = mapClaudeHook("PreToolUse", fx("PreToolUse")).signals;
  expect(s).toMatchObject({ kind: "pending", pending: { kind: "question", id: "toolu_3", options: [{ label: "Session cookies", recommended: true, description: "Matches" }, { label: "JWT" }] } });
});
it("PostToolUse AskUserQuestion → pending_cleared with the id", () => expect(mapClaudeHook("PostToolUse", fx("PostToolUse")).signals).toEqual([{ kind: "pending_cleared", pendingId: "toolu_3" }]));
it("Notification permission_prompt → pending permission; idle_prompt → nothing", () => {
  expect(mapClaudeHook("Notification", fx("Notification.permission")).signals[0]).toMatchObject({ kind: "pending", pending: { kind: "permission", tool: "Bash", summary: "Claude needs your permission to use Bash" } });
  expect(mapClaudeHook("Notification", fx("Notification.idle")).signals).toEqual([]);
});
it("Stop → turn_end; SubagentStart/Stop → counters", () => {
  expect(mapClaudeHook("Stop", fx("Stop")).signals).toEqual([{ kind: "turn_end" }]);
  expect(mapClaudeHook("SubagentStart", fx("SubagentStart")).signals).toEqual([{ kind: "subagent_start" }]);
  expect(mapClaudeHook("SubagentStop", fx("SubagentStop")).signals).toEqual([{ kind: "subagent_stop" }]);
});
it("unknown event or garbage payload → no signals, no throw", () => { expect(mapClaudeHook("Whatever", {})).toEqual({ signals: [] }); expect(mapClaudeHook("Stop", "not json")).toEqual({ signals: [] }); });
it("mapStatusline extracts the strip", () => {
  expect(mapStatusline(fx("statusline"), "2026-10-30T14:00:00.000Z")).toEqual({ at: "2026-10-30T14:00:00.000Z", model: { id: "claude-fable-5-1", name: "Fable 5.1" }, contextUsedPct: 11, contextSize: 200000, costUsd: 3.6, durationMs: 1920000, fiveHourPct: 38, sevenDayPct: 12.5, tokensIn: 1200000, tokensOut: 32800 });
});
it("mapStatusline tolerates missing sections", () => expect(mapStatusline({ model: { id: "x", display_name: "X" } }, "t")).toEqual({ at: "t", model: { id: "x", name: "X" } }));
```

- [ ] **Step 3: Run them to verify they fail** — FAIL

- [ ] **Step 4: Implement.** Permission `tool` is parsed from the message (`use <Tool>`), falling back to `"unknown"`. `thinking` is omitted (not in the payload); leave a one-line comment pointing to the spec's "derive or omit".

- [ ] **Step 5: Run them to verify they pass** — PASS

- [ ] **Step 6: Commit**

```bash
git add service/src/daemon/agents/claude service/test
git commit -m "feat(agents): map Claude hook payloads to signals and status line to strip"
```

---

### Task 10: Codex rollout normaliser, locator and notify mapping

**Files:**
- Create: `service/src/daemon/agents/codex/rollout.ts`, `service/src/daemon/agents/codex/locate.ts`, `service/src/daemon/agents/codex/notify.ts`
- Create fixtures: `service/test/fixtures/codex/rollout.jsonl`, `service/test/fixtures/codex/notify.json`, `service/test/fixtures/codex/session_index.jsonl`
- Test: `service/test/daemon/agents/codex/rollout.test.ts`, `locate.test.ts`, `notify.test.ts`

**Interfaces:**
- Produces:
```ts
export class CodexRolloutNormalizer {
  constructor(threadId?: string);          // default "main"
  push(line: unknown): { events: ChatEvent[]; signals: AgentSignal[]; strip?: Strip; meta?: { threadId?: string; cwd?: string; model?: string } };
  readonly lastAssistantText: string | undefined;
}
export async function findRolloutFile(sessionsDir: string, q: { threadId?: string; cwd?: string; since?: Date }): Promise<string | undefined>;
export function mapCodexNotify(payload: unknown): { signals: AgentSignal[]; meta?: { agentSessionId?: string } };
```

- [ ] **Step 1: Write the fixtures**

`rollout.jsonl`:
1. `{"timestamp":"2026-10-30T12:33:11.636Z","ordinal":0,"type":"session_meta","payload":{"id":"thread-1","cwd":"D:\\p","model":"gpt-6-astra"}}`
2. `{"timestamp":"2026-10-30T12:33:11.700Z","ordinal":1,"type":"event_msg","payload":{"type":"task_started","turn_id":"t1","model_context_window":258400}}`
3. `{"timestamp":"2026-10-30T12:33:11.800Z","ordinal":2,"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Add login"}]}}`
4. `{"timestamp":"2026-10-30T12:33:12.000Z","ordinal":3,"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"system stuff"}]}}`
5. `{"timestamp":"2026-10-30T12:33:13.000Z","ordinal":4,"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"npm\",\"test\"]}","call_id":"c1"}}`
6. `{"timestamp":"2026-10-30T12:33:15.000Z","ordinal":5,"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"ok"}}`
7. `{"timestamp":"2026-10-30T12:33:16.000Z","ordinal":6,"type":"response_item","payload":{"type":"reasoning","summary":[]}}`
8. `{"timestamp":"2026-10-30T12:33:17.000Z","ordinal":7,"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done. Want me to commit?"}]}}`
9. `{"timestamp":"2026-10-30T12:33:17.100Z","ordinal":8,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":21720,"output_tokens":375,"total_tokens":22095},"model_context_window":258400}}}`
10. `{"timestamp":"2026-10-30T12:33:17.200Z","ordinal":9,"type":"response_item","payload":{"type":"agent_message","author":"/root","recipient":"/root/x","content":[]}}`
11. `{"timestamp":"2026-10-30T12:33:17.300Z","ordinal":10,"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1","last_agent_message":"Done. Want me to commit?"}}`

`notify.json`: `{"type":"agent-turn-complete","thread-id":"thread-1","turn-id":"t1","input-messages":["Add login"],"last-assistant-message":"Done. Want me to commit?"}`

`session_index.jsonl`: `{"id":"thread-1","thread_name":"Add login","updated_at":"2026-10-30T12:40:00.000Z"}`

- [ ] **Step 2: Write the failing tests**

```ts
const out = readFixtureLines("codex/rollout.jsonl").map((l) => n.push(l));
it("session_meta yields meta", () => expect(out[0].meta).toEqual({ threadId: "thread-1", cwd: "D:\\p", model: "gpt-6-astra" }));
it("task_started → turn_start; task_complete → turn_end with last message", () => {
  expect(out[1].signals).toEqual([{ kind: "turn_start" }]); expect(out[10].signals).toEqual([{ kind: "turn_end", lastMessage: "Done. Want me to commit?" }]);
});
it("user and assistant messages become events; developer, reasoning, agent_message are ignored", () => {
  expect(out[2].events[0]).toMatchObject({ kind: "user", text: "Add login", id: "ord-2" });
  expect(out[3].events).toEqual([]); expect(out[6].events).toEqual([]); expect(out[9].events).toEqual([]);
  expect(out[7].events[0]).toMatchObject({ kind: "assistant", text: "Done. Want me to commit?" }); expect(n.lastAssistantText).toBe("Done. Want me to commit?");
});
it("function_call and its output become a tool upsert", () => {
  expect(out[4].events[0]).toMatchObject({ id: "c1", kind: "tool", tool: { name: "shell", summary: "npm test", status: "running" } });
  expect(out[5].events[0]).toMatchObject({ id: "c1", tool: { status: "ok", result: "ok" } });
});
it("token_count yields a strip with model and context percentage", () => {
  expect(out[8].strip).toMatchObject({ model: { id: "gpt-6-astra", name: "gpt-6-astra" }, contextSize: 258400, tokensIn: 21720, tokensOut: 375 });
  expect(out[8].strip!.contextUsedPct).toBeCloseTo(8.55, 1);
});
it("mapCodexNotify → turn_end and thread id", () => expect(mapCodexNotify(fx("codex/notify"))).toEqual({ signals: [{ kind: "turn_end", lastMessage: "Done. Want me to commit?" }], meta: { agentSessionId: "thread-1" } }));
it("findRolloutFile by thread id and by cwd+since", async () => { /* temp sessionsDir with YYYY/MM/DD/rollout-…-thread-1.jsonl containing the fixture; expect path for { threadId: "thread-1" } and for { cwd: "D:\\p", since: new Date("2026-10-30T12:33:00Z") }; undefined for an unknown thread */ });
```

- [ ] **Step 3: Run them to verify they fail** — FAIL

- [ ] **Step 4: Implement.** `shell` tool summary joins the `command` array with spaces; other tools use `summarizeToolInput`. Event ids: `"ord-<ordinal>"` for messages, `call_id` for tools.

- [ ] **Step 5: Run them to verify they pass** — PASS

- [ ] **Step 6: Commit**

```bash
git add service/src/daemon/agents/codex service/test
git commit -m "feat(agents): Codex rollout normaliser, locator and notify mapping"
```

---

### Task 11: Chat hub (transcript wiring per session)

**Files:**
- Create: `service/src/daemon/agents/hub.ts`
- Test: `service/test/daemon/agents/hub.test.ts`

**Interfaces:**
- Consumes: `JsonlTailer`, `ClaudeTranscriptNormalizer`, `SubagentWatcher` (Task 8); `CodexRolloutNormalizer` (Task 10); `SessionRegistry` (Task 7).
- Produces:
```ts
export class ChatHub extends EventEmitter {
  constructor(registry: SessionRegistry, opts?: { pollMs?: number });
  attachClaude(sessionId: string, transcriptPath: string): void;    // main thread + sub-agent discovery
  attachCodex(sessionId: string, rolloutPath: string): void;
  detach(sessionId: string): void;
  history(sessionId: string, threadId: string): ChatEvent[];       // upserted, in order
  threads(sessionId: string): string[];
  latestStrip(sessionId: string): Strip | undefined;
  updateStrip(sessionId: string, strip: Strip): void;             // from the status-line relay
}
// events: "chat" ({ sessionId, threadId, event }), "strip" ({ sessionId, strip })
```

- [ ] **Step 1: Write the failing tests**

```ts
it("attachClaude replays the main fixture into history and emits chat events as lines are appended", async () => { /* copy fixture to temp; attach; expect history("s","main") length 9 distinct ids; append line → one more "chat" event */ });
it("discovers a sub-agent file and exposes its thread", async () => { /* create <session>/subagents/agent-abc123.jsonl; expect threads to include "agent-abc123" and history to have 3 ids */ });
it("forwards signals: AskUserQuestion in the transcript sets pending on the session even without a hook", async () => { /* registry.get(id).session.pending?.id === "toolu_3" */ });
it("attachCodex forwards turn signals and strips", async () => { /* after fixture: session state finished with lastMessage; latestStrip().contextSize 258400 */ });
it("emits turn events on turn_start and turn_end signals", async () => { /* registry.signal(id, { kind: "turn_end" }) → "chat" event { kind: "turn", turn: { phase: "end" }, threadId: "main" }; id is "turn-<n>" with n incrementing per session */ });
it("emits a permission chat event when a permission pending arrives and re-emits it resolved when cleared", async () => { /* registry.signal(id, { kind: "pending", pending: { kind: "permission", id: "perm-1", tool: "Bash", summary: "npm test" } }) → "chat" { kind: "permission", id: "perm-1", pending }; pending_cleared → same id without pending */ });
it("detach stops tailers (no events after append)", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** History is a per-thread ordered map keyed by event id. `lastMessage` on the session is updated from the normaliser's `lastAssistantText` on every `turn_end`.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/agents/hub.ts service/test/daemon/agents/hub.test.ts
git commit -m "feat(agents): chat hub wiring transcripts, sub-agents and strips to sessions"
```

---

### Task 12: Stats sampler and keep-awake

**Files:**
- Create: `service/src/daemon/stats.ts`, `service/src/daemon/keepawake.ts`, `service/src/daemon/power-request.ts`
- Test: `service/test/daemon/stats.test.ts`, `service/test/daemon/keepawake.test.ts`

**Interfaces:**
- Produces:
```ts
export class StatsSampler extends EventEmitter { constructor(opts?: { intervalMs?: number; os?: Pick<typeof os, "freemem" | "totalmem" | "cpus"> }); start(): void; stop(): void; current(keepAwakeActive: boolean): Stats }  // "sample" (Stats)
export interface PowerRequest { hold(): void; release(): void }
export function createPowerRequest(platform = process.platform): PowerRequest;   // win32: koffi → kernel32.SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED = 0x80000001; release with ES_CONTINUOUS = 0x80000000); elsewhere no-op
export class KeepAwakeController { constructor(req: PowerRequest, opts: { graceMs: number; now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout }); setEnabled(on: boolean): void; update(states: SessionState[]): void; readonly active: boolean }
```

- [ ] **Step 1: Write the failing tests**

```ts
it("current reports ram and cpu from os", () => { /* fake os: totalmem 16e9, freemem 4e9, cpus with times → ramUsedBytes 12e9, cpuPercent between 0 and 100 */ });
it("holds while any session is working or needs_input", () => { c.update(["idle", "working"]); expect(req.held).toBe(true); expect(c.active).toBe(true); });
it("releases only after the grace period once all are idle/finished/ended", () => { /* fake timers: update(["finished"]) → still held; advance graceMs → released */ });
it("re-holding during grace cancels the release", () => {});
it("setEnabled(false) releases immediately and ignores updates", () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** CPU percent from two consecutive `os.cpus()` samples (idle vs total deltas).

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/{stats,keepawake,power-request}.ts service/test/daemon
git commit -m "feat(daemon): system stats sampler and keep-awake controller"
```

---

### Task 13: Loopback HTTP relays and agent lifecycle routes

**Files:**
- Create: `service/src/daemon/http.ts`
- Test: `service/test/daemon/http.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry` (Task 7), `ChatHub` (Task 11), `mapClaudeHook`, `mapStatusline` (Task 9), `mapCodexNotify`, `findRolloutFile` (Task 10).
- Produces:
```ts
export interface HttpDeps { registry: SessionRegistry; hub: ChatHub; version: string; codexSessionsDir: string; log: pino.Logger; startedAt: number }
export function createHttpHandler(deps: HttpDeps): (req: IncomingMessage, res: ServerResponse) => void;   // routes from protocol.md "Loopback HTTP"
```

- [ ] **Step 1: Write the failing tests** (spin an `http.Server` on port 0 with the handler; fake registry/hub)

```ts
it("GET /health", async () => expect(await getJson("/health")).toMatchObject({ ok: true, version: "0.1.0" }));
it("POST /hooks/claude/SessionStart attaches the transcript and sets meta", async () => { /* 200; hub.attachClaude called with (sid, transcript_path); registry.setMeta agentSessionId "sess-1", kind "claude" */ });
it("POST /hooks/claude/Stop signals turn_end", async () => {});
it("POST /hooks/codex locates the rollout and signals turn_end", async () => {});
it("POST /statusline updates the strip", async () => {});
it("POST /sessions/:id/agent-start sets kind; agent-exit returns to idle keeping kind", async () => {});
it("missing X-AFK-Session → 400; unknown session → 404; non-loopback remote address → 403", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement** with Node's `http` module (no framework); body limit 1 MB; always JSON.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/http.ts service/test/daemon/http.test.ts
git commit -m "feat(daemon): loopback HTTP routes for hooks, status line and agent lifecycle"
```

---

### Task 14: Answer keystrokes and folder listing

**Files:**
- Create: `service/src/daemon/sessions/answer.ts`, `service/src/daemon/fs.ts`
- Test: `service/test/daemon/sessions/answer.test.ts`, `service/test/daemon/fs.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Answer { choiceIndices?: number[]; text?: string; decision?: "allow" | "allow_always" | "deny" }
export function keystrokesForAnswer(kind: SessionKind, pending: Pending, a: Answer): Buffer;  // table-driven; throws on invalid combos
export interface DirListing { path?: string; parent?: string; dirs: { name: string; path: string }[]; recent: string[] }
export class RecentFolders { constructor(file: string, max?: number); add(path: string): Promise<void>; list(): Promise<string[]> }
export async function listDirs(path: string | undefined, recent: RecentFolders, platform = process.platform): Promise<DirListing>;  // undefined → drive roots on win32 ("C:\\", "D:\\" that exist), "/" elsewhere; hidden dirs skipped
```

- [ ] **Step 1: Write the failing tests**

```ts
it("Claude single-choice question → digit then Enter", () => expect(keystrokesForAnswer("claude", q, { choiceIndices: [1] }).toString()).toBe("2\r"));
it("Claude permission allow/always/deny → 1/2/3", () => { expect(keystrokesForAnswer("claude", perm, { decision: "allow" }).toString()).toBe("1"); expect(keystrokesForAnswer("claude", perm, { decision: "deny" }).toString()).toBe("3"); });
it("free text → text + Enter", () => expect(keystrokesForAnswer("claude", q, { text: "Use cookies" }).toString()).toBe("Use cookies\r"));
it("rejects an out-of-range choice", () => expect(() => keystrokesForAnswer("claude", q, { choiceIndices: [9] })).toThrow());
it("listDirs on a temp tree returns sorted visible dirs and parent", async () => { /* a, b, .hidden → ["a","b"]; parent equals dirname */ });
it("recent folders are most-recent-first, deduped, capped", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement** with the keystroke table in one object at the top of `answer.ts` and a comment that Step 5 of this task verified it.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Verify the keystrokes against real prompts (manual, Windows)** — run `claude` in a session, trigger an `AskUserQuestion` (ask it to use the question tool) and, with permissions on, a Bash permission prompt; confirm which keys select and confirm; adjust the table and the tests to match; record in `docs/notes/prompt-keystrokes.md`.

- [ ] **Step 6: Commit**

```bash
git add service/src/daemon/sessions/answer.ts service/src/daemon/fs.ts service/test docs/notes
git commit -m "feat(daemon): answer keystrokes and folder listing"
```

---

### Task 15: WebSocket server

**Files:**
- Create: `service/src/daemon/ws/server.ts`, `service/src/daemon/ws/client-conn.ts`, `service/src/daemon/ws/handlers.ts`, `service/src/daemon/devices.ts`
- Test: `service/test/daemon/ws/server.test.ts`

**Interfaces:**
- Consumes: everything above; `parseClientMessage` (Task 2).
- Produces:
```ts
export interface WsDeps { config: DaemonConfig; paths: AfkPaths; registry: SessionRegistry; hub: ChatHub; stats: StatsSampler; keepAwake: KeepAwakeController; recent: RecentFolders; version: string; log: pino.Logger; saveConfig: (c: DaemonConfig) => Promise<void> }
export function attachWsServer(server: http.Server, deps: WsDeps): { close(): Promise<void>; clientCount(): number };   // path /ws
export class DeviceStore { constructor(cfg: DaemonConfig, save: (c: DaemonConfig) => Promise<void>); add(name: string): Promise<{ id: string; token: string }>; remove(id: string): Promise<void>; list(): DeviceRecord[]; authenticate(token: string): DeviceRecord | "local" | undefined }
```

- [ ] **Step 1: Write the failing tests** (real `ws` client against a server on port 0; fake registry with a fake pty)

```ts
it("rejects a non-auth first frame and a bad token with error unauthorized, then closes", async () => {});
it("protocol mismatch → error protocol_mismatch", async () => {});
it("auth with a device token → hello, sessions.snapshot, stats, daemon.settings in that order", async () => { /* hello.daemon.hostname === os.hostname(); hello.device.name "Pixel" */ });
it("session.create → ack{sessionId} and a session.updated broadcast to a second client", async () => {});
it("session.rename acks and broadcasts the new name; session.kill on an unknown id → error not_found; session.resume of an ended session acks with a new sessionId", async () => {});
it("session.resume on a session without agentSessionId → error bad_request", async () => {});
it("pty.subscribe → ack then pty.snapshot with cols/rows, then pty.data for new output (base64)", async () => { /* fake pty emitData("hi"); expect Buffer.from(data,"base64").toString() "hi" */ });
it("pty.input writes bytes; pty.resize from client B wins and client A receives pty.resized (no echo back to B)", async () => {});
it("chat.subscribe → chat.snapshot then chat.event", async () => {});
it("pending.answer writes keystrokes and acks; unknown pendingId → error not_found", async () => {});
it("notify from the registry is broadcast with title/body", async () => { /* registry emits notify finished → { type: "notify", event: "finished", title: "<name> finished", body: lastMessage } */ });
it("daemon.settings.set persists and toggles keep-awake", async () => {});
it("device.add is refused for a device token and allowed for the local token", async () => {});
it("fs.listDirs → fs.dirs", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** One `ClientConn` per socket holding its subscriptions; `handlers.ts` is a map `type → handler(conn, msg)`; broadcast helpers on the server. `lastSeenAt` updated on auth. Titles: `"<name> needs your input"`, `"<name> finished"`, `"<name>: sub-agent finished"`.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/ws service/src/daemon/devices.ts service/test/daemon/ws
git commit -m "feat(daemon): authenticated WebSocket API with subscriptions and broadcasts"
```

---

### Task 16: Daemon wiring, bind address, single instance, `afk daemon`

**Files:**
- Create: `service/src/daemon/net.ts`, `service/src/daemon/lock.ts`, `service/src/daemon/index.ts`, `service/src/cli.ts`, `service/src/cli/daemon-cmd.ts`
- Test: `service/test/daemon/net.test.ts`, `service/test/daemon/index.test.ts`

**Interfaces:**
- Produces:
```ts
export function pickBindAddresses(bind: DaemonConfig["bind"], interfaces = os.networkInterfaces()): { addresses: string[]; tailscaleIp?: string; warning?: string };  // "tailscale": 100.64.0.0/10 IPv4 + 127.0.0.1; none found → 127.0.0.1 with warning
export async function acquireLock(lockFile: string): Promise<() => Promise<void>>;   // throws "already running (pid n)" if the pid in the file is alive
export async function startDaemon(opts: { configDir?: string; port?: number; verbose?: boolean }): Promise<{ port: number; addresses: string[]; stop(): Promise<void> }>;
// cli.ts: commander program "afk" with subcommands registered from ./cli/*; `afk daemon [--verbose] [--port n]`
```

- [ ] **Step 1: Write the failing tests**

```ts
it("pickBindAddresses finds the tailscale address", () => expect(pickBindAddresses("tailscale", { eth: [{ address: "192.168.1.2", family: "IPv4", internal: false }], ts: [{ address: "100.84.12.9", family: "IPv4", internal: false }] } as any)).toEqual({ addresses: ["100.84.12.9", "127.0.0.1"], tailscaleIp: "100.84.12.9" }));
it("falls back to loopback with a warning", () => expect(pickBindAddresses("tailscale", {} as any).warning).toMatch(/Tailscale/));
it("startDaemon serves /health and accepts the local token over ws", async () => { /* temp configDir, port 0 → GET health ok; ws auth with readLocalToken → hello */ });
it("second startDaemon on the same configDir fails with already running", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** `startDaemon` composes: paths → config → logger → lock → registry → hub → stats → keep-awake → http handler + ws on one `http.Server` per address → periodic `pruneEnded` (every 10 min) and stats broadcast (5 s). `cli.ts` has a shebang and only registers commands.

- [ ] **Step 4: Run to verify they pass** — PASS; also `node dist/cli.js daemon --verbose` prints the bound addresses and port.

- [ ] **Step 5: Commit**

```bash
git add service/src/daemon/{net,lock,index}.ts service/src/cli.ts service/src/cli/daemon-cmd.ts service/test/daemon
git commit -m "feat(daemon): wire the daemon, bind to Tailscale, single instance, afk daemon command"
```

---

### Task 17: CLI client, `afk ls`, `afk kill`, `afk pair`, `afk devices`, `afk unpair`

**Files:**
- Create: `service/src/cli/client.ts`, `service/src/cli/ls.ts`, `service/src/cli/kill.ts`, `service/src/cli/pair.ts`, `service/src/cli/devices.ts`, `service/src/cli/format.ts`
- Test: `service/test/cli/client.test.ts`, `service/test/cli/pair.test.ts`, `service/test/cli/format.test.ts`

**Interfaces:**
- Produces:
```ts
export class DaemonClient { static async connectLocal(paths: AfkPaths, port: number): Promise<DaemonClient>; request<T = any>(msg: object): Promise<T>; send(msg: object): void; on(type: string, cb: (m: any) => void): () => void; readonly hello: ServerMessage; close(): void }
export function formatSessionTable(sessions: Session[], now?: Date): string;   // columns: ID NAME KIND STATE AGE BRANCH LAST
export function pairPayload(hello: any, token: string): { afk: 1; host: string; port: number; token: string };
export function renderQr(payload: object): string;   // qrcode-terminal small
```

- [ ] **Step 1: Write the failing tests**

```ts
it("connectLocal authenticates with the local token and resolves hello", async () => { /* against startDaemon from Task 16 on port 0 */ });
it("request correlates by id and rejects on error frames", async () => {});
it("formatSessionTable aligns columns and shortens LAST to 40 chars", () => {});
it("pairPayload uses the Tailscale ip and port from hello", () => expect(pairPayload({ daemon: { tailscaleIp: "100.84.12.9" } }, "tok").host).toBe("100.84.12.9"));
it("afk pair --name Pixel prints a QR and the JSON line", async () => { /* run the command function with a fake client whose device.add returns token "tok"; captured stdout contains '"token":"tok"' and a QR block */ });
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement** the commands as functions `(opts, io: { stdout, client })` so tests inject; `afk pair` prompts for a name if `--name` absent (non-interactive → "device"). Exit codes: 0 ok, 1 error, 2 daemon not running (message tells the user to run `afk service install` or `afk daemon`).

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/cli service/test/cli
git commit -m "feat(cli): daemon client, ls, kill, pair, devices"
```

---

### Task 18: `afk exec`, `afk hook`, `afk statusline` relays

**Files:**
- Create: `service/src/cli/exec.ts`, `service/src/cli/hook.ts`, `service/src/cli/statusline.ts`, `service/src/cli/post.ts`
- Test: `service/test/cli/relays.test.ts`, `service/test/cli/exec.test.ts`

**Interfaces:**
- Consumes: `buildClaudeLaunch`, `buildCodexLaunch`, `resolveAgentBinary` (Task 5).
- Produces:
```ts
export async function postLoopback(port: number, route: string, body: unknown, headers?: Record<string, string>, timeoutMs = 1500): Promise<boolean>;   // never throws
export async function runHook(event: string, io: { stdin: Readable; env: NodeJS.ProcessEnv; post: typeof postLoopback }): Promise<0>;   // "codex-notify" reads argv JSON instead of stdin
export async function runStatusline(io: { stdin: Readable; stdout: Writable; env: NodeJS.ProcessEnv; post: typeof postLoopback; userSettingsPath?: string; spawn?: typeof spawn }): Promise<number>;  // posts, then runs the user's original statusLine.command with the same JSON on stdin, relaying stdout; no original → prints nothing, exit 0
export async function runExec(agent: "claude" | "codex", args: string[], io: { env: NodeJS.ProcessEnv; spawn?: typeof spawn; post: typeof postLoopback }): Promise<number>;   // agent-start → spawn inherit → agent-exit → exit code
```

- [ ] **Step 1: Write the failing tests**

```ts
it("postLoopback resolves false quickly when nothing listens (closed port)", async () => { const t = Date.now(); expect(await postLoopback(1, "/hooks/claude/Stop", {}, {}, 300)).toBe(false); expect(Date.now() - t).toBeLessThan(1500); });
it("runHook posts stdin JSON to /hooks/claude/<event> with X-AFK-Session and returns 0", async () => { /* fake post captures route "/hooks/claude/Stop", header from env AFK_SESSION_ID */ });
it("runHook returns 0 on malformed stdin and when post fails", async () => {});
it("runHook codex-notify posts argv payload to /hooks/codex", async () => {});
it("runStatusline posts then pipes JSON to the original command and relays its stdout", async () => { /* temp settings.json with statusLine.command = `node -e "process.stdin.pipe(process.stdout)"`; stdout equals the input JSON */ });
it("runStatusline with no original command prints nothing", async () => {});
it("runExec posts agent-start, spawns the resolved binary with injected args, posts agent-exit with the code", async () => { /* fake spawn returns an emitter exiting 7; expect post calls and return 7 */ });
it("runExec fails clearly when the binary is not on PATH", async () => { /* returns 127 and prints "claude not found on PATH" */ });
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** Register `exec`, `hook`, `statusline` as hidden commands in `cli.ts`. Hooks must never print to stdout (Claude Code may interpret output); log to the daemon log dir only on `--verbose`.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Commit**

```bash
git add service/src/cli service/test/cli
git commit -m "feat(cli): exec wrapper, hook and status-line relays"
```

---

### Task 19: `afk attach`, `afk claude|codex|shell`, detach chord

**Files:**
- Create: `service/src/cli/attach.ts`, `service/src/cli/detach-detector.ts`, `service/src/cli/launch.ts`
- Test: `service/test/cli/detach-detector.test.ts`, `service/test/cli/launch.test.ts`

**Interfaces:**
- Produces:
```ts
export class DetachDetector { constructor(chord?: { first: number; second: string }); feed(bytes: Buffer): { forward: Buffer; detach: boolean } }   // default first = 0x1d (Ctrl+]), second "d"; a lone Ctrl+] followed by anything else forwards both
export async function attach(client: DaemonClient, sessionId: string, io: { stdin: ReadStream; stdout: WriteStream }): Promise<"detached" | "ended">;
export async function launch(kind: SessionKind, args: string[], io: { cwd: string; client: DaemonClient; stdin; stdout }): Promise<number>;   // session.create then attach; exit 0 on detach, the session's exitCode on ended
```

- [ ] **Step 1: Write the failing tests**

```ts
it("Ctrl+] then d detaches and forwards nothing", () => { const d = new DetachDetector(); d.feed(Buffer.from([0x1d])); expect(d.feed(Buffer.from("d"))).toEqual({ forward: Buffer.alloc(0), detach: true }); });
it("Ctrl+] then other key forwards both bytes", () => { const d = new DetachDetector(); d.feed(Buffer.from([0x1d])); expect(d.feed(Buffer.from("x")).forward).toEqual(Buffer.from([0x1d, 0x78])); });
it("chord split across feeds still works; plain bytes pass through", () => {});
it("launch creates the session from cwd with pass-through args and attaches", async () => { /* fake client records session.create { cwd, kind: "claude", args: ["--dangerously-skip-permissions"] } then pty.subscribe */ });
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement.** `attach`: `stdin.setRawMode(true)`, subscribe with `stdout.columns/rows`, write the snapshot, forward `pty.data`, forward keystrokes through `DetachDetector`, send `pty.resize` on `stdout` `resize`, restore the terminal on exit, print `[afk] detached, session <name> keeps running · afk attach <name>` on detach. `launch` registers `afk claude`, `afk codex`, `afk shell` with `.allowUnknownOption().passThroughOptions()` so agent flags pass untouched.

- [ ] **Step 4: Run to verify they pass** — PASS

- [ ] **Step 5: Manual verification on Windows Terminal**

`afk shell` → see the profile banner, run `dir`, press `Ctrl+]` `d` → detached; `afk ls` shows it `idle`; `afk attach <name>` restores the screen; `afk claude --dangerously-skip-permissions` → Claude's TUI renders and accepts input; close the window; `afk ls` still lists it; `afk attach` works. Record in `docs/notes/attach-verification.md`.

- [ ] **Step 6: Commit**

```bash
git add service/src/cli service/test/cli docs/notes
git commit -m "feat(cli): attach client with detach chord and agent launchers"
```

---

### Task 20: `afk service install|uninstall|start|stop|status`

**Files:**
- Create: `service/src/cli/service.ts`, `service/src/cli/schtasks.ts`
- Test: `service/test/cli/schtasks.test.ts`

**Interfaces:**
- Produces:
```ts
export const TASK_NAME = "AFK Daemon";
export function schtasksArgs(action: "create" | "delete" | "run" | "end" | "query", o: { nodeExe: string; cliEntry: string }): string[];
// create: ["/Create","/F","/TN",TASK_NAME,"/SC","ONLOGON","/RL","LIMITED","/TR",`"${nodeExe}" "${cliEntry}" daemon`]
export async function runService(action: "install" | "uninstall" | "start" | "stop" | "status", io: { exec: (file: string, args: string[]) => Promise<{ code: number; stdout: string }>; stdout: Writable; platform?: string }): Promise<number>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("create args register a hidden logon task running afk daemon", () => expect(schtasksArgs("create", { nodeExe: "C:\\n\\node.exe", cliEntry: "D:\\a b\\cli.js" })).toEqual(["/Create","/F","/TN","AFK Daemon","/SC","ONLOGON","/RL","LIMITED","/TR",`"C:\\n\\node.exe" "D:\\a b\\cli.js" daemon`]));
it("install runs create then run; status reports Running/Not running from query output", async () => {});
it("refuses on non-win32 with a clear message", async () => {});
```

- [ ] **Step 2: Run to verify they fail** — FAIL

- [ ] **Step 3: Implement**; `install` also prints the next steps (`afk pair`).

- [ ] **Step 4: Run to verify they pass** — PASS; manual: `afk service install` then `afk service status` → Running; `afk ls` works from a new terminal.

- [ ] **Step 5: Commit**

```bash
git add service/src/cli/{service,schtasks}.ts service/test/cli/schtasks.test.ts
git commit -m "feat(cli): install the daemon as a logon scheduled task"
```

---

### Task 21: Documentation, protocol drift check, release workflow

**Files:**
- Modify: `README.md` (replace the stub: what AFK is, how it works diagram from the spec §4, install: Tailscale on both devices → `npm i -g afkdev` → `afk service install` → `afk pair` → APK from Releases; usage of every `afk` command; limitations from spec §11; the optional `claude` shim recipe; battery note placeholder for the app)
- Create: `docs/architecture.md` (daemon modules and data flow, one paragraph each), `CHANGELOG.md`
- Modify: `.github/workflows/service.yml` (add `npm run protocol:emit && git diff --exit-code protocol/`)
- Create: `.github/workflows/release.yml` (on tag `v*`: build, test, `npm publish --provenance` with `NPM_TOKEN`; the Android plan adds the APK job)
- Test: `service/test/docs/readme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("README documents every afk command", () => { const md = readFileSync("../README.md", "utf8"); for (const c of ["afk claude", "afk codex", "afk shell", "afk attach", "afk ls", "afk kill", "afk pair", "afk devices", "afk unpair", "afk service install"]) expect(md).toContain(c); });
```

- [ ] **Step 2: Run to verify it fails** — FAIL

- [ ] **Step 3: Write the docs and workflows**

- [ ] **Step 4: Run to verify it passes**; run the full suite: `cd service && npm run lint && npm run typecheck && npm test && npm run build` → all green.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/architecture.md .github/workflows
git commit -m "docs: README, architecture notes, protocol drift check and release workflow"
```
