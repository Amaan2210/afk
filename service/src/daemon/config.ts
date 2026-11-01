import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { DaemonSettingsSchema, DEFAULT_PORT, type DaemonSettings } from "../protocol/index.js";
import type { AfkPaths } from "./paths.js";
import { generateToken, hashToken } from "./tokens.js";

export interface DeviceRecord {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt?: string;
}

export interface DaemonConfig {
  port: number;
  bind: "tailscale" | "loopback" | string;
  devices: DeviceRecord[];
  localTokenHash: string;
  settings: DaemonSettings;
  ringBufferBytes: number;
  snapshotScrollback: number;
  shell?: string;
}

export const defaultConfig: Omit<DaemonConfig, "localTokenHash"> = {
  port: DEFAULT_PORT,
  bind: "tailscale",
  devices: [],
  settings: { keepAwake: true, keepAwakeGraceMin: 10, retentionHours: 24 },
  ringBufferBytes: 2097152,
  snapshotScrollback: 2000,
};

// Token files are written with mode 0o600. On Windows `fs` ignores the mode bits; the
// file is protected by the per-user ACLs of %LOCALAPPDATA% instead.
const TOKEN_MODE = 0o600;

async function writeLocalToken(paths: AfkPaths): Promise<string> {
  const token = generateToken();
  await writeFile(paths.localTokenFile, token, { mode: TOKEN_MODE });
  return hashToken(token);
}

/** Fresh copy of the defaults; never share nested objects with `defaultConfig`. */
function freshDefaults(): Omit<DaemonConfig, "localTokenHash"> {
  return structuredClone(defaultConfig);
}

/** Merge untrusted parsed JSON over defaults; unknown keys are kept. */
function normalize(raw: Record<string, unknown>): DaemonConfig {
  const defaults = freshDefaults();
  const settings = DaemonSettingsSchema.partial().safeParse(raw.settings);
  const merged = {
    ...defaults,
    ...raw,
    settings: { ...defaults.settings, ...(settings.success ? settings.data : {}) },
  } as DaemonConfig;
  if (typeof merged.port !== "number") merged.port = defaults.port;
  if (typeof merged.bind !== "string") merged.bind = defaults.bind;
  if (!Array.isArray(merged.devices)) merged.devices = [];
  if (typeof merged.ringBufferBytes !== "number") merged.ringBufferBytes = defaults.ringBufferBytes;
  if (typeof merged.snapshotScrollback !== "number") {
    merged.snapshotScrollback = defaults.snapshotScrollback;
  }
  if (typeof merged.localTokenHash !== "string") merged.localTokenHash = "";
  return merged;
}

export interface LoadConfigOptions {
  /** Called with the backup path when an unparseable config file was moved aside. */
  onCorrupt?: (backupPath: string) => void;
}

async function readExisting(
  paths: AfkPaths,
  opts: LoadConfigOptions,
): Promise<DaemonConfig | undefined> {
  let text: string;
  try {
    text = await readFile(paths.configFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return normalize(raw as Record<string, unknown>);
    }
  } catch {
    // fall through to backup
  }
  const backupPath = `${paths.configFile}.corrupt-${Date.now()}`;
  await rename(paths.configFile, backupPath);
  opts.onCorrupt?.(backupPath);
  return undefined;
}

export async function loadConfig(
  paths: AfkPaths,
  opts: LoadConfigOptions = {},
): Promise<DaemonConfig> {
  await mkdir(paths.configDir, { recursive: true });
  const existing = await readExisting(paths, opts);
  if (!existing) {
    const cfg: DaemonConfig = { ...freshDefaults(), localTokenHash: await writeLocalToken(paths) };
    await saveConfig(paths, cfg);
    return cfg;
  }
  let needsToken = existing.localTokenHash === "";
  if (!needsToken) {
    try {
      await readFile(paths.localTokenFile, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      needsToken = true;
    }
  }
  if (needsToken) {
    // The CLI needs a readable token matching the stored hash: mint a new one.
    existing.localTokenHash = await writeLocalToken(paths);
    await saveConfig(paths, existing);
  }
  return existing;
}

/**
 * The config as it is on disk, for the CLI, which never creates, rewrites or moves anything:
 * undefined when there is no config file yet; a file that is not a JSON object reads as the
 * defaults (the daemon moves it aside when it next starts).
 */
export async function readConfig(paths: AfkPaths): Promise<DaemonConfig | undefined> {
  let text: string;
  try {
    text = await readFile(paths.configFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const isObject = raw !== null && typeof raw === "object" && !Array.isArray(raw);
  return normalize(isObject ? (raw as Record<string, unknown>) : {});
}

/** Atomic on the same volume: write a temp file, then rename over the target. */
export async function saveConfig(paths: AfkPaths, cfg: DaemonConfig): Promise<void> {
  const tmp = `${paths.configFile}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2) + "\n");
  await rename(tmp, paths.configFile);
}

export async function readLocalToken(paths: AfkPaths): Promise<string> {
  return (await readFile(paths.localTokenFile, "utf8")).trim();
}
