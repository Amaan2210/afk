import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schtasksArgs, TASK_NAME, taskStatus, taskXml } from "../../src/cli/schtasks.js";
import {
  runService,
  type ExecResult,
  type ServiceAction,
  type ServiceIo,
} from "../../src/cli/service.js";
import { afkPaths, type AfkPaths } from "../../src/daemon/paths.js";

const fixture = (name: string): Promise<string> =>
  readFile(new URL(`../fixtures/schtasks/${name}`, import.meta.url), "utf8");

const NOT_FOUND: ExecResult = {
  code: 1,
  stdout: "",
  stderr: "ERROR: The system cannot find the file specified.\r\n",
};
const ACCESS_DENIED: ExecResult = { code: 1, stdout: "", stderr: "ERROR: Access is denied.\r\n" };

const TASK = {
  nodeExe: "C:\\Program Files\\nodejs\\node.exe",
  cliEntry: "D:\\a b\\cli.js",
  userId: "HOST\\user",
};

describe("schtasksArgs", () => {
  it("create registers the task from its XML definition", () =>
    expect(schtasksArgs("create", { xmlFile: "C:\\t\\afk.xml" })).toEqual([
      "/Create",
      "/F",
      "/TN",
      "AFK Daemon",
      "/XML",
      "C:\\t\\afk.xml",
    ]));

  it("run, end, delete and query name the task", () => {
    expect(TASK_NAME).toBe("AFK Daemon");
    expect(schtasksArgs("run")).toEqual(["/Run", "/TN", "AFK Daemon"]);
    expect(schtasksArgs("end")).toEqual(["/End", "/TN", "AFK Daemon"]);
    expect(schtasksArgs("delete")).toEqual(["/Delete", "/F", "/TN", "AFK Daemon"]);
    expect(schtasksArgs("query")).toEqual(["/Query", "/TN", "AFK Daemon", "/FO", "LIST", "/V"]);
  });
});

describe("taskXml", () => {
  const xml = taskXml(TASK);
  const block = (name: string): string => {
    const match = new RegExp(`<${name}[ >][\\s\\S]*?</${name}>`).exec(xml);
    expect(match, name).not.toBeNull();
    return match?.[0] ?? "";
  };

  it("is a UTF-16 task definition", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.2"')).toBe(
      true,
    );
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"');
  });

  it("starts at the logon of this user only, as this user, without elevation", () => {
    expect(block("LogonTrigger")).toMatch(
      /^<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>HOST\\user<\/UserId>\s*<\/LogonTrigger>$/,
    );
    const principal = block("Principal");
    expect(principal).toContain("<UserId>HOST\\user</UserId>");
    expect(principal).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(principal).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  });

  it("keeps running on battery, without a time limit, at normal priority", () => {
    const settings = block("Settings");
    for (const element of [
      "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
      "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
      "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
      "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
      "<StartWhenAvailable>true</StartWhenAvailable>",
      "<Priority>4</Priority>",
    ]) {
      expect(settings).toContain(element);
    }
    expect(block("RestartOnFailure")).toMatch(
      /^<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>3<\/Count>\s*<\/RestartOnFailure>$/,
    );
  });

  it("runs afk daemon --exit-with-parent through a hidden PowerShell", () => {
    expect(block("Exec")).toMatch(/^<Exec>\s*<Command>powershell\.exe<\/Command>\s*<Arguments>/);
    expect(block("Arguments")).toBe(
      "<Arguments>-NoProfile -NonInteractive -WindowStyle Hidden -Command " +
        "\"&amp; 'C:\\Program Files\\nodejs\\node.exe' 'D:\\a b\\cli.js' daemon --exit-with-parent\"" +
        "</Arguments>",
    );
  });

  it("doubles a ' in a path for PowerShell and escapes & for XML", () => {
    const odd = taskXml({
      nodeExe: "C:\\Users\\O'Neil\\node.exe",
      cliEntry: "D:\\R&D\\cli.js",
      userId: "R&D\\o'neil",
    });
    expect(odd).toContain(
      "-Command \"&amp; 'C:\\Users\\O''Neil\\node.exe' 'D:\\R&amp;D\\cli.js' daemon --exit-with-parent\"",
    );
    expect(odd).toContain("<UserId>R&amp;D\\o'neil</UserId>");
  });
});

