// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mounts } from "../src/browser";
import { SCENE_TYPES, type SceneType, getScene, sceneSchema } from "../src/index";
import type { MountContext } from "../src/types";
import { FIXTURES, HOSTILE } from "./fixtures";

const FPS = 30;
const at = { index: 2, total: 8, path: "scenes[2]" };

function build(type: SceneType, input: Record<string, unknown>) {
  const props = sceneSchema.parse(input);
  const definition = getScene(type);
  const html = definition.compile(props, at);
  const el = document.createElement("section");
  el.innerHTML = html;
  document.body.append(el);
  const enterFrames = Math.round(definition.enterSeconds * FPS);
  const exitFrames = Math.round(definition.exitSeconds * FPS);
  const holdFrames = Math.ceil(Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) * FPS);
  const ctx: MountContext = { fps: FPS, durationFrames: enterFrames + holdFrames + exitFrames, enterFrames, exitFrames };
  return { props, definition, html, el, ctx };
}

describe.each(SCENE_TYPES)("scene type %s", (type) => {
  it("has a fixture that parses, and lists exactly its schema's fields", () => {
    const { props, definition } = build(type, FIXTURES[type]);
    expect(props.type).toBe(type);
    expect(definition.type).toBe(type);
    expect(definition.fields).toContain("type");
    expect(definition.fields).toContain("duration");
    for (const key of Object.keys(FIXTURES[type])) expect(definition.fields, key).toContain(key);
  });

  it("draws every string it declares, and shows its position", () => {
    const { props, definition, el } = build(type, FIXTURES[type]);
    const typed = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-type]"), (node) => node.dataset.sfType ?? "");
    const valued = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-value]"), (node) => node.dataset.sfValue ?? "");
    const drawn = [el.textContent ?? "", ...typed, ...valued].join("\n").replace(/\s+/g, " ");
    const texts = definition.texts(props);
    expect(texts.length).toBeGreaterThan(0);
    for (const entry of texts) {
      for (const line of entry.text.split("\n").map((part) => part.trim()).filter(Boolean)) {
        expect(drawn, `${entry.path}: ${line}`).toContain(line.replace(/\s+/g, " "));
      }
    }
    expect(el.querySelector(".sf-chrome__index")?.textContent).toBe("03 / 08");
  });

  it("has a hostile fixture that exercises every field", () => {
    const fields = getScene(type).fields.filter((field) => field !== "type" && field !== "duration");
    for (const field of fields) expect(Object.keys(HOSTILE[type]), field).toContain(field);
  });

  it("draws every string it declares inside a text slot that is fitted", () => {
    const { props, definition, el } = build(type, FIXTURES[type]);
    const fitted = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-fit]"), (slot) => {
      const inner = [slot, ...Array.from(slot.querySelectorAll<HTMLElement>("*"))];
      const attributes = inner.flatMap((node) => [node.dataset.sfType ?? "", node.dataset.sfValue ?? ""]);
      return [slot.textContent ?? "", ...attributes].join("\n").replace(/\s+/g, " ");
    });
    for (const entry of definition.texts(props)) {
      for (const line of entry.text.split("\n").map((part) => part.trim()).filter(Boolean)) {
        expect(fitted.some((text) => text.includes(line.replace(/\s+/g, " "))), `${entry.path}: ${line}`).toBe(true);
      }
    }
  });

  it("turns none of its text into markup", () => {
    const { el } = build(type, HOSTILE[type]);
    expect(el.querySelector("u, img, script")).toBeNull();
  });

  it("marks each fitted text with a path to a real field of the scene", () => {
    const { definition, el } = build(type, FIXTURES[type]);
    const slots = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-fit]"));
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const path = slot.dataset.sfPath ?? "";
      expect(path.startsWith("scenes[2]."), path).toBe(true);
      const field = path.slice("scenes[2].".length).split(/[.[]/)[0] ?? "";
      expect(definition.fields, path).toContain(field);
      const [min = 0, max = 0, step = 0] = (slot.dataset.sfFit ?? "").split(",").map(Number);
      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThanOrEqual(min);
      expect(step).toBeGreaterThan(0);
      expect("sfLines" in slot.dataset || "sfBox" in slot.dataset, path).toBe(true);
    }
  });

  it("describes itself in one line and holds for a positive, finite time", () => {
    const { props, definition } = build(type, FIXTURES[type]);
    const summary = definition.summary(props);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("\n");
    const hold = definition.holdSeconds(props);
    expect(Number.isFinite(hold) && hold > 0).toBe(true);
  });

  it("is fully visible on its last frame before the exit", () => {
    const { el, ctx } = build(type, FIXTURES[type]);
    const mount = mounts[type];
    if (!mount) throw new Error(`no browser mount for ${type}`);
    mount(el, ctx).seek(ctx.durationFrames - ctx.exitFrames - 1);
    for (const item of el.querySelectorAll<HTMLElement>("[data-sf-enter]")) expect(item.style.opacity).toBe("1");
    expect(el.style.opacity).toBe("1");
  });

  it("is pure: the DOM after seek(n) does not depend on earlier seeks", () => {
    const first = build(type, FIXTURES[type]);
    const second = build(type, FIXTURES[type]);
    const mount = mounts[type];
    if (!mount) throw new Error(`no browser mount for ${type}`);
    const a = mount(first.el, first.ctx);
    const b = mount(second.el, second.ctx);
    const last = first.ctx.durationFrames - 1;
    const frames = Array.from({ length: 14 }, (_, i) => Math.round((i * last) / 13));
    const sequential = frames.map((frame) => {
      a.seek(frame);
      return first.el.outerHTML;
    });
    const scrambled: string[] = [];
    for (const i of [9, 2, 13, 0, 6, 11, 4, 1, 8, 12, 3, 10, 5, 7]) {
      const frame = frames[i];
      if (frame === undefined) throw new Error("bad index");
      b.seek(frame);
      scrambled[i] = second.el.outerHTML;
    }
    expect(scrambled).toEqual(sequential);
  });
});

describe("the registry", () => {
  it("has a browser mount for every scene type, and nothing extra", () => {
    expect(Object.keys(mounts).sort()).toEqual([...SCENE_TYPES].sort());
  });
});
