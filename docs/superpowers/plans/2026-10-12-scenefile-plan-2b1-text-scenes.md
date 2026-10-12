# scenefile Plan 2b-1 — Text Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six more scene types (`statement`, `quote`, `bullets`, `stat`, `code`, `outro`) in the Signal look, enough for a model to write a complete software launch video.

**Architecture:** Each scene is one directory in `packages/scenes` with a schema, a definition (compile, text, timing), and a browser mount, registered in two places. A conformance suite runs every registered scene type through the same checks (escaping, slot paths, pure `seek`), so a new scene cannot ship without them. Timing that both Node and the browser need lives in a small pure `timing.ts` per scene.

**Tech Stack:** As before, plus `shiki` (MIT) for syntax highlighting, used synchronously at compile time.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md`

## Where this plan sits

Plan 2b is split in two:

- **2b-1 (this plan):** the six scenes that draw only text.
- **2b-2:** `screenshot`, `compare` and `custom`, which need asset fetching, image checks, and an HTML sanitizer.

### Deviations from the spec, deliberate

- **`code` reveals by line, not by typewriter.** The spec lists "typewriter or block reveal". Typing code character by character is slow to watch and adds nothing; lines fade in in order, then unmarked lines dim so the marked ones stand out. `reveal` is not a field.
- **`code` shows at most 16 lines.** At the minimum readable size that is what fits. The schema says so; `CODE_TOO_LONG` as a separate diagnostic is unnecessary.
- **Scene-type suggestions are stricter for short names.** A four-letter typo may differ by one letter, not two, so `nope` no longer suggests `code`.

## Global Constraints

All earlier constraints apply. In addition:

- Every scene type has a fixture in `packages/scenes/test/fixtures.ts` and passes the conformance suite.
- Scene text reaches HTML only through `escapeHtml`.
- A scene's browser mount imports nothing that pulls in `zod` or `shiki`.
- Secondary text is never smaller than 3.4 units.
- Colors come only from theme variables; the accent is the only color.
- No `Co-Authored-By` trailer on commits.
- After any scene or CSS change, run the reproducibility tests in `packages/render/test/render.test.ts`.

## Review Focus

1. **A scene whose text contains HTML or quotes**, in every scene type. Expected: shown literally. Covered for all types by the conformance suite (Task 1).
2. **`stat` values that are not plain numbers** (`"10k+"`, `"$1,200"`, `"3.20x"`, `"v2"`, `"N/A"`). Expected: counts up where there is a number, keeps the exact final text, never shows `NaN`. Task 2.
3. **Code with tabs, blank lines, very long lines, or a language name the model abbreviates** (`ts`, `sh`, `py`). Expected: drawn as written; abbreviations accepted. Task 3.
4. **`highlight` line numbers beyond the source**, and **more lines than fit**. Expected: a diagnostic on the field. Task 3.
5. **All scene types together in portrait.** Expected: no overflow diagnostics for ordinary content. Task 4.

## How edits are written in this plan

As in Plan 2a: whole files under their path, and edit blocks (`FILE` / `<<<<` / `====` / `>>>>`) whose old text occurs exactly once.

---

### Task 1: Motion helpers, `statement`, `quote`, and the conformance suite

**Files:**
- Create: `packages/scenes/src/statement/{schema,timing,definition,mount}.ts`, `packages/scenes/src/quote/{schema,definition,mount}.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/conformance.test.ts`, `packages/scenes/test/behaviors.test.ts`
- Replace: `packages/scenes/src/motion.ts`, `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`
- Modify: `packages/scenes/src/text.ts`, `packages/scenes/src/title/definition.ts`, `packages/scenes/test/registry.test.ts`, `packages/schema/test/normalize.test.ts`

**Interfaces:**
- Produces:
  - `clamp01(x: number): number`, `easeOutCubic(t: number): number`, `reveal(item: HTMLElement, frame: number, start: number, frames: number, offsetPx?: number): void`
  - `highlightHtml(text: string, highlight: string | undefined): string` in `text.ts`
  - `statementSchema`, `statementDefinition`, `mountStatement`, `statementRevealSeconds(words: number): number`
  - `quoteSchema`, `quoteDefinition`, `mountQuote`
  - `FIXTURES: Record<SceneType, Record<string, unknown>>`, `HOSTILE: Record<SceneType, Record<string, unknown>>`, `ALL_SCENES: Record<string, unknown>[]`

- [ ] **Step 1: Write the failing tests**

`packages/scenes/test/fixtures.ts`:

```ts
import type { SceneType } from "../src/index";

