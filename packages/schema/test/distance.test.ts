import { describe, expect, it } from "vitest";
import { nearest } from "../src/distance";

describe("nearest", () => {
  it("finds a close candidate", () => {
    expect(nearest("headng", ["heading", "sub", "duration"])).toBe("heading");
    expect(nearest("terminl", ["title", "terminal"])).toBe("terminal");
  });

  it("returns undefined when nothing is close", () => {
    expect(nearest("background", ["heading", "sub"])).toBeUndefined();
    expect(nearest("x", [])).toBeUndefined();
  });
});
