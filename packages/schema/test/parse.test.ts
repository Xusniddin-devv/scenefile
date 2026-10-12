import { describe, expect, it } from "vitest";
import { parseScenefileText } from "../src/parse";

describe("parseScenefileText", () => {
  it("parses plain JSON without diagnostics", () => {
    expect(parseScenefileText('{"version":1}')).toEqual({ value: { version: 1 }, diagnostics: [] });
  });

  it("strips a Markdown code fence and says so", () => {
    const result = parseScenefileText('Here you go:\n```json\n{"version":1}\n```\nEnjoy!');
    expect(result.value).toEqual({ version: 1 });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "AUTOFIXED", severity: "warning", path: "" });
  });

  it.each(["", "   ", "not json", '{"version": 1,}', "{'version': 1}"])(
    "reports %j as SCHEMA_JSON",
    (text) => {
      const result = parseScenefileText(text);
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({ code: "SCHEMA_JSON", severity: "error" });
      expect(result.diagnostics[0]?.fix).toContain("double-quoted");
    },
  );
});