/** One ordinary example of every scene type. A new scene type must be added here. */
export const FIXTURES: Record<SceneType, Record<string, unknown>> = {
  title: { type: "title", heading: "Video from JSON.", highlight: "JSON.", sub: "Any model can write a scenefile." },
  statement: { type: "statement", text: "Describe the scenes. The engine does the rest.", highlight: "The engine" },
  quote: { type: "quote", text: "It rendered correctly on the first try.", author: "Dilnoza K.", role: "Staff engineer" },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY = `<u>x</u> & "q" '</script><img src=x onerror=1>`;

/** The same scenes with markup in every text field. None of it may become an element. */
export const HOSTILE: Record<SceneType, Record<string, unknown>> = {
  title: { type: "title", heading: NASTY, highlight: "<u>x</u>", sub: NASTY },
  statement: { type: "statement", text: NASTY, highlight: "<u>x</u>" },
  quote: { type: "quote", text: NASTY, author: NASTY, role: NASTY },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};

/** Every fixture, in registry order: a video that uses all scene types. */
export const ALL_SCENES: Record<string, unknown>[] = Object.values(FIXTURES);
```

`packages/scenes/test/conformance.test.ts`:

```ts
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
```

`packages/scenes/test/behaviors.test.ts`:

```ts
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
```

Edits to existing tests:

```text
FILE packages/scenes/test/registry.test.ts
<<<<
    expect(SCENE_TYPES).toEqual(["title", "terminal"]);
====
    expect(SCENE_TYPES.slice(0, 1)).toEqual(["title"]);
    expect(SCENE_TYPES.at(-1)).toBe("terminal");
    expect(new Set(SCENE_TYPES).size).toBe(SCENE_TYPES.length);
>>>>
```

```text
FILE packages/schema/test/normalize.test.ts
<<<<
    expect(diagnostics[0]?.fix).toContain("title, terminal");
====
    expect(diagnostics[0]?.fix).toContain("title, ");
    expect(diagnostics[0]?.fix).toContain("terminal");
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes`
Expected: FAIL. `fixtures.ts` names scene types that do not exist yet, so `conformance.test.ts` and `behaviors.test.ts` fail to parse `statement` and `quote`.

- [ ] **Step 3: Implement**

`packages/scenes/src/motion.ts`:

```ts
import type { MountContext } from "./types";

const STAGGER_FRAMES = 4;
const ENTER_OFFSET_PX = 40;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

/** Fades and lifts one element in over `frames` frames, beginning at frame `start`. */
export function reveal(
  item: HTMLElement,
  frame: number,
  start: number,
  frames: number,
  offsetPx: number = ENTER_OFFSET_PX,
): void {
  const t = easeOutCubic(clamp01((frame - start) / frames));
  item.style.opacity = String(t);
  item.style.transform = `translateY(${(1 - t) * offsetPx}px)`;
}

/** Reveals every [data-sf-enter] element, in the order its value gives. */
export function staggerEnter(el: HTMLElement, ctx: MountContext, frame: number): void {
  for (const item of el.querySelectorAll<HTMLElement>("[data-sf-enter]")) {
    reveal(item, frame, Number(item.dataset.sfEnter) * STAGGER_FRAMES, ctx.enterFrames);
  }
}

/** Fades the whole scene out over its last `exitFrames` frames. */
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  const start = ctx.durationFrames - ctx.exitFrames;
  const t = easeInCubic(clamp01((frame - start) / ctx.exitFrames));
  el.style.opacity = String(1 - t);
}
```

Add to `packages/scenes/src/text.ts`, and use it in the title scene:

```text
FILE packages/scenes/src/text.ts
<<<<
export function escapeHtml(text: string): string {
====
/** Escaped `text`, with the first occurrence of `highlight` wrapped in <em>. */
export function highlightHtml(text: string, highlight: string | undefined): string {
  const at = highlight === undefined ? -1 : text.indexOf(highlight);
  if (highlight === undefined || at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<em>${escapeHtml(highlight)}</em>${escapeHtml(text.slice(at + highlight.length))}`;
}

export function escapeHtml(text: string): string {
>>>>
```

```text
FILE packages/scenes/src/title/definition.ts
<<<<
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type TitleProps, titleSchema } from "./schema";

function headingHtml(heading: string, highlight: string | undefined): string {
  const at = highlight === undefined ? -1 : heading.indexOf(highlight);
  if (highlight === undefined || at < 0) return escapeHtml(heading);
  return `${escapeHtml(heading.slice(0, at))}<em>${escapeHtml(highlight)}</em>${escapeHtml(heading.slice(at + highlight.length))}`;
}
====
import { escapeHtml, highlightHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type TitleProps, titleSchema } from "./schema";
>>>>
```

```text
FILE packages/scenes/src/title/definition.ts
<<<<
${headingHtml(props.heading, props.highlight)}</h1>
====
${highlightHtml(props.heading, props.highlight)}</h1>
>>>>
```

`packages/scenes/src/statement/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const statementSchema = z
  .strictObject({
    type: z.literal("statement"),
    text: z.string().min(1).max(140),
    /** A part of the text to draw in the accent color. */
    highlight: z.string().min(1).max(140).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.text.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "text", written exactly as it appears there.',
  });

export type StatementProps = z.infer<typeof statementSchema>;
```

`packages/scenes/src/statement/timing.ts`:

```ts
export const WORD_STAGGER_SECONDS = 0.07;
export const WORD_FADE_SECONDS = 0.35;

/** Seconds from the first word starting to appear until the last is fully visible. */
export function statementRevealSeconds(words: number): number {
  return Math.max(0, words - 1) * WORD_STAGGER_SECONDS + WORD_FADE_SECONDS;
}
```

`packages/scenes/src/statement/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type StatementProps, statementSchema } from "./schema";
import { statementRevealSeconds } from "./timing";

function words(text: string) {
  return Array.from(text.matchAll(/\S+/g));
}

/** Each word in its own element, so words can appear one at a time; highlighted words are accented. */
function wordsHtml(text: string, highlight: string | undefined): string {
  const from = highlight === undefined ? -1 : text.indexOf(highlight);
  const to = highlight === undefined || from < 0 ? -1 : from + highlight.length;
  return words(text)
    .map((match, index) => {
      const start = match.index ?? 0;
      const accent = from >= 0 && start < to && start + match[0].length > from;
      return `<span class="sf-statement__word${accent ? " is-accent" : ""}" data-sf-word="${index}">${escapeHtml(match[0])}</span>`;
    })
    .join(" ");
}

export const statementDefinition: SceneDefinition<StatementProps> = {
  type: "statement",
  fields: Object.keys(statementSchema.shape),
  enterSeconds: 0.2,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds: (props) => statementRevealSeconds(words(props.text).length) + readingSeconds(props.text),
  summary: (props) => props.text,
  texts: (props) => [{ path: "text", text: props.text, font: "sans" }],
  compile(props, ctx) {
    return `${sceneChrome(ctx)}<div class="sf-statement"><p class="sf-statement__text" data-sf-fit="6,15,0.5" data-sf-lines="5" data-sf-path="${ctx.path}.text">${wordsHtml(props.text, props.highlight)}</p></div>`;
  },
  css: `
.sf-statement{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*10);display:flex;align-items:flex-end}
.sf-statement__text{width:100%;font:var(--sf-heading-weight) calc(var(--sf-unit)*15)/0.98 var(--sf-font-sans);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-statement__word{display:inline-block}
.sf-statement__word.is-accent{color:var(--sf-accent)}
`,
};
```

`packages/scenes/src/statement/mount.ts`:

```ts
import { fadeExit, reveal } from "../motion";
import type { SceneMount } from "../types";
import { WORD_FADE_SECONDS, WORD_STAGGER_SECONDS } from "./timing";

const WORD_OFFSET_PX = 28;

export const mountStatement: SceneMount = (el, ctx) => {
  const words = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-word]"));
  const stagger = WORD_STAGGER_SECONDS * ctx.fps;
  const fade = WORD_FADE_SECONDS * ctx.fps;
  return {
    seek(frame) {
      words.forEach((word, i) => reveal(word, frame, ctx.enterFrames + i * stagger, fade, WORD_OFFSET_PX));
      fadeExit(el, ctx, frame);
    },
  };
};
```

`packages/scenes/src/quote/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const quoteSchema = z
  .strictObject({
    type: z.literal("quote"),
    text: z.string().min(1).max(220),
    author: z.string().min(1).max(60).optional(),
    /** The author's job title or company. */
    role: z.string().min(1).max(60).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.role === undefined || scene.author !== undefined, {
    path: ["role"],
    message: '"role" describes the author, so it needs "author" as well.',
  });

export type QuoteProps = z.infer<typeof quoteSchema>;
```

`packages/scenes/src/quote/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type QuoteProps, quoteSchema } from "./schema";

export const quoteDefinition: SceneDefinition<QuoteProps> = {
  type: "quote",
  fields: Object.keys(quoteSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => readingSeconds(`${props.text} ${props.author ?? ""} ${props.role ?? ""}`),
  summary: (props) => `"${props.text}"${props.author ? ` (${props.author})` : ""}`,
  texts(props) {
    const texts: SceneText[] = [{ path: "text", text: props.text, font: "sans" }];
    if (props.author) texts.push({ path: "author", text: props.author, font: "sans" });
    if (props.role) texts.push({ path: "role", text: props.role, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const by = props.author
      ? `<figcaption class="sf-quote__by" data-sf-enter="2" data-sf-fit="3.4,4.4,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.author"><b>${escapeHtml(props.author)}</b>${props.role ? `, ${escapeHtml(props.role)}` : ""}</figcaption>`
      : "";
    return `${sceneChrome(ctx)}<figure class="sf-quote"><span class="sf-quote__mark" data-sf-enter="0" aria-hidden="true">“</span><blockquote class="sf-quote__text" data-sf-enter="1" data-sf-fit="4.6,10,0.4" data-sf-lines="6" data-sf-path="${ctx.path}.text">${escapeHtml(props.text)}</blockquote>${by}</figure>`;
  },
  css: `
.sf-quote{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*10);display:flex;flex-direction:column;justify-content:flex-end}
.sf-quote__mark{font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.6 var(--sf-font-sans);color:var(--sf-accent);height:calc(var(--sf-unit)*9)}
.sf-quote__text{font:800 calc(var(--sf-unit)*10)/1.05 var(--sf-font-sans);letter-spacing:-0.04em;color:var(--sf-text);text-wrap:balance}
.sf-quote__by{margin-top:calc(var(--sf-unit)*4);font:400 calc(var(--sf-unit)*4.4)/1.3 var(--sf-font-sans);color:var(--sf-muted)}
.sf-quote__by b{font-weight:600;color:var(--sf-text)}
`,
};
```

`packages/scenes/src/quote/mount.ts`:

```ts
import { fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";

export const mountQuote: SceneMount = (el, ctx) => ({
  seek(frame) {
    staggerEnter(el, ctx, frame);
    fadeExit(el, ctx, frame);
  },
});
```

`packages/scenes/src/index.ts`:

```ts
import { z } from "zod";
import { quoteDefinition } from "./quote/definition";
import { quoteSchema } from "./quote/schema";
import { statementDefinition } from "./statement/definition";
import { statementSchema } from "./statement/schema";
import { terminalDefinition } from "./terminal/definition";
import { terminalSchema } from "./terminal/schema";
import { titleDefinition } from "./title/definition";
import { titleSchema } from "./title/schema";
import type { SceneDefinition } from "./types";

export const sceneSchema = z.discriminatedUnion("type", [
  titleSchema,
  statementSchema,
  quoteSchema,
  terminalSchema,
]);
export type Scene = z.infer<typeof sceneSchema>;
export type SceneType = Scene["type"];

/**
 * The one place a definition's prop type is widened. It is sound because
 * `getScene` is only ever called with the `type` of the scene whose props are
 * then passed back in.
 */
function widen<P extends Scene>(definition: SceneDefinition<P>): SceneDefinition<Scene> {
  return definition as unknown as SceneDefinition<Scene>;
}

const registry: Record<SceneType, SceneDefinition<Scene>> = {
  title: widen(titleDefinition),
  statement: widen(statementDefinition),
  quote: widen(quoteDefinition),
  terminal: widen(terminalDefinition),
};

export const SCENE_TYPES = Object.keys(registry) as SceneType[];

export function isSceneType(value: string): value is SceneType {
  return Object.hasOwn(registry, value);
}

export function getScene(type: SceneType): SceneDefinition<Scene> {
  return registry[type];
}

export { SHARED_CSS, sceneChrome } from "./chrome";
export { durationSchema, type Duration } from "./common";
export { escapeHtml, highlightHtml, readingSeconds } from "./text";
export type {
  CompileContext,
  MountContext,
  SceneDefinition,
  SceneHandle,
  SceneMount,
  SceneText,
} from "./types";
```

`packages/scenes/src/browser.ts`:

```ts
import { mountQuote } from "./quote/mount";
import { mountStatement } from "./statement/mount";
import { mountTerminal } from "./terminal/mount";
import { mountTitle } from "./title/mount";
import type { SceneMount } from "./types";

/** Browser-side registry. Must not import zod or shiki: this file is bundled into the page. */
export const mounts: Record<string, SceneMount> = {
  title: mountTitle,
  statement: mountStatement,
  quote: mountQuote,
  terminal: mountTerminal,
};

export type { MountContext, SceneHandle, SceneMount } from "./types";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS for every package.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scenes): statement and quote scenes, and a conformance suite for all scene types"
```

---

### Task 2: `bullets` and `stat`

**Files:**
- Create: `packages/scenes/src/bullets/{schema,timing,definition,mount}.ts`, `packages/scenes/src/stat/{schema,timing,definition,mount}.ts`
- Modify: `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/behaviors.test.ts`

**Interfaces:**
- Consumes: `reveal`, `clamp01`, `easeOutCubic`, `staggerEnter`, `fadeExit` (Task 1)
- Produces:
  - `bulletsSchema`, `bulletsDefinition`, `mountBullets`, `bulletSchedule(items: readonly string[]): number[]` (seconds at which each item lights up), `bulletsHoldSeconds(items: readonly string[]): number`
  - `statSchema`, `statDefinition`, `mountStat`, `statText(value: string, progress: number): string`, `COUNT_SECONDS`

- [ ] **Step 1: Write the failing tests**

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
====
  bullets: { type: "bullets", heading: "Why it works", items: ["Write JSON, not keyframes", "Errors a model can fix", "Same input, same frames"] },
  stat: { type: "stat", value: "1,200+", label: "videos rendered", note: "In the first week, from four different models." },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
====
  bullets: { type: "bullets", heading: NASTY, items: [NASTY, NASTY] },
  stat: { type: "stat", value: "<u>9</u>", label: NASTY, note: NASTY },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
>>>>
```

Append to `packages/scenes/test/behaviors.test.ts`:

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
describe("quote", () => {
====
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
    ["007", 1, "007"],
    ["N/A", 0.3, "N/A"],
    ["-5%", 1, "-5%"],
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

describe("quote", () => {
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
import { statementRevealSeconds } from "../src/statement/timing";
====
import { bulletSchedule, bulletsHoldSeconds } from "../src/bullets/timing";
import { COUNT_SECONDS, statText } from "../src/stat/timing";
import { statementRevealSeconds } from "../src/statement/timing";
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes`
Expected: FAIL, cannot resolve `../src/bullets/timing`.

- [ ] **Step 3: Implement**

`packages/scenes/src/bullets/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const bulletsSchema = z.strictObject({
  type: z.literal("bullets"),
  heading: z.string().min(1).max(60).optional(),
  items: z.array(z.string().min(1).max(70)).min(2).max(5),
  duration: durationSchema.default("auto"),
});

export type BulletsProps = z.infer<typeof bulletsSchema>;
```

`packages/scenes/src/bullets/timing.ts`:

```ts
import { readingSeconds } from "../text";

export const ITEM_FADE_SECONDS = 0.35;
/** Pause after an item has been read, before the next lights up. */
export const ITEM_GAP_SECONDS = 0.5;
export const TAIL_SECONDS = 0.4;

/** Seconds, from the start of the hold, at which each item lights up. */
export function bulletSchedule(items: readonly string[]): number[] {
  let cursor = 0;
  return items.map((item) => {
    const start = cursor;
    cursor += ITEM_GAP_SECONDS + readingSeconds(item);
    return start;
  });
}

export function bulletsHoldSeconds(items: readonly string[]): number {
  const lastStart = bulletSchedule(items).at(-1) ?? 0;
  return lastStart + ITEM_FADE_SECONDS + readingSeconds(items.at(-1) ?? "") + TAIL_SECONDS;
}
```

`packages/scenes/src/bullets/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type BulletsProps, bulletsSchema } from "./schema";
import { bulletsHoldSeconds } from "./timing";

export const bulletsDefinition: SceneDefinition<BulletsProps> = {
  type: "bullets",
  fields: Object.keys(bulletsSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => bulletsHoldSeconds(props.items) + readingSeconds(props.heading ?? ""),
  summary: (props) => `${props.heading ?? props.items[0] ?? ""} (${props.items.length} items)`,
  texts(props) {
    const texts: SceneText[] = props.heading ? [{ path: "heading", text: props.heading, font: "sans" }] : [];
    props.items.forEach((item, i) => texts.push({ path: `items[${i}]`, text: item, font: "sans" }));
    return texts;
  },
  compile(props, ctx) {
    const heading = props.heading
      ? `<p class="sf-bullets__heading" data-sf-enter="0" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.heading">${escapeHtml(props.heading)}</p>`
      : "";
    const items = props.items
      .map(
        (item, i) =>
          `<li class="sf-bullets__item" data-sf-item="${i}"><i>${String(i + 1).padStart(2, "0")}</i><span>${escapeHtml(item)}</span></li>`,
      )
      .join("");
    return `${sceneChrome(ctx)}<div class="sf-bullets">${heading}<ol class="sf-bullets__list" data-sf-enter="1" data-sf-fit="4,9.6,0.4" data-sf-box data-sf-path="${ctx.path}.items">${items}</ol></div>`;
  },
  css: `
.sf-bullets{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;gap:calc(var(--sf-unit)*3)}
.sf-bullets__heading{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
.sf-bullets__list{flex:1;min-height:0;overflow:hidden;list-style:none;display:flex;flex-direction:column;font-size:calc(var(--sf-unit)*9.6);color:var(--sf-text)}
.sf-bullets__item{display:flex;align-items:baseline;padding:0.42em 0;border-top:1px solid var(--sf-line)}
.sf-bullets__item i{flex:none;width:6em;font:500 0.3em/1 var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-accent)}
.sf-bullets__item span{min-width:0;font:800 1em/1.05 var(--sf-font-sans);letter-spacing:-0.045em}
.sf-fitting .sf-bullets__item span{white-space:nowrap}
`,
};
```

`packages/scenes/src/bullets/mount.ts`:

```ts
import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { ITEM_FADE_SECONDS, bulletSchedule } from "./timing";

