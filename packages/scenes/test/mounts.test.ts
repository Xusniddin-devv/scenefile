// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mounts } from "../src/browser";
import { terminalDefinition } from "../src/terminal/definition";
import { terminalSchema } from "../src/terminal/schema";
import { titleDefinition } from "../src/title/definition";
import { titleSchema } from "../src/title/schema";
import type { MountContext, SceneHandle } from "../src/types";

const ctx: MountContext = { fps: 30, durationFrames: 120, enterFrames: 18, exitFrames: 12 };

function mountScene(type: string, html: string): { el: HTMLElement; handle: SceneHandle } {
  const el = document.createElement("section");
  el.innerHTML = html;
  document.body.append(el);
  const mount = mounts[type];
  if (!mount) throw new Error(`no mount for ${type}`);
  return { el, handle: mount(el, ctx) };
}

const titleHtml = titleDefinition.compile(
  titleSchema.parse({ type: "title", heading: "Ship faster", sub: "A CLI" }),
);
const terminalHtml = terminalDefinition.compile(
  terminalSchema.parse({ type: "terminal", steps: [{ run: "npm i", output: "done" }, { run: "🚀 go" }] }),
);

function must<T extends Element>(root: Element, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

describe("title mount", () => {
  it("fades the heading in, then fades the scene out", () => {
    const { el, handle } = mountScene("title", titleHtml);
    const heading = must<HTMLElement>(el, ".sf-title__heading");
    handle.seek(0);
    expect(heading.style.opacity).toBe("0");
    handle.seek(60);
    expect(heading.style.opacity).toBe("1");
    expect(el.style.opacity).toBe("1");
    handle.seek(119);
    expect(Number(el.style.opacity)).toBeLessThan(0.3);
  });

  it("staggers the sub line behind the heading", () => {
    const { el, handle } = mountScene("title", titleHtml);
    handle.seek(6);
    const heading = Number(must<HTMLElement>(el, ".sf-title__heading").style.opacity);
    const sub = Number(must<HTMLElement>(el, ".sf-title__sub").style.opacity);
    expect(heading).toBeGreaterThan(sub);
  });
});

describe("terminal mount", () => {
  it("types the command over time and reveals output after it", () => {
    const { el, handle } = mountScene("terminal", terminalHtml);
    const typed = must<HTMLElement>(el, "[data-sf-type]");
    const out = must<HTMLElement>(el, "[data-sf-out]");
    handle.seek(18);
    expect(typed.textContent).toBe("");
    handle.seek(21);
    expect(typed.textContent).toBe("np");
    expect(out.style.visibility).toBe("hidden");
    handle.seek(35);
    expect(typed.textContent).toBe("npm i");
    expect(out.style.visibility).toBe("visible");
  });

  it("never shows half of an emoji", () => {
    const { el, handle } = mountScene("terminal", terminalHtml);
    const second = el.querySelectorAll<HTMLElement>("[data-sf-type]")[1];
    if (!second) throw new Error("missing second step");
    for (let frame = 0; frame < ctx.durationFrames; frame++) {
      handle.seek(frame);
      const text = second.textContent ?? "";
      expect(["", "🚀", "🚀 ", "🚀 g", "🚀 go"]).toContain(text);
    }
  });

  it("shows the caret only on the step being typed", () => {
    const { el, handle } = mountScene("terminal", terminalHtml);
    const carets = el.querySelectorAll<HTMLElement>(".sf-terminal__caret");
    handle.seek(20);
    expect(carets[0]?.style.visibility).toBe("visible");
    expect(carets[1]?.style.visibility).toBe("hidden");
    handle.seek(119);
    expect(carets[0]?.style.visibility).toBe("hidden");
    expect(carets[1]?.style.visibility).toBe("visible");
  });
});

describe("determinism contract", () => {
  const frames = [0, 5, 17, 18, 21, 40, 75, 107, 108, 119];

  it.each([
    ["title", titleHtml],
    ["terminal", terminalHtml],
  ])("%s: DOM after seek(n) does not depend on earlier seeks", (type, html) => {
    const a = mountScene(type, html);
    const sequential = frames.map((frame) => {
      a.handle.seek(frame);
      return a.el.outerHTML;
    });

    const b = mountScene(type, html);
    const order = [7, 2, 9, 0, 5, 3, 8, 1, 6, 4];
    const scrambled: string[] = [];
    for (const i of order) {
      const frame = frames[i];
      if (frame === undefined) throw new Error("bad index");
      b.handle.seek(frame);
      scrambled[i] = b.el.outerHTML;
    }
    expect(scrambled).toEqual(sequential);
  });
});
