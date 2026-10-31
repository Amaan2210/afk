import { isRecord } from "../../src/util/is-record.js";

describe("isRecord", () => {
  it("accepts plain objects and rejects null, arrays and primitives", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    for (const v of [null, undefined, [], "x", 42, true]) expect(isRecord(v)).toBe(false);
  });
});