/** How visible an item is before its turn. */
const DIM = 0.24;

export const mountBullets: SceneMount = (el, ctx) => {
  const items = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-item]"));
  const starts = bulletSchedule(items.map((item) => item.querySelector("span")?.textContent ?? ""));
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      items.forEach((item, i) => {
        const lit = easeOutCubic(clamp01((seconds - (starts[i] ?? 0)) / ITEM_FADE_SECONDS));
        item.style.opacity = String(1 - (1 - DIM) * (1 - lit));
      });
    },
  };
};
```

`packages/scenes/src/stat/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const statSchema = z.strictObject({
  type: z.literal("stat"),
  /** The figure as it should read, with its unit: "94%", "1,200+", "3.2x". */
  value: z.string().min(1).max(12),
  label: z.string().min(1).max(50),
  note: z.string().min(1).max(120).optional(),
  duration: durationSchema.default("auto"),
});

export type StatProps = z.infer<typeof statSchema>;
```

`packages/scenes/src/stat/timing.ts`:

```ts
export const COUNT_SECONDS = 0.9;

/** Anything before the first digit, the number (with optional thousands commas and decimals), and the rest. */
const NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s;

/**
 * The text of a stat partway through counting up. `progress` runs from 0 to 1.
 * Only the first number in the value moves; its prefix, suffix, decimal places
 * and thousands commas are kept. At 1 the result is the value exactly as given.
 */
