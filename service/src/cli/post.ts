import http from "node:http";

/**
 * POSTs a JSON body to the daemon's loopback HTTP port. Never throws: resolves true on a 2xx
 * answer and false on any error, non-2xx answer or timeout, so a relay can never fail an agent.
 * `onReply` gets a 2xx answer's JSON body, before the promise resolves.
 */
export function postLoopback(
  port: number,
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 1500,
  onReply?: (body: unknown) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let req: http.ClientRequest | undefined = undefined;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    try {
      const payload = Buffer.from(JSON.stringify(body ?? {}), "utf8");
      req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: route,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": payload.length,
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
            if (ok && onReply !== undefined) {
              try {
                onReply(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              } catch {
                // An answer that is not JSON says nothing.
              }
            }
            done(ok);
          });
          res.on("error", () => done(false));
        },
      );
      req.on("error", () => done(false));
      req.end(payload);
    } catch {
      done(false);
    }
  });
}

export type PostFn = typeof postLoopback;

export const DEFAULT_PORT = 2350;

/** The loopback port a session's shell exported, falling back to the default daemon port. */
export function portFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env.AFK_PORT);
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_PORT;
}
