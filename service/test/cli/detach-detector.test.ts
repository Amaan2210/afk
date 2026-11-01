import { DetachDetector } from "../../src/cli/detach-detector.js";

const CTRL_RIGHT_BRACKET = 0x1d;

describe("DetachDetector", () => {
  it("Ctrl+] then d detaches and forwards nothing", () => {
    const d = new DetachDetector();
    expect(d.feed(Buffer.from([CTRL_RIGHT_BRACKET]))).toEqual({
      forward: Buffer.alloc(0),
      detach: false,
    });
    expect(d.feed(Buffer.from("d"))).toEqual({ forward: Buffer.alloc(0), detach: true });
  });

  it("Ctrl+] then other key forwards both bytes", () => {
    const d = new DetachDetector();
    d.feed(Buffer.from([CTRL_RIGHT_BRACKET]));
    expect(d.feed(Buffer.from("x"))).toEqual({
      forward: Buffer.from([CTRL_RIGHT_BRACKET, 0x78]),
      detach: false,
    });
  });

  it("chord split across feeds still works; plain bytes pass through", () => {
    const d = new DetachDetector();
    expect(d.feed(Buffer.from("dir\r"))).toEqual({ forward: Buffer.from("dir\r"), detach: false });
    expect(d.feed(Buffer.from([0x61, CTRL_RIGHT_BRACKET]))).toEqual({
      forward: Buffer.from("a"),
      detach: false,
    });
    expect(d.feed(Buffer.from("d"))).toEqual({ forward: Buffer.alloc(0), detach: true });
  });

  it("forwards the bytes before a chord in the same chunk and drops the ones after it", () => {
    const d = new DetachDetector();
    const chunk = Buffer.concat([
      Buffer.from("ls"),
      Buffer.from([CTRL_RIGHT_BRACKET]),
      Buffer.from("dxyz"),
    ]);
    expect(d.feed(chunk)).toEqual({ forward: Buffer.from("ls"), detach: true });
  });

  it("Ctrl+] twice forwards both and starts over, so a following d is just a d", () => {
    const d = new DetachDetector();
    expect(d.feed(Buffer.from([CTRL_RIGHT_BRACKET, CTRL_RIGHT_BRACKET]))).toEqual({
      forward: Buffer.from([CTRL_RIGHT_BRACKET, CTRL_RIGHT_BRACKET]),
      detach: false,
    });
    expect(d.feed(Buffer.from("d"))).toEqual({ forward: Buffer.from("d"), detach: false });
  });

  it("a d with no Ctrl+] before it is typed", () => {
    const d = new DetachDetector();
    expect(d.feed(Buffer.from("dd"))).toEqual({ forward: Buffer.from("dd"), detach: false });
  });

  it("is case-sensitive: Ctrl+] then D is typed", () => {
    const d = new DetachDetector();
    expect(d.feed(Buffer.from([CTRL_RIGHT_BRACKET, 0x44]))).toEqual({
      forward: Buffer.from([CTRL_RIGHT_BRACKET, 0x44]),
      detach: false,
    });
  });

  it("takes another chord", () => {
    const d = new DetachDetector({ first: 0x01, second: "q" });
    expect(d.feed(Buffer.from([CTRL_RIGHT_BRACKET, 0x64]))).toEqual({
      forward: Buffer.from([CTRL_RIGHT_BRACKET, 0x64]),
      detach: false,
    });
    expect(d.feed(Buffer.from([0x01, 0x71]))).toEqual({ forward: Buffer.alloc(0), detach: true });
  });

  it("refuses a second key that is not one byte", () => {
    expect(() => new DetachDetector({ first: 0x1d, second: "dd" })).toThrow(/one byte/);
    expect(() => new DetachDetector({ first: 0x1d, second: "é" })).toThrow(/one byte/);
  });
});
