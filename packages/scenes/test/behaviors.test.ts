// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mounts } from "../src/browser";
import { type SceneType, getScene, sceneSchema } from "../src/index";
import { bulletSchedule, bulletsHoldSeconds } from "../src/bullets/timing";
import { highlightLines } from "../src/code/highlight";
import { codeHoldSeconds, codeRevealSeconds } from "../src/code/timing";
import { containSize } from "../src/image";
import { PIN_FADE_SECONDS, PIN_GAP_SECONDS, PIN_START_SECONDS, pinsRevealSeconds } from "../src/screenshot/timing";
import { COUNT_SECONDS, statText } from "../src/stat/timing";
import { statementRevealSeconds } from "../src/statement/timing";
import type { MountContext } from "../src/types";
import { context } from "./context";

const FPS = 30;

function stage(input: Record<string, unknown>) {
  const props = sceneSchema.parse(input);
  const definition = getScene(props.type as SceneType);
  const el = document.createElement("section");
  el.innerHTML = definition.compile(props, context());
  document.body.append(el);
  const enterFrames = Math.round(definition.enterSeconds * FPS);
  const exitFrames = Math.round(definition.exitSeconds * FPS);
  const holdFrames = Math.ceil(Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) * FPS);
  const ctx: MountContext = { fps: FPS, durationFrames: enterFrames + holdFrames + exitFrames, enterFrames, exitFrames };
  const mount = mounts[props.type];
  if (!mount) throw new Error(`no mount for ${props.type}`);
  return { props, definition, el, ctx, handle: mount(el, ctx), revealed: ctx.durationFrames - exitFrames - 1 };
}

const all = (el: Element, selector: string): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(selector));

describe("statement", () => {
  const input = { type: "statement", text: "Describe the scenes. The engine does the rest.", highlight: "The engine" };

  it("requires highlight to be part of the text", () => {
    expect(sceneSchema.safeParse({ ...input, highlight: "engines" }).success).toBe(false);
  });

  it("splits the text into words and accents exactly the highlighted ones", () => {
    const { el } = stage(input);
    const words = all(el, "[data-sf-word]");
    expect(words.map((word) => word.textContent)).toEqual(["Describe", "the", "scenes.", "The", "engine", "does", "the", "rest."]);
    expect(words.filter((word) => word.classList.contains("is-accent")).map((word) => word.textContent)).toEqual(["The", "engine"]);
  });

  it("reveals words one after another", () => {
    const { el, ctx, handle, revealed } = stage(input);
    const words = all(el, "[data-sf-word]");
    handle.seek(ctx.enterFrames + 3);
    const early = words.map((word) => Number(word.style.opacity));
    expect(early[0]).toBeGreaterThan(early[1] ?? 1);
    expect(early.at(-1)).toBe(0);
    handle.seek(revealed);
    expect(words.every((word) => word.style.opacity === "1")).toBe(true);
  });

  it("holds long enough to reveal and then read the text", () => {
    const { props, definition } = stage(input);
    expect(definition.holdSeconds(props)).toBeCloseTo(statementRevealSeconds(8) + 8 / 3);
    expect(statementRevealSeconds(1)).toBeCloseTo(0.35);
  });
});

describe("bullets", () => {
  const items = ["Write JSON, not keyframes", "Errors a model can fix", "Same input, same frames"];
  const input = { type: "bullets", items };

  it("needs between two and five items", () => {
    expect(sceneSchema.safeParse({ type: "bullets", items: ["one"] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "bullets", items: ["1", "2", "3", "4", "5", "6"] }).success).toBe(false);
    expect(sceneSchema.safeParse(input).success).toBe(true);
  });

  it("schedules each item after the previous one has been read", () => {
    const starts = bulletSchedule(["one two three", "four", "five six"]);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(0.5 + 1);
    expect(starts[2]).toBeCloseTo(0.5 + 1 + 0.5 + 1 / 3);
    expect(bulletsHoldSeconds(["one two three", "four", "five six"])).toBeCloseTo((starts[2] ?? 0) + 0.35 + 2 / 3 + 0.4);
  });

  it("numbers the items and lights them up in order, leaving later ones dim", () => {
    const { el, ctx, handle, revealed } = stage(input);
    const rows = all(el, "[data-sf-item]");
    expect(rows.map((row) => row.querySelector("i")?.textContent)).toEqual(["01", "02", "03"]);
    const starts = bulletSchedule(items);
    handle.seek(ctx.enterFrames + Math.round(((starts[1] ?? 0) + 0.4) * FPS));
    const mid = rows.map((row) => Number(row.style.opacity));
    expect(mid[0]).toBe(1);
    expect(mid[1]).toBe(1);
    expect(mid[2]).toBeLessThan(0.3);
    expect(mid[2]).toBeGreaterThan(0.1);
    handle.seek(revealed);
    expect(rows.every((row) => row.style.opacity === "1")).toBe(true);
  });
});