export function statText(value: string, progress: number): string {
  const match = NUMBER.exec(value);
  if (progress >= 1 || !match) return value;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const target = Number(digits.replace(/,/g, ""));
  const decimals = (digits.split(".")[1] ?? "").length;
  const [whole = "0", fraction] = (target * Math.max(0, progress)).toFixed(decimals).split(".");
  const grouped = digits.includes(",") ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${prefix}${grouped}${fraction === undefined ? "" : `.${fraction}`}${suffix}`;
}
```

`packages/scenes/src/stat/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type StatProps, statSchema } from "./schema";
import { COUNT_SECONDS } from "./timing";

export const statDefinition: SceneDefinition<StatProps> = {
  type: "stat",
  fields: Object.keys(statSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => COUNT_SECONDS + readingSeconds(`${props.label} ${props.note ?? ""}`),
  summary: (props) => `${props.value} ${props.label}`,
  texts(props) {
    const texts: SceneText[] = [
      { path: "value", text: props.value, font: "sans" },
      { path: "label", text: props.label, font: "sans" },
    ];
    if (props.note) texts.push({ path: "note", text: props.note, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const value = escapeHtml(props.value);
    const note = props.note
      ? `<p class="sf-stat__note" data-sf-enter="2" data-sf-fit="3.4,4.2,0.2" data-sf-lines="4" data-sf-path="${ctx.path}.note">${escapeHtml(props.note)}</p>`
      : "";
    return `${sceneChrome(ctx)}<div class="sf-stat"><div class="sf-stat__value" data-sf-enter="0" data-sf-fit="18,56,2" data-sf-lines="1" data-sf-path="${ctx.path}.value" data-sf-value="${value}">${value}</div><div class="sf-stat__foot"><p class="sf-stat__label" data-sf-enter="1" data-sf-fit="4.6,7.8,0.4" data-sf-lines="2" data-sf-path="${ctx.path}.label">${escapeHtml(props.label)}</p>${note}</div></div>`;
  },
  css: `
.sf-stat{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*17);bottom:calc(var(--sf-unit)*9);display:flex;flex-direction:column;justify-content:space-between}
.sf-stat__value{font:var(--sf-heading-weight) calc(var(--sf-unit)*56)/0.86 var(--sf-font-sans);letter-spacing:-0.07em;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--sf-accent)}
.sf-stat__foot{display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*54);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-stat__label{min-width:0;font:800 calc(var(--sf-unit)*7.8)/1.02 var(--sf-font-sans);letter-spacing:-0.035em;color:var(--sf-text);text-wrap:balance}
.sf-stat__label:only-child{grid-column:1/-1}
.sf-stat__note{min-width:0;font:400 calc(var(--sf-unit)*4.2)/1.3 var(--sf-font-sans);color:var(--sf-muted);text-wrap:pretty}
@media (max-aspect-ratio:1/1){.sf-stat__foot{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*4)}}
`,
};
```

`packages/scenes/src/stat/mount.ts`:

```ts
import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { COUNT_SECONDS, statText } from "./timing";

export const mountStat: SceneMount = (el, ctx) => {
  const value = el.querySelector<HTMLElement>("[data-sf-value]");
  const full = value?.dataset.sfValue ?? "";
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      if (!value) return;
      const progress = clamp01((frame - ctx.enterFrames) / (COUNT_SECONDS * ctx.fps));
      value.textContent = statText(full, progress >= 1 ? 1 : easeOutCubic(progress));
    },
  };
};
```

Register both, keeping `terminal` last:

```text
FILE packages/scenes/src/index.ts
<<<<
import { quoteDefinition } from "./quote/definition";
====
import { bulletsDefinition } from "./bullets/definition";
import { bulletsSchema } from "./bullets/schema";
import { quoteDefinition } from "./quote/definition";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
import { statementDefinition } from "./statement/definition";
====
import { statDefinition } from "./stat/definition";
import { statSchema } from "./stat/schema";
import { statementDefinition } from "./statement/definition";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  quoteSchema,
  terminalSchema,
]);
====
  quoteSchema,
  bulletsSchema,
  statSchema,
  terminalSchema,
]);
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  quote: widen(quoteDefinition),
  terminal: widen(terminalDefinition),
====
  quote: widen(quoteDefinition),
  bullets: widen(bulletsDefinition),
  stat: widen(statDefinition),
  terminal: widen(terminalDefinition),
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
import { mountQuote } from "./quote/mount";
import { mountStatement } from "./statement/mount";
====
import { mountBullets } from "./bullets/mount";
import { mountQuote } from "./quote/mount";
import { mountStat } from "./stat/mount";
import { mountStatement } from "./statement/mount";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
  quote: mountQuote,
  terminal: mountTerminal,
====
  quote: mountQuote,
  bullets: mountBullets,
  stat: mountStat,
  terminal: mountTerminal,
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS. The conformance suite now runs for six scene types.

If a `statText` case fails, fix `statText`; the table is the specification.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scenes): bullets and stat scenes"
```

---

### Task 3: `code`

**Files:**
- Create: `packages/scenes/src/code/{langs,schema,highlight,timing,definition,mount}.ts`
- Modify: `packages/scenes/package.json` (dependency), `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/behaviors.test.ts`, `packages/render/test/render.test.ts`

**Interfaces:**
- Produces:
  - `CODE_LANGS` (tuple of language names, including `"text"`), `type CodeLang`, `MAX_CODE_LINES = 16`
  - `highlightLines(source: string, lang: CodeLang): CodeToken[][]` where `interface CodeToken { text: string; kind: "plain" | "comment" | "string" | "keyword" | "number" | "function" }`
  - `codeSchema`, `codeDefinition`, `mountCode`, `codeRevealSeconds(lines: number): number`, `codeHoldSeconds(lines: number, marked: number, caption: string | undefined): number`

- [ ] **Step 1: Add the highlighter**

Run: `pnpm --filter @scenefile/scenes add -E shiki`
Expected: `shiki` added under `dependencies` with an exact version.

