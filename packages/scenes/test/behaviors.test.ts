// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mounts } from "../src/browser";
import { type SceneType, getScene, sceneSchema } from "../src/index";
import { statementRevealSeconds } from "../src/statement/timing";
import type { MountContext } from "../src/types";

const FPS = 30;

function stage(input: Record<string, unknown>) {
  const props = sceneSchema.parse(input);
  const definition = getScene(props.type as SceneType);
  const el = document.createElement("section");
  el.innerHTML = definition.compile(props, { index: 0, total: 1, path: "scenes[0]" });
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
