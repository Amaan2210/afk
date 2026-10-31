import type { SessionKind } from "../../protocol/index.js";

/**
 * Args typed bare. Anything else is quoted: spaces, non-ASCII, and characters PowerShell reads as
 * syntax (`@` splats, `,` builds an array, `--%` stops parsing, `$` expands, `;` ends a command).
 */
const BARE_ARG = /^[A-Za-z0-9_\-./=+]+$/;

const CONTROL_ESCAPES: Record<string, string> = { "\n": "`n", "\r": "`r", "\t": "`t" };

/**
 * A PowerShell double-quoted string. Backtick is the escape character, `$` would expand a
 * variable, and PowerShell also ends strings on typographic double quotes. Control characters
 * are written as escapes: a raw CR or LF would submit the typed line early.
 */
function psQuote(s: string): string {
  const body = s
    .replace(/[`$"“”„]/g, "`$&")
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\x00-\x1f\x7f]/g, (c) => CONTROL_ESCAPES[c] ?? `$([char]${c.charCodeAt(0)})`);
  return `"${body}"`;
}

function psArg(arg: string): string {
  return BARE_ARG.test(arg) ? arg : psQuote(arg);
}

/**
 * The line typed into a new session's shell to start its agent, ending in CR (Enter). The
 * prompt becomes the agent's quoted first positional argument; an empty prompt counts as none.
 * A shell session types nothing and takes no args or prompt.
 */
export function buildLaunchLine(
  kind: SessionKind,
  args: string[],
  prompt?: string,
): string | undefined {
  if (kind === "shell") {
    if (args.length > 0 || prompt) {
      throw new Error("bad_request: a shell session takes no args or prompt");
    }
    return undefined;
  }
  const words = [kind, ...args.map(psArg)];
  if (prompt) words.push(psQuote(prompt));
  return words.join(" ") + "\r";
}