- [ ] **Step 2: Write the failing tests**

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  stat: { type: "stat", value: "1,200+", label: "videos rendered", note: "In the first week, from four different models." },
====
  stat: { type: "stat", value: "1,200+", label: "videos rendered", note: "In the first week, from four different models." },
  code: {
    type: "code",
    lang: "typescript",
    source: 'import { render } from "scenefile";\n\nconst video = await render({\n  version: 1,\n  scenes: [{ type: "title", heading: "Ship faster" }],\n});',
    highlight: [5],
    caption: "One call. One file. One video.",
  },
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  stat: { type: "stat", value: "<u>9</u>", label: NASTY, note: NASTY },
====
  stat: { type: "stat", value: "<u>9</u>", label: NASTY, note: NASTY },
  code: { type: "code", lang: "html", source: `${NASTY}\n<script>alert(1)</script>`, caption: NASTY },
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
describe("quote", () => {
====
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
    const tooLong = sceneSchema.safeParse({ type: "code", source: Array.from({ length: 17 }, (_, i) => `l${i}`).join("\n") });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.path).toEqual(["source"]);
    expect(tooLong.error?.issues[0]?.message).toContain("16");
    const badMark = sceneSchema.safeParse({ type: "code", source: "a\nb", highlight: [3] });
    expect(badMark.success).toBe(false);
    expect(badMark.error?.issues[0]?.path).toEqual(["highlight"]);
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
    expect(codeHoldSeconds(6, 1, undefined)).toBeLessThan(codeHoldSeconds(6, 0, undefined));
    expect(codeRevealSeconds(1)).toBeCloseTo(0.3);
  });
});

