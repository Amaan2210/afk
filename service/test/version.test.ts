import { VERSION } from "../src/version.js";
import pkg from "../package.json" with { type: "json" };

it("exports the package version", () => {
  expect(VERSION).toBe(pkg.version);
});
