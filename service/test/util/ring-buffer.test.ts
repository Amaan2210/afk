import { RingBuffer } from "../../src/util/ring-buffer.js";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const r = new RingBuffer(4);
    expect(r.length).toBe(0);
    expect(r.toBuffer()).toEqual(Buffer.alloc(0));
  });

  it("keeps only the last capacity bytes", () => {
    const r = new RingBuffer(4);
    r.push(Buffer.from("abc"));
    r.push(Buffer.from("def"));
    expect(r.toBuffer().toString()).toBe("cdef");
    expect(r.length).toBe(4);
  });

  it("handles a chunk larger than capacity", () => {
    const r = new RingBuffer(2);
    r.push(Buffer.from("abcd"));
    expect(r.toBuffer().toString()).toBe("cd");
  });

  it("keeps bytes in order across repeated wraps", () => {
    const r = new RingBuffer(5);
    for (const s of ["ab", "cde", "fg", "hijk", "l"]) r.push(Buffer.from(s));
    expect(r.toBuffer().toString()).toBe("hijkl");
    expect(r.length).toBe(5);
  });

  it("copies on push and on read", () => {
    const r = new RingBuffer(4);
    const chunk = Buffer.from("ab");
    r.push(chunk);
    chunk.fill(0x78);
    const out = r.toBuffer();
    out.fill(0x79);
    expect(r.toBuffer().toString()).toBe("ab");
  });

  it("rejects a capacity that is not a positive integer", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });
});