describe("quote", () => {
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
import { COUNT_SECONDS, statText } from "../src/stat/timing";
====
import { highlightLines } from "../src/code/highlight";
import { codeHoldSeconds, codeRevealSeconds } from "../src/code/timing";
import { COUNT_SECONDS, statText } from "../src/stat/timing";
>>>>
```

The runtime bundle must stay free of the highlighter:

```text
FILE packages/render/test/render.test.ts
<<<<
  it("is small, which proves zod was not bundled into the page", () => {
    const bundle = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
    expect(statSync(bundle).size).toBeLessThan(20_000);
====
  it("is small, which proves neither zod nor the syntax highlighter was bundled into the page", () => {
    const bundle = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
    expect(statSync(bundle).size).toBeLessThan(30_000);
>>>>
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes`
Expected: FAIL, cannot resolve `../src/code/highlight`.

- [ ] **Step 4: Implement**

`packages/scenes/src/code/langs.ts`:

```ts
/** Languages the code scene can color. "text" means no coloring. */
export const CODE_LANGS = [
  "text", "typescript", "tsx", "javascript", "jsx", "json", "bash", "python", "go", "rust",
  "html", "css", "sql", "yaml", "toml", "diff", "dockerfile", "markdown",
  "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "ruby",
] as const;

export type CodeLang = (typeof CODE_LANGS)[number];

/** A scene shows at most this many lines; more cannot be read at the smallest size. */
export const MAX_CODE_LINES = 16;

/** Names people and models use for the languages above. */
export const LANG_ALIASES: Readonly<Record<string, CodeLang>> = {
  ts: "typescript", js: "javascript", node: "javascript", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  py: "python", golang: "go", rs: "rust", yml: "yaml", docker: "dockerfile", md: "markdown",
  kt: "kotlin", "c++": "cpp", "c#": "csharp", cs: "csharp", rb: "ruby", plaintext: "text", txt: "text", plain: "text",
};
```

`packages/scenes/src/code/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";
import { CODE_LANGS, LANG_ALIASES, MAX_CODE_LINES } from "./langs";

function lineCount(source: string): number {
  return source.split(/\r\n?|\n/).length;
}

const langSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const name = value.trim().toLowerCase();
  return LANG_ALIASES[name] ?? name;
}, z.enum(CODE_LANGS));

export const codeSchema = z
  .strictObject({
    type: z.literal("code"),
    lang: langSchema.default("text"),
    source: z.string().min(1).max(2000),
    /** Line numbers, from 1, to draw attention to. */
    highlight: z.array(z.number().int().min(1)).min(1).max(MAX_CODE_LINES).optional(),
    caption: z.string().min(1).max(80).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => lineCount(scene.source) <= MAX_CODE_LINES, {
    path: ["source"],
    message: `"source" is longer than ${MAX_CODE_LINES} lines, the most one scene can show. Show the part that matters, or split it across scenes.`,
  })
  .refine((scene) => (scene.highlight ?? []).every((line) => line <= lineCount(scene.source)), {
    path: ["highlight"],
    message: '"highlight" names a line number that "source" does not have. Lines are counted from 1.',
  });

export type CodeProps = z.infer<typeof codeSchema>;
```

`packages/scenes/src/code/highlight.ts`:

```ts
import { type HighlighterCore, createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import dockerfile from "shiki/langs/dockerfile.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import markdown from "shiki/langs/markdown.mjs";
import php from "shiki/langs/php.mjs";
import python from "shiki/langs/python.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import sql from "shiki/langs/sql.mjs";
import swift from "shiki/langs/swift.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import type { CodeLang } from "./langs";

export type TokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "function";

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

/**
 * The highlighter is given a theme whose "colors" are markers, one per kind
 * of token. Scenes color code with theme variables, so all that is needed from
 * the highlighter is which kind each token is.
 */
const MARKERS: Readonly<Record<string, TokenKind>> = {
  "#000001": "comment",
  "#000002": "string",
  "#000003": "keyword",
  "#000004": "number",
  "#000005": "function",
};

const THEME_NAME = "scenefile-markers";

let highlighter: HighlighterCore | undefined;

function getHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    engine: createJavaScriptRegexEngine(),
    langs: [
      bash, c, cpp, csharp, css, diff, dockerfile, go, html, java, javascript, json, jsx, kotlin,
      markdown, php, python, ruby, rust, sql, swift, toml, tsx, typescript, yaml,
    ],
    themes: [
      {
        name: THEME_NAME,
        type: "dark",
        colors: { "editor.foreground": "#000000", "editor.background": "#ffffff" },
        tokenColors: [
          { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#000001" } },
          { scope: ["string", "punctuation.definition.string"], settings: { foreground: "#000002" } },
          // Object keys in JSON are strings to the grammar, but read as plain names.
          { scope: ["support.type.property-name"], settings: { foreground: "#000000" } },
          { scope: ["keyword", "storage", "storage.type", "storage.modifier"], settings: { foreground: "#000003" } },
          { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#000004" } },
          { scope: ["entity.name.function", "support.function"], settings: { foreground: "#000005" } },
        ],
      },
    ],
  });
  return highlighter;
}

/** Splits source into lines of tokens, each tagged with what kind of token it is. */
export function highlightLines(source: string, lang: CodeLang): CodeToken[][] {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (lang === "text") return normalized.split("\n").map((line) => [{ text: line, kind: "plain" }]);
  return getHighlighter()
    .codeToTokensBase(normalized, { lang, theme: THEME_NAME })
    .map((line) =>
      line.map((token) => ({ text: token.content, kind: MARKERS[(token.color ?? "").toLowerCase()] ?? "plain" })),
    );
}
```

`packages/scenes/src/code/timing.ts`:

```ts
import { readingSeconds } from "../text";

export const LINE_STAGGER_SECONDS = 0.06;
export const LINE_FADE_SECONDS = 0.3;
/** Pause between the last line appearing and the unmarked lines dimming. */
export const FOCUS_DELAY_SECONDS = 0.3;
export const FOCUS_FADE_SECONDS = 0.4;
const READ_SECONDS_PER_LINE = 0.55;

/** Seconds from the first line starting to appear until the last is fully visible. */
export function codeRevealSeconds(lines: number): number {
  return Math.max(0, lines - 1) * LINE_STAGGER_SECONDS + LINE_FADE_SECONDS;
}

/** With marked lines, only those need reading; otherwise all of them do. */
export function codeHoldSeconds(lines: number, marked: number, caption: string | undefined): number {
  const focus = marked > 0 ? FOCUS_DELAY_SECONDS + FOCUS_FADE_SECONDS : 0;
  const read = (marked > 0 ? marked : lines) * READ_SECONDS_PER_LINE;
  return codeRevealSeconds(lines) + focus + read + readingSeconds(caption ?? "");
}
```

`packages/scenes/src/code/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { highlightLines } from "./highlight";
import { type CodeProps, codeSchema } from "./schema";
import { codeHoldSeconds } from "./timing";

function sourceLines(source: string): string[] {
  return source.split(/\r\n?|\n/);
}

export const codeDefinition: SceneDefinition<CodeProps> = {
  type: "code",
  fields: Object.keys(codeSchema.shape),
  enterSeconds: 0.3,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) =>
    codeHoldSeconds(sourceLines(props.source).length, new Set(props.highlight ?? []).size, props.caption),
  summary(props) {
    const lines = sourceLines(props.source);
    const first = lines.find((line) => line.trim() !== "")?.trim() ?? "";
    return `${props.lang}, ${lines.length} ${lines.length === 1 ? "line" : "lines"}: ${first.slice(0, 48)}`;
  },
  texts(props) {
    const texts: SceneText[] = [{ path: "source", text: props.source, font: "mono" }];
    if (props.caption) texts.push({ path: "caption", text: props.caption, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const marked = new Set(props.highlight ?? []);
    const rows = highlightLines(props.source, props.lang)
      .map((tokens, i) => {
        const code = tokens
          .map((token) =>
            token.kind === "plain"
              ? escapeHtml(token.text)
              : `<span class="sf-t-${token.kind}">${escapeHtml(token.text)}</span>`,
          )
          .join("");
        // A blank line still needs content, or it would have no height.
        return `<div class="sf-code__line${marked.has(i + 1) ? " is-marked" : ""}" data-sf-line="${i}"><span class="sf-code__n">${i + 1}</span><span class="sf-code__src">${code || " "}</span></div>`;
      })
      .join("");
    const caption = props.caption
      ? `<p class="sf-code__caption" data-sf-enter="0" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.caption">${escapeHtml(props.caption)}</p>`
      : "";
    return `${sceneChrome(ctx)}<div class="sf-code"><div class="sf-code__block" data-sf-fit="3.4,5,0.2" data-sf-box data-sf-path="${ctx.path}.source">${rows}</div>${caption}</div>`;
  },
  css: `
.sf-code{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;gap:calc(var(--sf-unit)*3)}
.sf-code__block{flex:1;min-height:0;overflow:hidden;font:400 calc(var(--sf-unit)*5)/1.7 var(--sf-font-mono);font-variant-ligatures:none;tab-size:2;color:var(--sf-text)}
.sf-code__line{display:flex;white-space:pre-wrap;overflow-wrap:anywhere;border-left:calc(var(--sf-unit)*0.4) solid transparent;padding-left:calc(var(--sf-unit)*1.6)}
.sf-fitting .sf-code__line{white-space:pre}
.sf-code__line.is-marked{border-left-color:var(--sf-accent)}
.sf-code__n{flex:none;width:2ch;margin-right:3ch;text-align:right;color:var(--sf-muted);opacity:.5}
.sf-code__line.is-marked .sf-code__n{color:var(--sf-accent);opacity:1}
.sf-code__src{min-width:0}
.sf-t-comment{color:var(--sf-muted);opacity:.7}
.sf-t-keyword{color:var(--sf-muted)}
.sf-t-string,.sf-t-number{color:var(--sf-accent)}
.sf-code__caption{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
`,
};
```

`packages/scenes/src/code/mount.ts`:

```ts
import { clamp01, easeOutCubic, fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import {
  FOCUS_DELAY_SECONDS,
  FOCUS_FADE_SECONDS,
  LINE_FADE_SECONDS,
  LINE_STAGGER_SECONDS,
  codeRevealSeconds,
} from "./timing";

/** How visible an unmarked line stays once attention moves to the marked ones. */
const UNFOCUSED = 0.38;

export const mountCode: SceneMount = (el, ctx) => {
  const lines = Array.from(el.querySelectorAll<HTMLElement>("[data-sf-line]"));
  const marked = lines.map((line) => line.classList.contains("is-marked"));
  const focusAt = codeRevealSeconds(lines.length) + FOCUS_DELAY_SECONDS;
  const hasFocus = marked.includes(true);
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      const focus = hasFocus ? easeOutCubic(clamp01((seconds - focusAt) / FOCUS_FADE_SECONDS)) : 0;
      lines.forEach((line, i) => {
        const shown = easeOutCubic(clamp01((seconds - i * LINE_STAGGER_SECONDS) / LINE_FADE_SECONDS));
        const level = marked[i] ? 1 : 1 - focus * (1 - UNFOCUSED);
        line.style.opacity = String(shown * level);
      });
    },
  };
};
```

Register it, keeping `terminal` last:

```text
FILE packages/scenes/src/index.ts
<<<<
import { bulletsSchema } from "./bullets/schema";
====
import { bulletsSchema } from "./bullets/schema";
import { codeDefinition } from "./code/definition";
import { codeSchema } from "./code/schema";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  statSchema,
  terminalSchema,
]);
====
  statSchema,
  codeSchema,
  terminalSchema,
]);
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  stat: widen(statDefinition),
  terminal: widen(terminalDefinition),
====
  stat: widen(statDefinition),
  code: widen(codeDefinition),
  terminal: widen(terminalDefinition),
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
export { durationSchema, type Duration } from "./common";
====
export { CODE_LANGS, type CodeLang, MAX_CODE_LINES } from "./code/langs";
export { durationSchema, type Duration } from "./common";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
import { mountBullets } from "./bullets/mount";
====
import { mountBullets } from "./bullets/mount";
import { mountCode } from "./code/mount";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
  stat: mountStat,
  terminal: mountTerminal,
====
  stat: mountStat,
  code: mountCode,
  terminal: mountTerminal,
>>>>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean.

The conformance "is fully visible on its last frame" check reads `[data-sf-enter]` elements only, so dimmed code lines do not contradict it. The "draws every string" check compares line by line, which is why tokenized code satisfies it.

If the highlighter's types reject the inline theme object, give it an explicit type from `shiki/core`; do not cast to `any`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scenes): code scene with syntax-aware coloring and line focus"
```

---

### Task 4: `outro`, friendlier field names, all scenes together, and the launch example

**Files:**
- Create: `packages/scenes/src/outro/{schema,timing,definition,mount}.ts`, `packages/render/test/scenes.test.ts`
- Modify: `packages/scenes/src/index.ts`, `packages/scenes/src/browser.ts`, `packages/scenes/test/fixtures.ts`, `packages/scenes/test/behaviors.test.ts`, `packages/schema/src/normalize.ts`, `packages/schema/src/distance.ts`, `packages/schema/test/normalize.test.ts`, `packages/schema/test/distance.test.ts`, `examples/launch.json`, `README.md`

**Interfaces:**
- Consumes: `graphemes`, `terminalSchedule`, `typedLength` from `terminal/timing`; `highlightHtml`; `FIXTURES`, `ALL_SCENES`
- Produces: `outroSchema`, `outroDefinition`, `mountOutro`; more entries in the normalizer's field aliases; a stricter `nearest` for short words

- [ ] **Step 1: Write the failing tests**

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
====
  outro: { type: "outro", heading: "Make your first video.", highlight: "first video.", command: "npx scenefile init", url: "scenefile.dev" },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY
>>>>
```

```text
FILE packages/scenes/test/fixtures.ts
<<<<
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
====
  outro: { type: "outro", heading: NASTY, highlight: "<u>x</u>", command: NASTY, url: NASTY },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};
>>>>
```

```text
FILE packages/scenes/test/behaviors.test.ts
<<<<
describe("quote", () => {
====
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

describe("quote", () => {
>>>>
```

`packages/render/test/scenes.test.ts`:

```ts
import { type Composition, check, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { ALL_SCENES } from "../../scenes/test/fixtures";
import { captureFrame, inspectComposition, openComposition } from "../src/index";

function compose(format: string): Composition {
  const result = check({ version: 1, format, scenes: ALL_SCENES });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}

describe("every scene type, in a real browser", () => {
  it.each(["landscape-1080p", "portrait-1080p", "square-1080p"])("fits its ordinary content in %s", async (format) => {
    const report = await inspectComposition(compose(format));
    expect(verifyLayout(report)).toEqual([]);
    const fittedScenes = new Set(report.slots.map((slot) => slot.path.split(".")[0]));
    expect(fittedScenes.size).toBe(ALL_SCENES.length);
    for (const slot of report.slots) expect(slot.sizePx, slot.path).toBeGreaterThanOrEqual(3.4 * 10.8 - 0.01);
  });

  it("draws identical pixels for a frame whatever was drawn before it", async () => {
    const composition = compose("landscape-1080p");
    const total = composition.manifest.totalFrames;
    const frames = Array.from({ length: 48 }, (_, i) => Math.round((i * (total - 1)) / 47));
    let seed = 2026;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const session = await openComposition(composition);
    try {
      const sequential: Buffer[] = [];
      for (const frame of frames) sequential.push(await captureFrame(session.page, frame));
      const mismatched = new Set<number>();
      for (let pass = 0; pass < 2; pass++) {
        const order = frames.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          const a = order[i];
          const b = order[j];
          if (a === undefined || b === undefined) throw new Error("bad index");
          order[i] = b;
          order[j] = a;
        }
        for (const i of order) {
          const frame = frames[i];
          const expected = sequential[i];
          if (frame === undefined || !expected) throw new Error("bad index");
          if (!(await captureFrame(session.page, frame)).equals(expected)) mismatched.add(frame);
        }
      }
      expect([...mismatched].sort((a, b) => a - b)).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it("reports content that cannot fit, for the scenes most likely to be overfilled", async () => {
    const long = "Supercalifragilisticexpialidocious".repeat(4);
    const result = check({
      version: 1,
      scenes: [
        { type: "statement", text: long },
        { type: "code", lang: "ts", source: Array.from({ length: 16 }, (_, i) => `const value${i} = "${"x".repeat(100)}";`).join("\n") },
        { type: "bullets", items: Array.from({ length: 5 }, () => `${"W".repeat(60)} item`) },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const diagnostics = verifyLayout(await inspectComposition(result.composition));
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["TEXT_OVERFLOW", "scenes[0].text"],
      ["TEXT_OVERFLOW", "scenes[1].source"],
      ["TEXT_OVERFLOW", "scenes[2].items"],
    ]);
  });
});
```

Normalizer and suggestion tests:

```text
FILE packages/schema/test/distance.test.ts
<<<<
  it("returns undefined when nothing is close", () => {
====
  it("allows only one wrong letter in a short word", () => {
    expect(nearest("nope", ["title", "code"])).toBeUndefined();
    expect(nearest("time", ["type", "duration"])).toBeUndefined();
    expect(nearest("cod", ["code", "quote"])).toBe("code");
    expect(nearest("stats", ["stat", "statement"])).toBe("stat");
  });

  it("returns undefined when nothing is close", () => {
>>>>
```

```text
FILE packages/schema/test/normalize.test.ts
<<<<
  it("keeps reporting other scenes when one is broken"
====
  it("accepts the field names models reach for first", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [
        { type: "bullets", title: "Why", points: ["a", "b"] },
        { type: "code", language: "ts", code: "x", time: 4 },
        { type: "stat", number: "94%", label: "valid" },
        { type: "quote", quote: "It works.", name: "Dilnoza" },
        { type: "outro", heading: "Try it", cmd: "npx x", link: "x.dev" },
      ],
    });
    expect(diagnostics.every((d) => d.code === "AUTOFIXED" && d.severity === "warning")).toBe(true);
    expect(diagnostics).toHaveLength(10);
    expect(scenefile?.scenes).toMatchObject([
      { type: "bullets", heading: "Why", items: ["a", "b"] },
      { type: "code", lang: "typescript", source: "x", duration: 4 },
      { type: "stat", value: "94%" },
      { type: "quote", text: "It works.", author: "Dilnoza" },
      { type: "outro", command: "npx x", url: "x.dev" },
    ]);
  });

  it("keeps reporting other scenes when one is broken"
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL. `outro` is unknown; `nearest("nope", …)` returns `"code"`; the alias test reports unknown fields.

- [ ] **Step 3: Implement**

`packages/scenes/src/outro/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const outroSchema = z
  .strictObject({
    type: z.literal("outro"),
    heading: z.string().min(1).max(60),
    /** A part of the heading to draw in the accent color. */
    highlight: z.string().min(1).max(60).optional(),
    /** A command for the viewer to run, typed out. */
    command: z.string().min(1).max(80).optional(),
    url: z.string().min(1).max(80).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.heading.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "heading", written exactly as it appears there.',
  });

export type OutroProps = z.infer<typeof outroSchema>;
```

`packages/scenes/src/outro/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { CHARS_PER_SECOND, graphemes } from "../terminal/timing";
import { escapeHtml, highlightHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type OutroProps, outroSchema } from "./schema";
import { TYPE_DELAY_SECONDS } from "./timing";

/** Seconds the finished command stays up so it can be read and remembered. */
const COMMAND_REST_SECONDS = 1.2;

export const outroDefinition: SceneDefinition<OutroProps> = {
  type: "outro",
  fields: Object.keys(outroSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.5,
  minHoldSeconds: 2,
  holdSeconds(props) {
    const typing = props.command
      ? TYPE_DELAY_SECONDS + graphemes(props.command).length / CHARS_PER_SECOND + COMMAND_REST_SECONDS
      : 0;
    return readingSeconds(`${props.heading} ${props.url ?? ""}`) + typing;
  },
  summary: (props) => `${props.heading}${props.command ? ` ($ ${props.command})` : ""}`,
  texts(props) {
    const texts: SceneText[] = [{ path: "heading", text: props.heading, font: "sans" }];
    if (props.command) texts.push({ path: "command", text: props.command, font: "mono" });
    if (props.url) texts.push({ path: "url", text: props.url, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const command = props.command
      ? `<div class="sf-outro__cmd" data-sf-enter="1" data-sf-fit="3.4,5,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.command"><span class="sf-outro__prompt">$</span><span data-sf-type="${escapeHtml(props.command)}"></span><span class="sf-outro__caret"></span></div>`
      : "";
    const url = props.url
      ? `<p class="sf-outro__url" data-sf-enter="2" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.url">${escapeHtml(props.url)}</p>`
      : "";
    const side = command || url ? `<div class="sf-outro__side">${command}${url}</div>` : "";
    return `${sceneChrome(ctx)}<div class="sf-outro"><h1 class="sf-outro__heading" data-sf-enter="0" data-sf-fit="8,22,1" data-sf-lines="3" data-sf-path="${ctx.path}.heading">${highlightHtml(props.heading, props.highlight)}</h1>${side}</div>`;
  },
  css: `
.sf-outro{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);bottom:calc(var(--sf-unit)*10);display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*60);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-outro__heading{min-width:0;font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.92 var(--sf-font-sans);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-outro__heading:only-child{grid-column:1/-1}
.sf-outro__heading em{font-style:normal;color:var(--sf-accent)}
.sf-outro__side{min-width:0;padding-bottom:calc(var(--sf-unit)*1.4)}
.sf-outro__cmd{padding-top:calc(var(--sf-unit)*2.4);border-top:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*5)/1.4 var(--sf-font-mono);font-variant-ligatures:none;white-space:pre-wrap;color:var(--sf-text)}
.sf-outro__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-outro__caret{display:inline-block;width:0.6em;height:1.1em;margin-left:0.1em;vertical-align:text-bottom;background:var(--sf-accent)}
.sf-outro__url{margin-top:calc(var(--sf-unit)*1.6);font:400 calc(var(--sf-unit)*4.6)/1.3 var(--sf-font-sans);color:var(--sf-muted)}
@media (max-aspect-ratio:1/1){.sf-outro{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*6)}.sf-outro__side{padding-bottom:0}}
`,
};
```

`packages/scenes/src/outro/mount.ts`:

```ts
import { fadeExit, staggerEnter } from "../motion";
import { graphemes, terminalSchedule, typedLength } from "../terminal/timing";
import type { SceneMount } from "../types";
import { TYPE_DELAY_SECONDS } from "./timing";

export const mountOutro: SceneMount = (el, ctx) => {
  const typed = el.querySelector<HTMLElement>("[data-sf-type]");
  const chars = graphemes(typed?.dataset.sfType ?? "");
  const [timing] = terminalSchedule([{ run: chars.join("") }]);
  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      if (!typed || !timing) return;
      const seconds = (frame - ctx.enterFrames) / ctx.fps - TYPE_DELAY_SECONDS;
      typed.textContent = chars.slice(0, typedLength(chars.length, timing, seconds)).join("");
    },
  };
};
```

`packages/scenes/src/outro/timing.ts`:

```ts
/**
 * Seconds after the scene has entered before the command starts typing.
 * In its own file because the browser mount needs it, and the mount must not
 * import the definition (which imports the schema, and so zod).
 */
export const TYPE_DELAY_SECONDS = 0.3;
```

Register it, keeping `terminal` last:

```text
FILE packages/scenes/src/index.ts
<<<<
import { quoteDefinition } from "./quote/definition";
====
import { outroDefinition } from "./outro/definition";
import { outroSchema } from "./outro/schema";
import { quoteDefinition } from "./quote/definition";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  codeSchema,
  terminalSchema,
]);
====
  codeSchema,
  outroSchema,
  terminalSchema,
]);
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
  code: widen(codeDefinition),
  terminal: widen(terminalDefinition),
