import os from "node:os";

/** The scheduled task that runs the daemon, in the root folder of Task Scheduler. */
export const TASK_NAME = "AFK Daemon";

export type SchtasksAction = "create" | "delete" | "run" | "end" | "query";

/**
 * The `schtasks.exe` arguments for each action. The task is created from an XML definition
 * (`taskXml`): schtasks' own flags make a logon trigger for any user, which needs elevation, and
 * cannot turn off the defaults that stop the task on battery and after 72 hours.
 */
export function schtasksArgs(action: "create", o: { xmlFile: string }): string[];
export function schtasksArgs(action: Exclude<SchtasksAction, "create">): string[];
export function schtasksArgs(action: SchtasksAction, o?: { xmlFile: string }): string[] {
  switch (action) {
    case "create":
      return ["/Create", "/F", "/TN", TASK_NAME, "/XML", o?.xmlFile ?? ""];
    case "delete":
      return ["/Delete", "/F", "/TN", TASK_NAME];
    case "run":
      return ["/Run", "/TN", TASK_NAME];
    case "end":
      return ["/End", "/TN", TASK_NAME];
    case "query":
      return ["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"];
  }
}

/** A PowerShell string literal that takes `text` as it is: single quotes, a `'` doubled. */
function psLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function xmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** `DOMAIN\user` for the current user, the form a logon trigger is scoped to. */
export function currentUserId(env: NodeJS.ProcessEnv = process.env): string {
  return `${env.USERDOMAIN ?? os.hostname()}\\${os.userInfo().username}`;
}

export interface TaskDefinition {
  nodeExe: string;
  cliEntry: string;
  /** The user whose logon starts the task and who it runs as (`DOMAIN\user`). */
  userId: string;
}

/**
 * The task definition, for `schtasks /Create /XML` (written as UTF-16LE with a BOM, as schtasks
 * exports it). It starts `afk daemon --exit-with-parent` at this user's logon, as this user and
 * without elevation, inside a hidden PowerShell: a console program started directly would open a
 * window whose closing ends the daemon. PowerShell stays the parent, so the task shows Running
 * while the daemon runs; ending the task ends PowerShell, and the daemon, watching its parent,
 * then stops itself. It keeps running on battery, has no time limit, and runs at normal priority
 * (the default, 7, is below normal and would slow every agent session).
 */
export function taskXml(task: TaskDefinition): string {
  const command = `& ${psLiteral(task.nodeExe)} ${psLiteral(task.cliEntry)} daemon --exit-with-parent`;
  const args = `-NoProfile -NonInteractive -WindowStyle Hidden -Command "${command}"`;
  const user = xmlText(task.userId);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the AFK daemon (afk daemon) at logon, so a phone can reach this machine's Claude Code and Codex sessions.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>${xmlText(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/** The `Status:` value ("Running", "Ready", …) of `/Query /FO LIST /V` output, if there is one. */
export function taskStatus(listOutput: string): string | undefined {
  return /^Status:[ \t]*(\S.*?)\s*$/m.exec(listOutput)?.[1];
}

/** schtasks' message for a task that does not exist (English Windows). */
export function isNotFound(output: string): boolean {
  return /cannot find the file specified/i.test(output);
}

/** schtasks' message for a change this user may not make (English Windows). */
export function isAccessDenied(output: string): boolean {
  return /access is denied/i.test(output);
}
