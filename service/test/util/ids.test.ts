import { newSessionId } from "../../src/util/ids.js";

describe("newSessionId", () => {
  it("is s_ followed by 12 lowercase base32 characters", () => {
    for (let i = 0; i < 200; i++) expect(newSessionId()).toMatch(/^s_[a-z2-7]{12}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSessionId()));
    expect(ids.size).toBe(1000);
  });
});
