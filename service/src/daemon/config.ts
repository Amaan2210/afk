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

/** Merge untrusted parsed JSON over defaults; unknown keys are kept. */
function normalize(raw: Record<string, unknown>): DaemonConfig {
  const settings = DaemonSettingsSchema.partial().safeParse(raw.settings);
  const merged = {
    ...defaultConfig,
    ...raw,
    settings: { ...defaultConfig.settings, ...(settings.success ? settings.data : {}) },
  } as DaemonConfig;
  if (typeof merged.port !== "number") merged.port = defaultConfig.port;
  if (typeof merged.bind !== "string") merged.bind = defaultConfig.bind;
  if (!Array.isArray(merged.devices)) merged.devices = [];
  if (typeof merged.ringBufferBytes !== "number")
    merged.ringBufferBytes = defaultConfig.ringBufferBytes;
  if (typeof merged.snapshotScrollback !== "number") {
    merged.snapshotScrollback = defaultConfig.snapshotScrollback;
  }
  return merged;
}

async function readExisting(paths: AfkPaths): Promise<DaemonConfig | undefined> {
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
      const cfg = normalize(raw as Record<string, unknown>);
      if (typeof cfg.localTokenHash === "string") return cfg;
    }
  } catch {
    // fall through to backup
  }
  await rename(paths.configFile, `${paths.configFile}.corrupt-${Date.now()}`);
  return undefined;
}

export async function loadConfig(paths: AfkPaths): Promise<DaemonConfig> {
  await mkdir(paths.configDir, { recursive: true });
  const existing = await readExisting(paths);
  if (!existing) {
    const cfg: DaemonConfig = { ...defaultConfig, localTokenHash: await writeLocalToken(paths) };
    await saveConfig(paths, cfg);
    return cfg;
  }
  try {
    await readFile(paths.localTokenFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // The CLI needs a readable token: mint a new one and update the stored hash.
    existing.localTokenHash = await writeLocalToken(paths);
    await saveConfig(paths, existing);
  }
  return existing;
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
