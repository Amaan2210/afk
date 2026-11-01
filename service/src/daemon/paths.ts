import { homedir } from "node:os";
import path from "node:path";

/** `%LOCALAPPDATA%\afk` on Windows, `~/.config/afk` elsewhere. */
export function defaultConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const base =
      env.LOCALAPPDATA ?? path.win32.join(env.USERPROFILE ?? homedir(), "AppData", "Local");
    return path.win32.join(base, "afk");
  }
  return path.posix.join(env.HOME ?? homedir(), ".config", "afk");
}

export interface AfkPaths {
  configDir: string;
  configFile: string;
  localTokenFile: string;
  logDir: string;
  sessionsDir: string;
  lockFile: string;
  recentFoldersFile: string;
}

export function afkPaths(configDir: string): AfkPaths {
  return {
    configDir,
    configFile: path.join(configDir, "config.json"),
    localTokenFile: path.join(configDir, "local-token"),
    logDir: path.join(configDir, "logs"),
    sessionsDir: path.join(configDir, "sessions"),
    lockFile: path.join(configDir, "daemon.lock"),
    recentFoldersFile: path.join(configDir, "recent-folders.json"),
  };
}
