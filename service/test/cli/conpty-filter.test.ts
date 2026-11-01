import { Win32InputFilter } from "../../src/cli/conpty-filter.js";

const REQUEST = "\x1b[?9001h";

function run(chunks: string[]): string[] {
  const f = new Win32InputFilter();
  return chunks.map((c) => f.filter(Buffer.from(c, "latin1")).toString("latin1"));
}

describe("Win32InputFilter", () => {
  it("strips ConPTY's win32-input-mode request and keeps everything around it", () => {
    expect(run([`${REQUEST}\x1b[?1004h\x1b[2Jhello`])).toEqual(["\x1b[?1004h\x1b[2Jhello"]);
    expect(run([`a${REQUEST}b${REQUEST}c`])).toEqual(["abc"]);
  });

  it("strips a request split across chunks", () => {
    expect(run(["x\x1b[?90", "01hy"])).toEqual(["x", "y"]);
    expect(run(["\x1b", "[", "?", "9", "0", "0", "1", "h", "z"])).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "z",
    ]);
  });

  it("holds back what may start a request, and releases it when it does not", () => {
    expect(run(["abc\x1b[?9", "0h"])).toEqual(["abc", "\x1b[?90h"]);
    expect(run(["\x1b", "[0m"])).toEqual(["", "\x1b[0m"]);
  });

  it("passes other modes, and the request's reset, untouched", () => {
    expect(run(["\x1b[?9001l\x1b[?1049h\x1b[?25l"])).toEqual(["\x1b[?9001l\x1b[?1049h\x1b[?25l"]);
  });

  it("returns a chunk with nothing to strip or hold as it is", () => {
    const f = new Win32InputFilter();
    const chunk = Buffer.from("plain output\r\n");
    expect(f.filter(chunk)).toBe(chunk);
  });

  it("keeps multi-byte characters whole", () => {
    const f = new Win32InputFilter();
    const text = Buffer.from("é ✓ 日本", "utf8");
    const out = Buffer.concat([f.filter(text.subarray(0, 1)), f.filter(text.subarray(1))]);
    expect(out).toEqual(text);
  });
});
