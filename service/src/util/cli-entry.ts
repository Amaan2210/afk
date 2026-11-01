import { fileURLToPath } from "node:url";

/**
 * The package's built CLI, dist/cli.js: what session shells, agent wrappers and the scheduled task
 * run. This path reaches it from dist/util/cli-entry.js and from src/util/cli-entry.ts (tsx,
 * tests) alike.
 */
export const CLI_ENTRY = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
