import { createRequire } from "node:module";

export interface PowerRequest {
  hold(): void;
  release(): void;
  /** The last failure swallowed by hold/release, if any. */
  readonly lastError?: Error;
}

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
// Added rather than OR-ed: `|` would yield a negative int32 that koffi's uint32 rejects.
const HOLD_FLAGS = ES_CONTINUOUS + ES_SYSTEM_REQUIRED;

type SetThreadExecutionState = (flags: number) => number;

const noopRequest: PowerRequest = { hold() {}, release() {} };

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Keeps the machine awake via kernel32 SetThreadExecutionState on Windows (the flag is tied
 * to the calling thread, which for Node is the main thread). Elsewhere it does nothing.
 * koffi is loaded lazily so other platforms and tests never touch the native module.
 */
export function createPowerRequest(platform: NodeJS.Platform = process.platform): PowerRequest {
  if (platform !== "win32") return noopRequest;

  let fn: SetThreadExecutionState | undefined;
  let lastError: Error | undefined;

  const call = (flags: number): void => {
    try {
      if (!fn) {
        const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi");
        fn = koffi
          .load("kernel32.dll")
          .func("__stdcall", "SetThreadExecutionState", "uint32", ["uint32"]);
      }
      fn(flags);
      lastError = undefined;
    } catch (e) {
      lastError = toError(e);
    }
  };

  return {
    hold: () => call(HOLD_FLAGS),
    release: () => call(ES_CONTINUOUS),
    get lastError() {
      return lastError;
    },
  };
}
