import qrcode from "qrcode-terminal";
import { DEFAULT_PORT, type Session } from "../protocol/index.js";

const LAST_WIDTH = 40;
const GAP = "  ";

/** `10s`, `30m`, `3h`, `3d`: the largest whole unit since `iso`. */
export function formatAge(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function shorten(text: string, width: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= width ? one : `${one.slice(0, width - 1)}…`;
}

/** Left-aligned columns, two spaces apart, no trailing padding. */
export function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => r[c]?.length ?? 0))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, c) => cell.padEnd(widths[c] ?? 0))
        .join(GAP)
        .trimEnd(),
    )
    .join("\n");
}

export function formatSessionTable(sessions: Session[], now: Date = new Date()): string {
  if (sessions.length === 0) return "No sessions.";
  const header = ["ID", "NAME", "KIND", "STATE", "AGE", "BRANCH", "LAST"];
  const rows = sessions.map((s) => [
    s.id,
    s.name,
    s.kind,
    s.state,
    formatAge(s.createdAt, now),
    s.gitBranch ?? "-",
    shorten(s.lastMessage ?? "", LAST_WIDTH) || "-",
  ]);
  return table([header, ...rows]);
}

export interface PairPayload {
  afk: 1;
  host: string;
  port: number;
  token: string;
}

/** What the phone scans: the address it can reach the daemon at, and its own token. */
export function pairPayload(host: string, token: string, port: number = DEFAULT_PORT): PairPayload {
  return { afk: 1, host, port, token };
}

export function renderQr(payload: object): string {
  let out = "";
  // With `small`, qrcode-terminal calls back synchronously.
  qrcode.generate(JSON.stringify(payload), { small: true }, (code) => (out = code));
  return out.replace(/\n+$/, "");
}
