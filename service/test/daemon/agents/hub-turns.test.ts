import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatHub } from "../../../src/daemon/agents/hub.js";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import type { AgentSignal } from "../../../src/daemon/sessions/state.js";
import { createFakePty } from "../../helpers/fake-pty.js";

let dir: string;
let registry: SessionRegistry;
let hub: ChatHub;
let sid: string;

const markers = () =>
  hub
    .history(sid, "main")
    .filter((e) => e.kind === "turn")
    .map((e) => e.turn?.phase);
const send = (...kinds: AgentSignal["kind"][]) => {
  for (const kind of kinds) registry.signal(sid, { kind } as AgentSignal);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-hub-turns-"));
  registry = new SessionRegistry({
    ptyFactory: createFakePty().factory,
    shell: { exe: "powershell.exe", kind: "powershell" },
    sessionsDir: join(dir, "sessions"),
    port: 2350,
    nodeExe: "node.exe",
    cliEntry: "cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    baseEnv: {},
  });
  hub = new ChatHub(registry);
  sid = (await registry.create({ cwd: dir, kind: "claude", args: [] })).id;
});

afterEach(async () => {
  registry.stopAll();
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("ChatHub turn markers", () => {
  it("a turn end the reducer ignores (sub-agents still running) gets no end marker", () => {
    send("turn_start", "subagent_start", "turn_end");
    expect(registry.get(sid)!.session.state).toBe("working");
    expect(markers()).toEqual(["start"]);

    send("subagent_stop", "turn_end");
    expect(markers()).toEqual(["start", "end"]);
  });

  it("every start gets a marker: an interrupted turn followed by a new prompt shows both", () => {
    // Claude Code runs no Stop hook for an interrupted turn: two starts in a row.
    send("turn_start", "turn_start", "turn_end");
    expect(markers()).toEqual(["start", "start", "end"]);
  });

  it("an aborted turn gets no marker, and does not hide the next start", () => {
    send("turn_start", "turn_abort", "turn_start", "turn_end");
    expect(markers()).toEqual(["start", "start", "end"]);
  });

  it("a turn reported ended twice in a row gets one end marker", () => {
    send("turn_start", "turn_end", "turn_end", "turn_start", "turn_end");
    expect(markers()).toEqual(["start", "end", "start", "end"]);
    expect(hub.history(sid, "main").map((e) => e.id)).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
      "turn-4",
    ]);
  });
});