====
  code: widen(codeDefinition),
  outro: widen(outroDefinition),
  terminal: widen(terminalDefinition),
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
import { mountQuote } from "./quote/mount";
====
import { mountOutro } from "./outro/mount";
import { mountQuote } from "./quote/mount";
>>>>
```

```text
FILE packages/scenes/src/browser.ts
<<<<
  code: mountCode,
  terminal: mountTerminal,
====
  code: mountCode,
  outro: mountOutro,
  terminal: mountTerminal,
>>>>
```

Normalizer:

```text
FILE packages/schema/src/normalize.ts
<<<<
  headline: "heading",
  commands: "steps",
};
====
  headline: "heading",
  commands: "steps",
  points: "items",
  bullets: "items",
  list: "items",
  code: "source",
  snippet: "source",
  language: "lang",
  number: "value",
  figure: "value",
  description: "note",
  quote: "text",
  name: "author",
  cmd: "command",
  install: "command",
  link: "url",
  website: "url",
  time: "duration",
  length: "duration",
  seconds: "duration",
};
>>>>
```

```text
FILE packages/schema/src/distance.ts
<<<<
  const limit = Math.max(2, Math.floor(word.length / 3));
====
  // In a short word two wrong letters is most of the word: "nope" is not "code".
  const limit = word.length <= 4 ? 1 : Math.max(2, Math.floor(word.length / 3));
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean.