describe("stat", () => {
  it.each([
    ["94%", 0, "0%"],
    ["94%", 0.5, "47%"],
    ["94%", 1, "94%"],
    ["1,200+", 0.5, "600+"],
    ["1,200+", 1, "1,200+"],
    ["12,000", 0.5, "6,000"],
    ["$3.20", 0.5, "$1.60"],
    ["3.20x", 1, "3.20x"],
    ["v2", 0.5, "v1"],
    ["10k+", 0.3, "3k+"],
    ["007", 0.5, "007"],
    ["N/A", 0.3, "N/A"],
    ["-5%", 1, "-5%"],
    ["-5%", 0.01, "0%"],
    ["3,5x", 0.4, "1,4x"],
    ["3,5x", 1, "3,5x"],
    ["1 200", 0.5, "600"],
    ["1.200,50", 0.5, "600,25"],
    ["99.9%", 0.5, "50.0%"],
    ["1.5M", 0.2, "0.3M"],
    ["24/7", 0.5, "24/7"],
    ["3 of 5", 0.5, "3 of 5"],
    ["12:30", 0.5, "12:30"],
    ["#1", 0.5, "#1"],
    ["2026", 0.5, "2026"],
    ["12000", 0.5, "6000"],
  ])("draws %s at progress %s as %s", (value, progress, expected) => {
    expect(statText(value, progress)).toBe(expected);
  });

  it("never produces NaN or changes the final text", () => {
    for (const value of ["94%", "1,200+", "N/A", "∞", "3.20x", "0", "..."]) {
      for (const progress of [-1, 0, 0.33, 0.999, 1, 2]) expect(statText(value, progress)).not.toContain("NaN");
      expect(statText(value, 1)).toBe(value);
    }
  });

  it("counts up to its value and stops there", () => {
    const { el, ctx, handle, revealed } = stage({ type: "stat", value: "94%", label: "valid on first try" });
    const value = el.querySelector<HTMLElement>(".sf-stat__value");
    if (!value) throw new Error("no value element");
    handle.seek(ctx.enterFrames);
    expect(value.textContent).toBe("0%");
    handle.seek(ctx.enterFrames + Math.round((COUNT_SECONDS * FPS) / 3));
    const partway = Number.parseInt(value.textContent ?? "", 10);
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(94);
    handle.seek(revealed);
    expect(value.textContent).toBe("94%");
  });
});