describe("taskStatus", () => {
  it("reads the Status line of /Query /FO LIST /V output", async () => {
    const running = await fixture("query-running.txt");
    // As schtasks writes it: CRLF throughout, a blank line first (kept by .gitattributes).
    expect(running.startsWith("\r\nFolder: \\\r\n")).toBe(true);
    expect(taskStatus(running)).toBe("Running");
    expect(taskStatus(running.replaceAll("\r\n", "\n"))).toBe("Running");
    expect(taskStatus(await fixture("query-ready.txt"))).toBe("Ready");
    expect(taskStatus("ERROR: The system cannot find the file specified.")).toBeUndefined();
  });
});

interface Call {
  file: string;
  args: string[];
  /** The task XML file as it was when /Create ran. */
  xml?: Buffer;
}

function capture(): { write: (text: string) => void; text: () => string } {
  const chunks: string[] = [];
  return { write: (text) => void chunks.push(text), text: () => chunks.join("") };
}

let dir: string;
let paths: AfkPaths;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "afk-service-"));
  paths = afkPaths(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A ServiceIo whose schtasks answers from `replies` (by the first argument) or succeeds. */
function setup(replies: Record<string, ExecResult> = {}, extra: Partial<ServiceIo> = {}) {
  const calls: Call[] = [];
  const stdout = capture();
  const stderr = capture();
  const isUp = vi.fn<(port: number) => Promise<boolean>>(async () => false);
  const io = {
    exec: async (file: string, args: string[]): Promise<ExecResult> => {
      const call: Call = { file, args };
      if (args[0] === "/Create") call.xml = await readFile(args[args.indexOf("/XML") + 1]);
      calls.push(call);
      return replies[args[0] ?? ""] ?? { code: 0, stdout: `SUCCESS: ${args[0]}\r\n`, stderr: "" };
    },
    stdout,
    stderr,
    platform: "win32",
    paths,
    port: 2351,
    isUp,
    stopWaitMs: 50,
    pollMs: 5,
    ...TASK,
    ...extra,
  } satisfies ServiceIo;
  return { io, calls, stdout, stderr, args: () => calls.map((c) => c.args) };
}

describe("runService install", () => {
  it("install runs create then run, and prints the next steps", async () => {
    const { io, calls, stdout, args } = setup();
    expect(await runService("install", io)).toBe(0);

    expect(calls.map((c) => c.file)).toEqual(["schtasks.exe", "schtasks.exe"]);
    const xmlFile = calls[0]?.args[5] ?? "";
    expect(args()).toEqual([schtasksArgs("create", { xmlFile }), schtasksArgs("run")]);
    // UTF-16LE with a BOM, the encoding schtasks itself exports task XML in.
    const written = calls[0]?.xml ?? Buffer.alloc(0);
    expect([...written.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(written.subarray(2).toString("utf16le")).toBe(taskXml(TASK));
    expect(existsSync(xmlFile)).toBe(false);
    expect(io.isUp).toHaveBeenCalledWith(2351);
    expect(stdout.text()).toContain('Installed the scheduled task "AFK Daemon"');
    expect(stdout.text()).toContain("afk pair");
  });

  it("does not start the task while a daemon already answers on the port", async () => {
    const { io, stdout, args } = setup({}, { isUp: vi.fn(async () => true) });
    expect(await runService("install", io)).toBe(0);
    expect(args().map((a) => a[0])).toEqual(["/Create"]);
    expect(stdout.text()).toMatch(/already running on port 2351/);
    expect(stdout.text()).toContain("afk pair");
  });

  it("explains an access-denied create and removes the XML file", async () => {
    const { io, calls, stderr } = setup({ "/Create": ACCESS_DENIED });
    expect(await runService("install", io)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(existsSync(calls[0]?.args[5] ?? "")).toBe(false);
    expect(stderr.text()).toMatch(/elevated/);
  });

  it("passes on schtasks' own message for any other failure", async () => {
    const failed = { code: 1, stdout: "", stderr: "ERROR: The task XML is malformed.\r\n" };
    const { io, stderr } = setup({ "/Create": failed });
    expect(await runService("install", io)).toBe(1);
    expect(stderr.text()).toContain("ERROR: The task XML is malformed.");
  });
});

describe("runService start", () => {
  it("runs the task, unless a daemon already answers", async () => {
    const started = setup();
    expect(await runService("start", started.io)).toBe(0);
    expect(started.args()).toEqual([schtasksArgs("run")]);

    const running = setup({}, { isUp: vi.fn(async () => true) });
    expect(await runService("start", running.io)).toBe(0);
    expect(running.args()).toEqual([]);
    expect(running.stdout.text()).toMatch(/already running on port 2351/);
  });

  it("tells the user to install the task first when it is missing", async () => {
    const { io, stderr } = setup({ "/Run": NOT_FOUND });
    expect(await runService("start", io)).toBe(1);
    expect(stderr.text()).toContain("afk service install");
  });
});

describe("runService status", () => {
  it("status reports Running/Not running from query output", async () => {
    const running = setup({ "/Query": { code: 0, stdout: await fixture("query-running.txt") } });
    expect(await runService("status", running.io)).toBe(0);
    expect(running.args()).toEqual([schtasksArgs("query")]);
    expect(running.stdout.text()).toBe("Running\n");

    const ready = setup({ "/Query": { code: 0, stdout: await fixture("query-ready.txt") } });
    expect(await runService("status", ready.io)).toBe(1);
    expect(ready.stdout.text()).toBe(`Not running\nLogs: ${paths.logDir}\n`);
  });

  it("a failed query means the task is not installed", async () => {
    const { io, stdout } = setup({ "/Query": NOT_FOUND });
    expect(await runService("status", io)).toBe(1);
    expect(stdout.text()).toBe("Not installed\n");
  });
});

describe("runService stop", () => {
  it("ends the task and waits until the daemon stops answering", async () => {
    const isUp = vi
      .fn<(port: number) => Promise<boolean>>(async () => false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const { io, stdout, args } = setup({}, { isUp, stopWaitMs: 5000 });
    expect(await runService("stop", io)).toBe(0);
    expect(args()).toEqual([schtasksArgs("end")]);
    expect(isUp).toHaveBeenCalledTimes(3);
    expect(stdout.text()).toContain("Stopped the daemon");
  });

  it("warns with the daemon's pid when it still answers after the wait", async () => {
    await writeFile(paths.lockFile, "4242");
    const { io, stderr } = setup({}, { isUp: vi.fn(async () => true) });
    expect(await runService("stop", io)).toBe(1);
    expect(stderr.text()).toMatch(/port 2351/);
    expect(stderr.text()).toMatch(/pid 4242/);
  });

  it("tells the user the task is not installed", async () => {
    const { io, stderr } = setup({ "/End": NOT_FOUND });
    expect(await runService("stop", io)).toBe(1);
    expect(stderr.text()).toMatch(/not installed/);
    expect(io.isUp).not.toHaveBeenCalled();
  });
});

describe("runService uninstall", () => {
  it("ends the task, waits for the daemon to stop, then deletes the task", async () => {
    const isUp = vi
      .fn<(port: number) => Promise<boolean>>(async () => false)
      .mockResolvedValueOnce(true);
    const { io, stdout, args } = setup({ "/End": NOT_FOUND }, { isUp, stopWaitMs: 5000 });
    expect(await runService("uninstall", io)).toBe(0);
    expect(args()).toEqual([schtasksArgs("end"), schtasksArgs("delete")]);
    expect(isUp).toHaveBeenCalledTimes(2);
    expect(stdout.text()).toContain('Removed the scheduled task "AFK Daemon"');
  });

  it("deletes the task even when a daemon still answers, and warns with its pid", async () => {
    await writeFile(paths.lockFile, "4242");
    const { io, stdout, stderr, args } = setup({}, { isUp: vi.fn(async () => true) });
    expect(await runService("uninstall", io)).toBe(1);
    expect(args()).toEqual([schtasksArgs("end"), schtasksArgs("delete")]);
    expect(stdout.text()).toContain("Removed the scheduled task");
    expect(stderr.text()).toMatch(/pid 4242/);
  });

  it("says so when the task is not installed", async () => {
    const { io, stderr } = setup({ "/End": NOT_FOUND, "/Delete": NOT_FOUND });
    expect(await runService("uninstall", io)).toBe(1);
    expect(stderr.text()).toMatch(/not installed/);
  });
});

describe("runService on other platforms", () => {
  it.each<ServiceAction>(["install", "uninstall", "start", "stop", "status"])(
    "refuses on non-win32 with a clear message (%s)",
    async (action) => {
      const { io, calls, stderr } = setup({}, { platform: "linux" });
      expect(await runService(action, io)).toBe(1);
      expect(calls).toEqual([]);
      expect(stderr.text()).toMatch(/Windows only/);
      expect(stderr.text()).toContain("afk daemon");
    },
  );
});
