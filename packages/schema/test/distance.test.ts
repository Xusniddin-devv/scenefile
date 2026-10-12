import { describe, expect, it } from "vitest";
import { nearest } from "../src/distance";

describe("nearest", () => {
  it("finds a close candidate", () => {
    expect(nearest("headng", ["heading", "sub", "duration"])).toBe("heading");
    expect(nearest("terminl", ["title", "terminal"])).toBe("terminal");
  });

  it("allows only one wrong letter in a short word", () => {
    expect(nearest("nope", ["title", "code"])).toBeUndefined();
    expect(nearest("time", ["type", "duration"])).toBeUndefined();
    expect(nearest("cod", ["code", "quote"])).toBe("code");
    expect(nearest("stats", ["stat", "statement"])).toBe("stat");
  });

  it("returns undefined when nothing is close", () => {
    expect(nearest("background", ["heading", "sub"])).toBeUndefined();
    expect(nearest("x", [])).toBeUndefined();
  });
});
