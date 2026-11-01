import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The JS entry an npm `.cmd` shim runs: the `"%dp0%\...\x.js"` target, as an absolute path.
 * Undefined when the file is unreadable or has no such target. `text` overrides reading the file.
 */
export function resolveCmdShim(shimFile: string, text?: string): string | undefined {
  let content = text;
  if (content === undefined) {
    try {
      content = readFileSync(shimFile, "utf8");
    } catch {
      return undefined;
    }
  }
  const match = /"%dp0%[\\/]+([^"%]+\.(?:c|m)?js)"/i.exec(content);
  if (!match?.[1]) return undefined;
  return path.resolve(path.dirname(shimFile), ...match[1].split(/[\\/]+/));
}