If the all-scenes fitting test reports a diagnostic in portrait or square, read which slot and fix that scene's layout for narrow frames (a `@media (max-aspect-ratio:1/1)` rule); do not change the fixtures.

- [ ] **Step 5: Write the launch example and look at it**

`examples/launch.json`:

```json
{
  "version": 1,
  "scenes": [
    {
      "type": "title",
      "heading": "Video from JSON.",
      "highlight": "JSON.",
      "sub": "Any model can write a scenefile. The engine does the rest."
    },
    {
      "type": "statement",
      "text": "Models are good at saying what a video should show. Not at drawing it.",
      "highlight": "Not at drawing it."
    },
    {
      "type": "code",
      "lang": "json",
      "source": "{\n  \"version\": 1,\n  \"scenes\": [\n    { \"type\": \"title\", \"heading\": \"Ship faster\" },\n    { \"type\": \"stat\", \"value\": \"3x\", \"label\": \"fewer steps\" }\n  ]\n}",
      "highlight": [4, 5],
      "caption": "Say what each scene shows. No keyframes, no pixels."
    },
    {
      "type": "terminal",
      "steps": [
        { "run": "scenefile check launch.json", "output": "error  TEXT_OVERFLOW  scenes[0].heading\n  fix: Shorten it to about 51 characters (it has 77)." },
        { "run": "scenefile render launch.json -o launch.mp4", "output": "Rendered launch.mp4" }
      ]
    },
    {
      "type": "bullets",
      "heading": "Built for models that cannot see",
      "items": ["Errors come with the fix", "Text sizes itself to fit", "Same file, same frames"]
    },
    {
      "type": "outro",
      "heading": "Write a scenefile.",
      "highlight": "scenefile.",
      "command": "scenefile render launch.json -o launch.mp4"
    }
  ]
}
```

Run:

```bash
pnpm build
node packages/cli/dist/main.js check examples/launch.json
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
ffmpeg -y -loglevel error -i out/launch.mp4 -vf "fps=1/3,scale=960:-1,tile=4x4:padding=6:color=0x444444" -frames:v 1 out/sheet.png
```

Then render one video that uses every scene type (the fixtures in `packages/scenes/test/fixtures.ts`), in landscape and in portrait, and extract a frame from the middle of each scene.

Look at every scene beside `out/directions/signal-*.png`. Fix in scene CSS and re-render until all hold:

- Each scene has one dominant element; nothing competes with it.
- Lime is used once or twice per scene, never as a fill behind text.
- Stat: the number is the largest thing on screen and does not touch the hairline or the label.
- Bullets: rows have even rhythm; dim rows are visibly dim but legible.
- Code: line numbers are quiet; the marked lines are clearly the point; nothing is clipped on the right.
- Quote: the mark does not crowd the text.
- Outro: the command is on one line when it reasonably can be.
- Portrait: every scene stacks cleanly, no text column narrower than a third of the frame.

The numbers in the `stat` fixture and in any stat used for demonstration are illustrations. Do not put an invented statistic about scenefile itself into `examples/` or the README.

- [ ] **Step 6: Update the README**

```text
FILE README.md
<<<<
**Status: early development.** Two scene types (`title`, `terminal`) and two themes
====
**Status: early development.** Eight scene types (`title`, `statement`, `quote`,
`bullets`, `stat`, `code`, `outro`, `terminal`) and two themes
>>>>
```

- [ ] **Step 7: Run everything once more and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS and clean, after any CSS changes from Step 5.

```bash
git add -A
git commit -m "feat(scenes): outro scene, friendlier field names, and the launch example"
```

---

## What Plan 2b-1 leaves for later

| Item | Plan |
|---|---|
| `screenshot`, `compare`, `custom`; asset fetch and cache; `ASSET_NOT_FOUND`, `ASSET_LOW_RES` | 2b-2 |
| Aliases and suggestions for fields nested inside arrays (terminal `steps`) | 2b-2 |
| Stagger measured in seconds rather than frames | 2c, with transitions |
| Everything listed under 2c in Plan 2a | 2c |