describe("code", () => {
  const source = 'const n = 1; // one\nreturn "two";\n\n\tdone();';

  it("classifies tokens, keeping the text exactly", () => {
    const lines = highlightLines(source, "typescript");
    expect(lines.map((line) => line.map((token) => token.text).join(""))).toEqual(source.split("\n"));
    const kinds = new Map(lines.flat().map((token) => [token.text.trim(), token.kind]));
    expect(kinds.get("const")).toBe("keyword");
    expect(kinds.get("1")).toBe("number");
    expect(kinds.get("// one")).toBe("comment");
    expect(kinds.get('"two"')).toBe("string");
    expect(kinds.get("done")).toBe("function");
  });

  it("leaves plain text alone and survives Windows line endings", () => {
    expect(highlightLines("a\r\nb", "text")).toEqual([[{ text: "a", kind: "plain" }], [{ text: "b", kind: "plain" }]]);
  });

  it("accepts the names models actually write for languages", () => {
    const parse = (lang: unknown) => sceneSchema.safeParse({ type: "code", lang, source: "x" });
    for (const [given, expected] of [["ts", "typescript"], ["JS", "javascript"], ["sh", "bash"], ["py", "python"], ["yml", "yaml"], [" Shell ", "bash"]]) {
      const result = parse(given);
      expect(result.success && result.data.type === "code" && result.data.lang, String(given)).toBe(expected);
    }
    expect(parse("klingon").success).toBe(false);
    const fallback = sceneSchema.parse({ type: "code", source: "x" });
    expect(fallback.type === "code" && fallback.lang).toBe("text");
  });

  it("rejects more lines than a scene can show, and marks for lines that do not exist", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => `l${i}`).join("\n");
    expect(sceneSchema.safeParse({ type: "code", source: lines(12) }).success).toBe(true);
    const tooLong = sceneSchema.safeParse({ type: "code", source: lines(13) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.path).toEqual(["source"]);
    expect(tooLong.error?.issues[0]?.message).toContain("12");
    const badMark = sceneSchema.safeParse({ type: "code", source: "a\nb", highlight: [3] });
    expect(badMark.success).toBe(false);
    expect(badMark.error?.issues[0]?.path).toEqual(["highlight"]);
  });

  it("ignores blank lines before and after the code, which models add by habit", () => {
    const parsed = sceneSchema.parse({ type: "code", source: "\n\na\n\nb\n\n  \n" });
    expect(parsed.type === "code" && parsed.source).toBe("a\n\nb");
    const twelve = `${Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n")}\n`;
    expect(sceneSchema.safeParse({ type: "code", source: twelve }).success).toBe(true);
    expect(sceneSchema.safeParse({ type: "code", source: "a\nb\n", highlight: [3] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "code", source: "\n \n" }).success).toBe(false);
  });

  it("numbers every line, keeps blank lines, and marks the highlighted ones", () => {
    const { el } = stage({ type: "code", lang: "ts", source, highlight: [2] });
    const lines = all(el, "[data-sf-line]");
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.querySelector(".sf-code__n")?.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(lines.map((line) => line.classList.contains("is-marked"))).toEqual([false, true, false, false]);
    expect(lines[3]?.querySelector(".sf-code__src")?.textContent).toBe("\tdone();");
    expect(el.querySelector(".sf-t-string")?.textContent).toBe('"two"');
  });

  it("reveals lines top to bottom, then dims the lines that are not marked", () => {
    const { el, ctx, handle, revealed } = stage({ type: "code", lang: "ts", source, highlight: [2] });
    const lines = all(el, "[data-sf-line]");
    handle.seek(ctx.enterFrames + 2);
    const early = lines.map((line) => Number(line.style.opacity));
    expect(early[0]).toBeGreaterThan(early[2] ?? 1);
    handle.seek(revealed);
    const late = lines.map((line) => Number(line.style.opacity));
    expect(late[1]).toBe(1);
    expect(late[0]).toBeLessThan(0.5);
    expect(late[0]).toBeGreaterThan(0.2);
  });

  it("keeps every line bright when nothing is marked", () => {
    const { el, handle, revealed } = stage({ type: "code", lang: "ts", source });
    handle.seek(revealed);
    expect(all(el, "[data-sf-line]").every((line) => line.style.opacity === "1")).toBe(true);
  });

  it("holds longer for more lines to read", () => {
    expect(codeHoldSeconds(6, 0, undefined)).toBeGreaterThan(codeHoldSeconds(2, 0, undefined));
    // With one line marked, there must still be time to take in the code around it.
    expect(codeHoldSeconds(12, 1, undefined) - codeRevealSeconds(12)).toBeGreaterThan(3);
    expect(codeHoldSeconds(12, 3, undefined)).toBeGreaterThan(codeHoldSeconds(12, 1, undefined));
    expect(codeRevealSeconds(1)).toBeCloseTo(0.3);
  });
});

describe("outro", () => {
  it("types the command after the heading has arrived, and shows the address", () => {
    const { el, ctx, handle, revealed } = stage({ type: "outro", heading: "Try it.", command: "npx scenefile init", url: "scenefile.dev" });
    const typed = el.querySelector<HTMLElement>("[data-sf-type]");
    if (!typed) throw new Error("no typed element");
    handle.seek(ctx.enterFrames);
    expect(typed.textContent).toBe("");
    handle.seek(ctx.enterFrames + Math.round(0.7 * FPS));
    const partway = typed.textContent ?? "";
    expect(partway.length).toBeGreaterThan(0);
    expect("npx scenefile init".startsWith(partway)).toBe(true);
    handle.seek(revealed);
    expect(typed.textContent).toBe("npx scenefile init");
    expect(el.querySelector(".sf-outro__url")?.textContent).toBe("scenefile.dev");
  });

  it("works with a heading alone", () => {
    const { el, handle, revealed } = stage({ type: "outro", heading: "Thanks." });
    handle.seek(revealed);
    expect(el.querySelector(".sf-outro__side")).toBeNull();
    expect(el.querySelector(".sf-outro__heading")?.textContent).toBe("Thanks.");
  });
});

