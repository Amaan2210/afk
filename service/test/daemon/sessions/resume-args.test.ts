import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRegistry } from "../../../src/daemon/sessions/registry.js";
import { withoutResumeArgs } from "../../../src/daemon/sessions/resume-args.js";
import { createFakePty, type FakePty } from "../../helpers/fake-pty.js";

describe("withoutResumeArgs for claude", () => {
  it.each([
    [
      ["--resume", "abc", "--model", "opus"],
      ["--model", "opus"],
    ],
    [
      ["-r", "abc", "--model", "opus"],
      ["--model", "opus"],
    ],
    [
      ["--model", "opus", "--resume=abc"],
      ["--model", "opus"],
    ],
    // Without an id, --resume opens the picker: the next option is not its value.
    [
      ["--resume", "--model", "opus"],
      ["--model", "opus"],
    ],
    [
      ["--model", "opus", "-r"],
      ["--model", "opus"],
    ],
    [["--continue", "--dangerously-skip-permissions"], ["--dangerously-skip-permissions"]],
    [
      ["-c", "--model", "opus"],
      ["--model", "opus"],
    ],
    [["--dangerously-skip-permissions"], ["--dangerously-skip-permissions"]],
    [[], []],
  ])("%j → %j", (args, expected) => {
    expect(withoutResumeArgs("claude", args)).toEqual(expected);
  });

  it("keeps everything after a bare --, which is the prompt", () => {
    expect(withoutResumeArgs("claude", ["-r", "abc", "--", "--resume", "x"])).toEqual([
      "--",
      "--resume",
      "x",
    ]);
  });

  it("does not change the array it is given", () => {
    const args = ["--resume", "abc"];
    withoutResumeArgs("claude", args);
    expect(args).toEqual(["--resume", "abc"]);
  });
});

describe("withoutResumeArgs for codex", () => {
  it.each([
    [["resume", "old-thread"], []],
    [
      ["-m", "gpt-5", "resume", "--last"],
      ["-m", "gpt-5"],
    ],
    // -c is a config override for Codex, never "continue".
    [
      ["-c", "model=o3", "resume", "x"],
      ["-c", "model=o3"],
    ],
    [
      ["--dangerously-bypass-approvals-and-sandbox"],
      ["--dangerously-bypass-approvals-and-sandbox"],
    ],
    [[], []],
  ])("%j → %j", (args, expected) => {
    expect(withoutResumeArgs("codex", args)).toEqual(expected);
  });
});

describe("SessionRegistry.resume with resume args in the original command", () => {
  let fake: FakePty;
  let sessionsDir: string;
  let reg: SessionRegistry;

  beforeEach(async () => {
    const fakes = createFakePty();
    sessionsDir = await mkdtemp(join(tmpdir(), "afk-resume-args-"));
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
  });

  afterEach(async () => {
    await rm(sessionsDir, { recursive: true, force: true, maxRetries: 5 });
  });

  async function resumedLine(kind: "claude" | "codex", args: string[], agentId: string) {
    const src = await reg.create({ cwd: sessionsDir, kind, args });
    reg.setMeta(src.id, { agentSessionId: agentId });
    fake.emitExit(0);
    await reg.resume(src.id);
    fake.emitData("PS> ");
    return fake.written.map(String);
  }

  it("claude --resume old … resumes as claude … --resume new", async () => {
    expect(await resumedLine("claude", ["--resume", "old", "--model", "opus"], "new")).toEqual([
      "claude --model opus --resume new\r",
    ]);
  });

  it("claude --continue … resumes without --continue", async () => {
    expect(await resumedLine("claude", ["-c", "--model", "opus"], "new")).toEqual([
      "claude --model opus --resume new\r",
    ]);
  });

  it("codex resume old resumes as codex resume new", async () => {
    expect(await resumedLine("codex", ["-m", "gpt-5", "resume", "old"], "new")).toEqual([
      "codex -m gpt-5 resume new\r",
    ]);
  });
});
