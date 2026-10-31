import { defaultWhich, detectShell, shellArgs } from "../../../src/daemon/sessions/shell.js";

function fakeWhich(found: Record<string, string>) {
  return vi.fn(async (name: string) => found[name]);
}

describe("detectShell", () => {
  it("prefers pwsh when it is on PATH", async () => {
    const which = fakeWhich({ pwsh: "C:\\ps7\\pwsh.exe", powershell: "C:\\ps5\\powershell.exe" });
    expect(await detectShell(undefined, which)).toEqual({ exe: "C:\\ps7\\pwsh.exe", kind: "pwsh" });
  });

  it("falls back to Windows PowerShell when pwsh is absent", async () => {
    const which = fakeWhich({ powershell: "C:\\ps5\\powershell.exe" });
    expect(await detectShell(undefined, which)).toEqual({
      exe: "C:\\ps5\\powershell.exe",
      kind: "powershell",
    });
    expect(which).toHaveBeenCalledWith("pwsh");
  });

  it("throws a clear error when neither shell is found", async () => {
    await expect(detectShell(undefined, fakeWhich({}))).rejects.toThrow(/PowerShell/);
  });

  it("uses the override as given and infers its kind from the file name", async () => {
    const which = fakeWhich({});
    expect(await detectShell("C:\\Program Files\\PowerShell\\7\\PWSH.EXE", which)).toEqual({
      exe: "C:\\Program Files\\PowerShell\\7\\PWSH.EXE",
      kind: "pwsh",
    });
    expect(await detectShell("D:/tools/powershell.exe", which)).toEqual({
      exe: "D:/tools/powershell.exe",
      kind: "powershell",
    });
    expect(which).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")("defaultWhich finds Windows PowerShell", async () => {
    expect(await defaultWhich("powershell")).toMatch(/[\\/]powershell\.exe$/i);
  });
});

describe("shellArgs", () => {
  it("keeps the shell open after running the session profile", () => {
    expect(shellArgs("D:\\a b\\profile.ps1")).toEqual([
      "-NoLogo",
      "-NoExit",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "D:\\a b\\profile.ps1",
    ]);
  });
});