describe("images", () => {
  it.each([
    [{ width: 1280, height: 720 }, { width: 1000, height: 1000 }, { width: 1000, height: 563 }],
    [{ width: 400, height: 2400 }, { width: 1000, height: 600 }, { width: 100, height: 600 }],
    [{ width: 3000, height: 300 }, { width: 1000, height: 600 }, { width: 1000, height: 100 }],
    [{ width: 320, height: 180 }, { width: 1600, height: 900 }, { width: 1600, height: 900 }],
    [{ width: 1, height: 5000 }, { width: 800, height: 600 }, { width: 1, height: 600 }],
  ])("fits %j inside %j as %j", (image, box, expected) => {
    const size = containSize(image, box);
    expect(size).toEqual(expected);
    expect(size.width).toBeLessThanOrEqual(box.width);
    expect(size.height).toBeLessThanOrEqual(box.height);
  });
});

describe("screenshot", () => {
  const input = {
    type: "screenshot",
    src: "shot.png",
    url: "scenefile.dev",
    caption: "One file.",
    callouts: [{ x: 0.25, y: 0.3, label: "First" }, { x: 0.8, y: 0.6, label: "Second" }],
  };

  it("declares its image and its text", () => {
    const { props, definition } = stage(input);
    expect(definition.assets?.(props)).toEqual([{ path: "src", src: "shot.png" }]);
    expect(definition.texts(props).map((entry) => entry.path)).toEqual(["url", "caption", "callouts[0].label", "callouts[1].label"]);
  });

  it("allows at most three callouts, each inside the image", () => {
    const pin = { x: 0.5, y: 0.5, label: "x" };
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png", callouts: [pin, pin, pin, pin] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png", callouts: [{ ...pin, x: 1.2 }] }).success).toBe(false);
    expect(sceneSchema.safeParse({ type: "screenshot", src: "a.png" }).success).toBe(true);
  });

  it("places each callout by its fraction of the image, labels to the left when near the right edge", () => {
    const { el } = stage(input);
    const pins = all(el, "[data-sf-pin]");
    expect(pins.map((pin) => [pin.style.left, pin.style.top])).toEqual([["25%", "30%"], ["80%", "60%"]]);
    expect(pins.map((pin) => pin.classList.contains("is-left"))).toEqual([false, true]);
    expect(pins.map((pin) => pin.textContent)).toEqual(["First", "Second"]);
  });

  it("sizes the image to its area: 1280x720 in a landscape frame keeps its shape", () => {
    const { el } = stage(input);
    const image = el.querySelector("img");
    const width = Number(image?.getAttribute("width"));
    const height = Number(image?.getAttribute("height"));
    expect(width / height).toBeCloseTo(1280 / 720, 2);
    expect(width).toBeLessThanOrEqual(1920 - 18 * 10.8);
    expect(height).toBeLessThanOrEqual(1080 - 25 * 10.8);
  });

  it("reveals callouts one after another and slowly moves in on the image", () => {
    const { el, ctx, handle, revealed } = stage(input);
    const pins = all(el, "[data-sf-pin]");
    const layer = el.querySelector<HTMLElement>(".sf-shot__layer");
    handle.seek(ctx.enterFrames + Math.round((PIN_START_SECONDS + 0.2) * FPS));
    expect(Number(pins[0]?.style.opacity)).toBeGreaterThan(0);
    expect(Number(pins[1]?.style.opacity)).toBe(0);
    const early = layer?.style.transform;
    handle.seek(revealed);
    expect(pins.every((pin) => pin.style.opacity === "1")).toBe(true);
    expect(layer?.style.transform).not.toBe(early);
    expect(layer?.style.transform).toMatch(/^scale\(1\.0\d+\)$/);
    expect(pinsRevealSeconds(2)).toBeCloseTo(PIN_START_SECONDS + PIN_GAP_SECONDS + PIN_FADE_SECONDS);
    expect(pinsRevealSeconds(0)).toBe(0);
  });

  it("draws an empty frame of the right size when the image is not available", () => {
    const props = sceneSchema.parse({ type: "screenshot", src: "gone.png" });
    const html = getScene("screenshot").compile(props, { ...context(), asset: () => undefined });
    expect(html).not.toContain("<img");
    expect(html).toContain("sf-shot__missing");
  });
});

describe("quote", () => {
  it("shows the author and role, and refuses a role without an author", () => {
    const { el } = stage({ type: "quote", text: "It works.", author: "Dilnoza K.", role: "Staff engineer" });
    expect(el.querySelector(".sf-quote__by")?.textContent).toBe("Dilnoza K., Staff engineer");
    expect(sceneSchema.safeParse({ type: "quote", text: "It works.", role: "Engineer" }).success).toBe(false);
  });

  it("omits the attribution when there is no author", () => {
    const { el } = stage({ type: "quote", text: "It works." });
    expect(el.querySelector(".sf-quote__by")).toBeNull();
  });
});
