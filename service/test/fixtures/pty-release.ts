/**
 * Run as `node --import tsx test/fixtures/pty-release.ts <exit|kill|orphan>`. Spawns PowerShell
 * through `nodePtyFactory` and ends it: `exit` lets it exit on its own, `kill` kills it once its
 * prompt has settled, and `orphan` exits while a process it started stays attached to the console
 * and writes to it two seconds later. Prints the exit code and whether the late output arrived.
 * The process must then end by itself: anything node-pty leaves open keeps the event loop alive,
 * and the watchdog turns that into exit status 2.
 */
import { nodePtyFactory } from "../../src/daemon/sessions/pty.js";

const late = "Start-Sleep -Seconds 2; Write-Output ('late-' + 'output')";
const commands: Record<string, string[]> = {
  exit: ["-Command", "exit 7"],
  kill: [],
  orphan: [
    "-Command",
    `Start-Process -NoNewWindow powershell.exe -ArgumentList '-NoProfile','-Command',"${late}"; exit 0`,
  ],
};
const mode = process.argv[2] ?? "";
const pty = nodePtyFactory({
  exe: "powershell.exe",
  args: ["-NoLogo", "-NoProfile", ...(commands[mode] ?? [])],
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
  cols: 80,
  rows: 24,
});

// Killing an idle shell matters: a kill while output is still flowing lets node-pty dispose its
// output worker on the next chunk, which hides the leak this fixture exists to catch.
let output = "";
let killScheduled = false;
pty.onData((chunk) => {
  output += chunk.toString("utf8");
  if (mode !== "kill" || killScheduled || !output.includes("PS ")) return;
  killScheduled = true;
  setTimeout(() => pty.kill(), 1000);
});
pty.onExit(({ exitCode }) => {
  console.log(`exit ${exitCode}${output.includes("late-output") ? " after late-output" : ""}`);
  setTimeout(() => {
    const open = process.getActiveResourcesInfo().join(", ");
    console.error(`still running 3 s after exit, holding: ${open}`);
    process.exit(2);
  }, 3000).unref();
});
