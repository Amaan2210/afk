import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import type { Pending } from "../../../src/protocol/index.js";
import { createFakePty, type FakePty } from "../../helpers/fake-pty.js";

const permission: Pending = { kind: "permission", id: "perm-1", tool: "Bash", summary: "npm test" };
const question: Pending = {
  kind: "question",
  id: "toolu_q",
  text: "Which?",
  multiSelect: false,
  allowsText: true,
  options: [{ label: "A" }],
};

let fake: FakePty;
let sessionsDir: string;
let reg: SessionRegistry;
let sid: string;

beforeEach(async () => {
  const fakes = createFakePty();
  sessionsDir = await mkdtemp(join(tmpdir(), "afk-registry-input-"));
  reg = new SessionRegistry({
    ptyFactory: (o) => (fake = fakes.factory(o) as FakePty),
    shell: { exe: "powershell.exe", kind: "powershell" },
    sessionsDir,
    port: 2350,
    nodeExe: "node.exe",
    cliEntry: "cli.js",
    ringBufferBytes: 4096,
    snapshotScrollback: 100,
    retentionHours: 24,
    baseEnv: {},
  });
  sid = (await reg.create({ cwd: sessionsDir, kind: "claude", args: [] })).id;
  reg.signal(sid, { kind: "turn_start" });
});

afterEach(async () => {
  reg.stopAll();
  await rm(sessionsDir, { recursive: true, force: true, maxRetries: 5 });
});

describe("SessionRegistry.input and a pending prompt", () => {
  it("typing at a permission prompt answers it: working again, pending gone", () => {
    reg.signal(sid, { kind: "pending", pending: permission });
    reg.input(sid, Buffer.from("1"));
    expect(fake.written.map(String)).toContain("1");
    const s = reg.get(sid)!.session;
    expect(s.state).toBe("working");
    expect(s.pending).toBeUndefined();
  });

  it("typing at a question leaves it pending: its tool result clears it", () => {
    reg.signal(sid, { kind: "pending", pending: question });
    reg.input(sid, Buffer.from("\x1b[B"));
    expect(reg.get(sid)!.session).toMatchObject({ state: "needs_input", pending: question });
  });

  it("a terminal's focus reports are not input: switching windows answers nothing", () => {
    reg.signal(sid, { kind: "pending", pending: permission });
    reg.input(sid, Buffer.from("\x1b[I"));
    reg.input(sid, Buffer.from("\x1b[O\x1b[I"));
    expect(fake.written.map(String)).toEqual(["\x1b[I", "\x1b[O\x1b[I"]);
    expect(reg.get(sid)!.session).toMatchObject({ state: "needs_input", pending: permission });

    reg.signal(sid, { kind: "turn_end" });
    reg.input(sid, Buffer.from("\x1b[O"));
    expect(reg.get(sid)!.session.state).toBe("finished");
  });

  it("a focus report followed by a key is input", () => {
    reg.signal(sid, { kind: "pending", pending: permission });
    reg.input(sid, Buffer.from("\x1b[I1"));
    expect(reg.get(sid)!.session.state).toBe("working");
  });
});
