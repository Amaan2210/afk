import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server } from "node:net";
import { execProgram, isDaemonUp } from "../../src/cli/service.js";

const servers: { close(cb: () => void): unknown }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listening<S extends Server>(server: S): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("isDaemonUp", () => {
  it("is true when /health answers 200", async () => {
    const paths: string[] = [];
    const server = createHttpServer((req, res) => {
      paths.push(req.url ?? "");
      res.end('{"ok":true}');
    });
    const port = await listening(server);
    expect(await isDaemonUp(port)).toBe(true);
    expect(paths).toEqual(["/health"]);
    server.closeAllConnections();
  });

  it("is false for another answer, and for a port nobody listens on", async () => {
    const server = createHttpServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    expect(await isDaemonUp(await listening(server))).toBe(false);
    server.closeAllConnections();

    const free = createTcpServer();
    const port = await listening(free);
    await new Promise<void>((resolve) => free.close(() => resolve()));
    servers.splice(servers.indexOf(free), 1);
    expect(await isDaemonUp(port)).toBe(false);
  });

  it("is false, within about a second, when the port accepts and never answers", async () => {
    const sockets: { destroy(): void }[] = [];
    const silent = createTcpServer((socket) => void sockets.push(socket));
    const port = await listening(silent);
    const since = Date.now();
    expect(await isDaemonUp(port)).toBe(false);
    const took = Date.now() - since;
    expect(took).toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(1600);
    for (const s of sockets) s.destroy();
  });
});

describe("execProgram", () => {
  it("resolves with the exit code and output", async () => {
    const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)";
    expect(await execProgram(process.execPath, ["-e", script])).toEqual({
      code: 3,
      stdout: "out",
      stderr: "err",
    });
    expect(await execProgram(process.execPath, ["-e", "process.stdout.write('ok')"])).toEqual({
      code: 0,
      stdout: "ok",
      stderr: "",
    });
  });

  it("resolves, never rejects, when the program cannot start", async () => {
    const result = await execProgram("afk-no-such-program-here", []);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/ENOENT/);
  });
});
