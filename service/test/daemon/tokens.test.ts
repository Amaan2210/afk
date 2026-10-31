import { generateToken, hashToken, verifyToken } from "../../src/daemon/tokens.js";

describe("tokens", () => {
  it("generateToken is 43 url-safe chars and unique", () => {
    const a = generateToken(),
      b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("verifyToken accepts the right token and rejects a wrong one", () => {
    const t = generateToken();
    const h = hashToken(t);
    expect(verifyToken(t, h)).toBe(true);
    expect(verifyToken(t + "x", h)).toBe(false);
  });

  it("verifyToken rejects a hash of the wrong length", () => {
    expect(verifyToken("abc", "abcd")).toBe(false);
  });
});
