# scenefile Plan 2a — Design Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Videos render in the owner-approved "Signal" look with bundled fonts, text sizes itself to fit, and `check` reports text that cannot fit, all without the model seeing a frame.

**Architecture:** Scenes gain a compile context and declare their text. The engine embeds open-license fonts as data URIs and rejects text the fonts cannot draw. The browser runtime fits every text slot once at start and publishes a report; the engine turns that report into diagnostics and storyboard detail; the CLI runs that inspection inside `check` and before `render`.

**Tech Stack:** As Plan 1, plus `@fontsource-variable/onest` and `@fontsource-variable/jetbrains-mono` (both OFL-1.1).

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md`

## Where this plan sits

Plan 2 of the original three is split, because it is too large to review as one:

- **2a (this plan):** fonts, theme model with `signal` as default, text fitting and the browser `inspect` step, `title` and `terminal` redesigned.
- **2b:** the eight remaining scene types and `custom`, asset fetching, `ASSET_*` and `CODE_TOO_LONG`.
- **2c:** transitions, camera drift, audio, parallel workers, golden frames in Docker, themes `paper` and `terminal`, measured performance.

### Decisions already made by the owner

- Visual direction **A, "Signal"** is the default: pure black, heavy tight grotesk (Onest), acid lime `#C8FF00` as the only color, hairline rules, a small scene counter, code and terminal without window chrome. Reference frames: `out/directions/signal-*.png`.
- No `Co-Authored-By` trailer on commits.

### Deviations from the spec, deliberate

- **Themes in this plan: `signal` (default) and `midnight`.** `paper` and `terminal` need a panel-color token and arrive in 2c with golden frames.
- **Emoji are a warning, not an error.** The spec makes any glyph outside the theme fonts a `GLYPH_MISSING` error. Emoji are legitimate in terminal text and bundling a color emoji font costs about 10 MB, so emoji produce a `GLYPH_FALLBACK` warning (system emoji font, appearance varies by machine) and everything else uncovered stays an error.
- **`title` gains `highlight`.** One part of the heading drawn in the accent color. It is content intent, not styling, and the Signal look depends on it.
- **`check` now needs Chromium.** Text fitting is measured in the browser, so `check` launches it (about one second). The spec's "under 3 s" still holds.

## Global Constraints

All of Plan 1's constraints still apply. In addition:

- Fonts are embedded in the composition as data URIs. The composition contains no `http` URL.
- Only fonts under the SIL Open Font License are bundled.
- Every theme font covers Latin and Cyrillic.
- Text is fitted once, before the first frame, with fonts loaded. Fitting never depends on the frame being drawn.
- Secondary text is never smaller than 3.4 units (about 37 px at 1080p).
- No `Co-Authored-By` trailer on commits.
- After any scene or CSS change, the reproducibility stress test in `packages/render/test/render.test.ts` must be run and must pass.
- **This machine only:** vitest sometimes stalls at 0% CPU under the agent sandbox; if a run shows no output for 60 s, kill it and rerun.

## Review Focus

1. **Cyrillic and Uzbek Latin text** (`Привет`, `oʻzbek`). Expected: drawn in the bundled font. Task 2.
2. **Text in a script the fonts lack** (CJK, Arabic). Expected: `GLYPH_MISSING` error naming the characters, not boxes in the video. Task 2.
3. **Portrait and square formats.** Expected: the title layout still gives the heading most of the width. Task 3.
4. **`highlight` that is not in the heading, or that contains HTML.** Expected: a diagnostic on `highlight`; HTML shown literally. Task 1.
5. **Chromium missing when running `check`.** Expected: exit 2 with the install hint. Task 3.

## How edits are written in this plan

New and fully replaced files are given whole, under their path. Small changes to existing files are given as edit blocks:

```text
FILE path/to/file
<<<<
exact existing text
====
replacement text
>>>>
```

Each `<<<<` text occurs exactly once in its file. Apply every block; a block whose text is not found is a plan defect to rule on, not to skip.

---

### Task 1: Scene context, declared text, Signal markup, theme model

**Files:**
- Create: `packages/scenes/src/chrome.ts`, `packages/engine/test/themes.test.ts`
- Replace: `packages/scenes/src/types.ts`, `packages/scenes/src/title/schema.ts`, `packages/scenes/src/title/definition.ts`, `packages/scenes/src/terminal/definition.ts`, `packages/engine/src/themes.ts`, `packages/engine/src/compile.ts`, `packages/scenes/test/title.test.ts`
- Modify: `packages/scenes/src/index.ts`, `packages/schema/src/scenefile.ts`, `packages/engine/src/resolve.ts`, and tests in `packages/scenes/test`, `packages/schema/test`, `packages/engine/test`

**Interfaces:**
- Produces:
  - `interface CompileContext { index: number; total: number; path: string }` (`path` is the scene's scenefile path, e.g. `scenes[2]`)
  - `interface SceneText { path: string; text: string; font: "sans" | "mono" }` (`path` relative to the scene, e.g. `heading`, `steps[0].run`)
  - `SceneDefinition<P>` changes: `compile(props: P, ctx: CompileContext): string`, new `texts(props: P): SceneText[]`
  - `sceneChrome(ctx: CompileContext): string`, `SHARED_CSS: string` (exported from `@scenefile/scenes`)
  - Fit-slot attributes on text elements: `data-sf-fit="min,max,step"` (font sizes in units), optional `data-sf-lines="n"`, optional `data-sf-box` (element has a fixed height that content must fit), `data-sf-path="scenes[i].field"`
  - `THEMES = ["signal", "midnight"]`, default `signal`
  - `interface Theme { background; surface; line; text; muted; accent: string; fontSans: FontKey; fontMono: FontKey; headingWeight: number; headingTracking: string }`, `type FontKey = "onest" | "jetbrainsMono"`, `getTheme(name: ThemeName): Theme`, `themeCss(name, accent, width, height): string`, `contrastRatio(a: string, b: string): number`
  - Diagnostic `CONTRAST_LOW` (error, path `accent`)

- [ ] **Step 1: Write the failing tests**

`packages/scenes/test/title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeHtml, readingSeconds } from "../src/text";
import { titleDefinition } from "../src/title/definition";
import { titleSchema } from "../src/title/schema";

const ctx = { index: 0, total: 8, path: "scenes[0]" };
const compile = (input: Record<string, unknown>, at = ctx): string =>
  titleDefinition.compile(titleSchema.parse({ type: "title", ...input }), at);

describe("text helpers", () => {
  it("counts reading time at three words per second", () => {
    expect(readingSeconds("one two three four five six")).toBe(2);
    expect(readingSeconds("   ")).toBe(0);
  });

  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`</script><b a="1">&'`)).toBe(
      "&lt;/script&gt;&lt;b a=&quot;1&quot;&gt;&amp;&#39;",
    );
  });
});

describe("title scene", () => {
  it("accepts a heading alone and defaults duration to auto", () => {
    const parsed = titleSchema.parse({ type: "title", heading: "Ship faster" });
    expect(parsed.duration).toBe("auto");
    expect(parsed.sub).toBeUndefined();
  });

  it("rejects an empty heading and unknown fields", () => {
    expect(titleSchema.safeParse({ type: "title", heading: "" }).success).toBe(false);
    expect(titleSchema.safeParse({ type: "title", heading: "x", color: "red" }).success).toBe(false);
  });

  it("lists its fields", () => {
    expect(titleDefinition.fields).toEqual(["type", "heading", "highlight", "sub", "duration"]);
  });

  it("requires highlight to be part of the heading", () => {
    const base = { type: "title", heading: "Video from JSON." };
    expect(titleSchema.safeParse({ ...base, highlight: "JSON." }).success).toBe(true);
    const bad = titleSchema.safeParse({ ...base, highlight: "json" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["highlight"]);
    expect(bad.error?.issues[0]?.message).toContain("heading");
  });

  it("compiles escaped text into fit slots that carry their scenefile path", () => {
    const html = compile({ heading: "A <b> tag", sub: "Tom & Jerry" });
    expect(html).toContain('data-sf-path="scenes[0].heading">A &lt;b&gt; tag</h1>');
    expect(html).toContain('data-sf-path="scenes[0].sub">Tom &amp; Jerry</p>');
    expect(html).toMatch(/<h1 [^>]*data-sf-enter="0"[^>]*data-sf-fit="[\d.,]+"[^>]*data-sf-lines="3"/);
    expect(html).toMatch(/<p [^>]*data-sf-enter="1"[^>]*data-sf-fit="[\d.,]+"/);
  });

  it("wraps the highlighted part, escaped, and nothing else", () => {
    const html = compile({ heading: "Fast & <safe> video", highlight: "<safe>" });
    expect(html).toContain("Fast &amp; <em>&lt;safe&gt;</em> video</h1>");
    expect(html.match(/<em>/g)).toHaveLength(1);
  });

  it("shows the scene's position in the video", () => {
    expect(compile({ heading: "x" }, { index: 2, total: 8, path: "scenes[2]" })).toContain("<b>03</b> / 08");
  });

  it("omits the sub element when there is no sub", () => {
    expect(compile({ heading: "Solo" })).not.toContain("sf-title__sub");
  });

  it("holds for the reading time of heading and sub together", () => {
    const props = titleSchema.parse({ type: "title", heading: "one two three", sub: "four five six" });
    expect(titleDefinition.holdSeconds(props)).toBe(2);
    expect(titleDefinition.summary(props)).toBe("one two three");
  });

  it("declares its text for font checks", () => {
    const props = titleSchema.parse({ type: "title", heading: "A", sub: "B" });
    expect(titleDefinition.texts(props)).toEqual([
      { path: "heading", text: "A", font: "sans" },
      { path: "sub", text: "B", font: "sans" },
    ]);
    expect(titleDefinition.texts(titleSchema.parse({ type: "title", heading: "A" }))).toHaveLength(1);
  });
});
```

`packages/engine/test/themes.test.ts`:

```ts
import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import { resolve } from "../src/resolve";
import { contrastRatio, getTheme, themeCss } from "../src/themes";

function resolved(input: unknown) {
  const { scenefile, diagnostics } = normalize(input);
  if (!scenefile) throw new Error(JSON.stringify(diagnostics));
  return resolve(scenefile);
}

const scenes = [{ type: "title", heading: "one two three", sub: "four five six" }];

describe("themes", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#123456", "#123456")).toBe(1);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(contrastRatio("#000000", "#FFFFFF"));
  });

  it("makes signal the default: pure black with an acid lime accent", () => {
    const { video } = resolved({ version: 1, scenes });
    expect(video.theme).toBe("signal");
    expect(getTheme("signal")).toMatchObject({ background: "#000000", accent: "#C8FF00", headingWeight: 900 });
    const css = themeCss("signal", undefined, 1920, 1080);
    expect(css).toContain("--sf-bg:#000000");
    expect(css).toContain("--sf-accent:#C8FF00");
    expect(css).toContain("--sf-heading-weight:900");
    expect(css).toContain('--sf-font-sans:"Onest"');
    expect(css).toContain('--sf-font-mono:"JetBrains Mono"');
  });

  it("keeps every theme's own colors readable", () => {
    for (const name of ["signal", "midnight"] as const) {
      const theme = getTheme(name);
      expect(contrastRatio(theme.text, theme.background)).toBeGreaterThan(7);
      expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThan(4.5);
      expect(contrastRatio(theme.accent, theme.background)).toBeGreaterThan(4.5);
    }
  });

  it("rejects an accent that cannot be read on the theme background", () => {
    const { diagnostics } = resolved({ version: 1, accent: "#1A1A1A", scenes });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "CONTRAST_LOW", severity: "error", path: "accent" }),
    ]);
    expect(diagnostics[0]?.message).toMatch(/1\.\d:1/);
    expect(resolved({ version: 1, accent: "#FF5722", scenes }).diagnostics).toEqual([]);
  });

  it("gives each scene its position and includes the shared chrome styles once", () => {
    const { video } = resolved({ version: 1, scenes: [...scenes, { type: "terminal", steps: [{ run: "ls" }] }] });
    const { html } = compile(video);
    expect(html).toContain("<b>01</b> / 02");
    expect(html).toContain("<b>02</b> / 02");
    expect(html.match(/\.sf-chrome\{/g)).toHaveLength(1);
    expect(html).toContain('data-sf-path="scenes[1].steps"');
  });
});
```

Apply these edits to existing tests:

```text
FILE packages/scenes/test/terminal.test.ts
<<<<
describe("terminal timing", () => {
====
const ctx = { index: 1, total: 3, path: "scenes[1]" };

describe("terminal timing", () => {
>>>>
```

```text
FILE packages/scenes/test/terminal.test.ts
<<<<
    const html = terminalDefinition.compile(props);
    expect(html).toContain('data-sf-type="echo &quot;&lt;hi&gt;&quot;"');
====
    const html = terminalDefinition.compile(props, ctx);
    expect(html).toContain('data-sf-fit=');
    expect(html).toContain('data-sf-path="scenes[1].steps"');
    expect(terminalDefinition.texts(props)).toEqual([
      { path: "steps[0].run", text: 'echo "<hi>"', font: "mono" },
      { path: "steps[0].output", text: "<hi>", font: "mono" },
      { path: "steps[1].run", text: "ls", font: "mono" },
    ]);
    expect(html).toContain('data-sf-type="echo &quot;&lt;hi&gt;&quot;"');
>>>>
```

```text
FILE packages/scenes/test/mounts.test.ts
<<<<
const titleHtml = titleDefinition.compile(
  titleSchema.parse({ type: "title", heading: "Ship faster", sub: "A CLI" }),
);
const terminalHtml = terminalDefinition.compile(
  terminalSchema.parse({ type: "terminal", steps: [{ run: "npm i", output: "done" }, { run: "🚀 go" }] }),
);
====
const at = { index: 0, total: 2, path: "scenes[0]" };
const titleHtml = titleDefinition.compile(
  titleSchema.parse({ type: "title", heading: "Ship faster", sub: "A CLI" }),
  at,
);
const terminalHtml = terminalDefinition.compile(
  terminalSchema.parse({ type: "terminal", steps: [{ run: "npm i", output: "done" }, { run: "🚀 go" }] }),
  at,
);
>>>>
```

```text
FILE packages/scenes/test/mounts.test.ts
<<<<
      terminalSchema.parse({ type: "terminal", steps: [{ run: "🇺🇿👨‍👩‍👧 ok" }] }),
    );
====
      terminalSchema.parse({ type: "terminal", steps: [{ run: "🇺🇿👨‍👩‍👧 ok" }] }),
      at,
    );
>>>>
```

```text
FILE packages/schema/test/normalize.test.ts
<<<<
      theme: "midnight",
      scenes: [{ type: "title", heading: "Hi", duration: "auto" }],
====
      theme: "signal",
      scenes: [{ type: "title", heading: "Hi", duration: "auto" }],
>>>>
```

```text
FILE packages/engine/test/compile.test.ts
<<<<
    expect(titleOnly.html).not.toContain(".sf-terminal__window");
====
    expect(titleOnly.html).not.toContain(".sf-terminal__body");
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes packages/schema packages/engine`
Expected: FAIL. `title.test.ts` fails on the fields list and on `compile` output; `themes.test.ts` cannot import `contrastRatio`; the normalize default-theme test fails.

- [ ] **Step 3: Implement**

`packages/scenes/src/types.ts`:

```ts
/** Where a scene sits in the video, given to its compiler. */
export interface CompileContext {
  readonly index: number;
  readonly total: number;
  /** The scene's path in the scenefile, e.g. `scenes[2]`. */
  readonly path: string;
}

/** One piece of text a scene draws, declared so fonts can be checked before rendering. */
export interface SceneText {
  /** Path relative to the scene, e.g. `heading` or `steps[0].run`. */
  path: string;
  text: string;
  font: "sans" | "mono";
}

/** Everything the engine needs to know about one scene type. */
export interface SceneDefinition<P> {
  readonly type: string;
  /** Field names the scene accepts, used for "did you mean" suggestions. */
  readonly fields: readonly string[];
  readonly enterSeconds: number;
  readonly exitSeconds: number;
  readonly minHoldSeconds: number;
  /** Seconds the scene must stay fully visible for its content to be read. */
  holdSeconds(props: P): number;
  /** One line describing the scene, for the text storyboard. */
  summary(props: P): string;
  /** Every string the scene draws. */
  texts(props: P): SceneText[];
  /**
   * Inner HTML of the scene's <section>. All text must be escaped.
   *
   * Text that should size itself carries `data-sf-fit="min,max,step"` (font
   * sizes in units), `data-sf-path` (its scenefile path, for diagnostics),
   * and either `data-sf-lines="n"` or `data-sf-box` (fit inside the element's
   * own fixed height).
   */
  compile(props: P, ctx: CompileContext): string;
  readonly css: string;
}

export interface MountContext {
  readonly fps: number;
  readonly durationFrames: number;
  readonly enterFrames: number;
  readonly exitFrames: number;
}

export interface SceneHandle {
  /** Must be pure: the DOM after seek(n) depends only on n. */
  seek(localFrame: number): void;
}

export type SceneMount = (el: HTMLElement, ctx: MountContext) => SceneHandle;
```

`packages/scenes/src/chrome.ts`:

```ts
import type { CompileContext } from "./types";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** The counter and hairline every scene carries at the top of the frame. */
export function sceneChrome(ctx: CompileContext): string {
  return `<div class="sf-chrome"><span class="sf-chrome__index"><b>${twoDigits(ctx.index + 1)}</b> / ${twoDigits(ctx.total)}</span></div>`;
}

/** Styles shared by all scenes. Included once per composition. */
export const SHARED_CSS = `
.sf-chrome{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*5.5);padding-bottom:calc(var(--sf-unit)*2.4);border-bottom:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*2.4)/1 var(--sf-font-mono);color:var(--sf-muted)}
.sf-chrome__index b{font-weight:500;color:var(--sf-accent)}
`;
```

`packages/scenes/src/title/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const titleSchema = z
  .strictObject({
    type: z.literal("title"),
    heading: z.string().min(1).max(80),
    /** A part of the heading to draw in the accent color. */
    highlight: z.string().min(1).max(80).optional(),
    sub: z.string().min(1).max(140).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.heading.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "heading", written exactly as it appears there.',
  });

export type TitleProps = z.infer<typeof titleSchema>;
```

`packages/scenes/src/title/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type TitleProps, titleSchema } from "./schema";

function headingHtml(heading: string, highlight: string | undefined): string {
  const at = highlight === undefined ? -1 : heading.indexOf(highlight);
  if (highlight === undefined || at < 0) return escapeHtml(heading);
  return `${escapeHtml(heading.slice(0, at))}<em>${escapeHtml(highlight)}</em>${escapeHtml(heading.slice(at + highlight.length))}`;
}

export const titleDefinition: SceneDefinition<TitleProps> = {
  type: "title",
  fields: Object.keys(titleSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds: (props) => readingSeconds(`${props.heading} ${props.sub ?? ""}`),
  summary: (props) => props.heading,
  texts(props) {
    const texts = [{ path: "heading", text: props.heading, font: "sans" as const }];
    if (props.sub) texts.push({ path: "sub", text: props.sub, font: "sans" as const });
    return texts;
  },
  compile(props, ctx) {
    const sub = props.sub
      ? `<p class="sf-title__sub" data-sf-enter="1" data-sf-fit="3.4,4.6,0.2" data-sf-lines="4" data-sf-path="${ctx.path}.sub">${escapeHtml(props.sub)}</p>`
      : "";
    return `${sceneChrome(ctx)}<div class="sf-title"><h1 class="sf-title__heading" data-sf-enter="0" data-sf-fit="8,22,1" data-sf-lines="3" data-sf-path="${ctx.path}.heading">${headingHtml(props.heading, props.highlight)}</h1>${sub}</div>`;
  },
  css: `
.sf-title{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);bottom:calc(var(--sf-unit)*10);display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*44);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-title__heading{min-width:0;font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.92 var(--sf-font-sans);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-title__heading:only-child{grid-column:1/-1}
.sf-title__heading em{font-style:normal;color:var(--sf-accent)}
.sf-title__sub{min-width:0;font:400 calc(var(--sf-unit)*4.6)/1.28 var(--sf-font-sans);color:var(--sf-muted);padding-bottom:calc(var(--sf-unit)*1.4);text-wrap:balance}
@media (max-aspect-ratio:1/1){.sf-title{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*5)}.sf-title__sub{padding-bottom:0;max-width:calc(var(--sf-unit)*70)}}
`,
};
```

`packages/scenes/src/terminal/definition.ts`:

```ts
import { sceneChrome } from "../chrome";
import { escapeHtml } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type TerminalProps, terminalSchema } from "./schema";
import { TAIL_SECONDS, terminalSchedule } from "./timing";

export const terminalDefinition: SceneDefinition<TerminalProps> = {
  type: "terminal",
  fields: Object.keys(terminalSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds(props) {
    const last = terminalSchedule(props.steps).at(-1);
    return (last ? last.end : 0) + TAIL_SECONDS;
  },
  summary(props) {
    const first = props.steps[0];
    const more = props.steps.length - 1;
    return `$ ${first ? first.run : ""}${more > 0 ? ` (+${more} more)` : ""}`;
  },
  texts(props) {
    return props.steps.flatMap((step, i): SceneText[] => {
      const texts: SceneText[] = [{ path: `steps[${i}].run`, text: step.run, font: "mono" }];
      if (step.output) texts.push({ path: `steps[${i}].output`, text: step.output, font: "mono" });
      return texts;
    });
  },
  compile(props, ctx) {
    const steps = props.steps
      .map((step) => {
        const output = step.output
          ? `<pre class="sf-terminal__out" data-sf-out>${escapeHtml(step.output)}</pre>`
          : "";
        return `<div class="sf-terminal__step"><div class="sf-terminal__cmd"><span class="sf-terminal__prompt">$</span><span data-sf-type="${escapeHtml(step.run)}"></span><span class="sf-terminal__caret"></span></div>${output}</div>`;
      })
      .join("");
    return `${sceneChrome(ctx)}<div class="sf-terminal"><div class="sf-terminal__body" data-sf-enter="0" data-sf-fit="2.6,4.4,0.2" data-sf-box data-sf-path="${ctx.path}.steps">${steps}</div></div>`;
  },
  css: `
.sf-terminal{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*9)}
.sf-terminal__body{display:flex;flex-direction:column;gap:0.7em;height:100%;overflow:hidden;font:400 calc(var(--sf-unit)*4.4)/1.5 var(--sf-font-mono);color:var(--sf-text)}
.sf-terminal__cmd{white-space:pre-wrap;overflow-wrap:anywhere}
.sf-terminal__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-terminal__caret{display:inline-block;width:0.6em;height:1.1em;margin-left:0.1em;vertical-align:text-bottom;background:var(--sf-accent)}
.sf-terminal__out{font:inherit;color:var(--sf-muted);white-space:pre-wrap;overflow-wrap:anywhere}
`,
};
```

`packages/engine/src/themes.ts`:

```ts
import type { ThemeName } from "@scenefile/schema";

export type FontKey = "onest" | "jetbrainsMono";

/** CSS family name for each bundled font. */
export const FONT_FAMILIES: Record<FontKey, string> = {
  onest: "Onest",
  jetbrainsMono: "JetBrains Mono",
};

export interface Theme {
  background: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontSans: FontKey;
  fontMono: FontKey;
  headingWeight: number;
  headingTracking: string;
}

/** Neutral greys only: no hue tint in the darks. */
const THEME_TOKENS: Record<ThemeName, Theme> = {
  signal: {
    background: "#000000",
    surface: "#0D0D0D",
    line: "#2B2B2B",
    text: "#F2F2F2",
    muted: "#9A9A9A",
    accent: "#C8FF00",
    fontSans: "onest",
    fontMono: "jetbrainsMono",
    headingWeight: 900,
    headingTracking: "-0.055em",
  },
  midnight: {
    background: "#0A0A0A",
    surface: "#141414",
    line: "#2A2A2A",
    text: "#F4F4F4",
    muted: "#8C8C8C",
    accent: "#FF5A1F",
    fontSans: "onest",
    fontMono: "jetbrainsMono",
    headingWeight: 800,
    headingTracking: "-0.04em",
  },
};

export function getTheme(name: ThemeName): Theme {
  return THEME_TOKENS[name];
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** CSS custom properties for a theme. `--sf-unit` is 1% of the short side of the frame. */
export function themeCss(name: ThemeName, accent: string | undefined, width: number, height: number): string {
  const theme = getTheme(name);
  return [
    ":root{",
    `--sf-bg:${theme.background};`,
    `--sf-surface:${theme.surface};`,
    `--sf-line:${theme.line};`,
    `--sf-text:${theme.text};`,
    `--sf-muted:${theme.muted};`,
    `--sf-accent:${accent ?? theme.accent};`,
    `--sf-font-sans:"${FONT_FAMILIES[theme.fontSans]}",sans-serif;`,
    `--sf-font-mono:"${FONT_FAMILIES[theme.fontMono]}",monospace;`,
    `--sf-heading-weight:${theme.headingWeight};`,
    `--sf-heading-tracking:${theme.headingTracking};`,
    `--sf-unit:${Math.min(width, height) / 100}px`,
    "}",
  ].join("");
}
```

`packages/engine/src/compile.ts`:

```ts
import { SHARED_CSS, getScene } from "@scenefile/scenes";
import type { ResolvedVideo } from "./resolve";
import { themeCss } from "./themes";

export interface ManifestScene {
  index: number;
  type: string;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
}

/** What the browser runtime needs to place scenes in time. Contains no user text. */
export interface Manifest {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  scenes: ManifestScene[];
}

export interface Composition {
  html: string;
  manifest: Manifest;
}

function baseCss(width: number, height: number): string {
  return [
    "*{box-sizing:border-box;margin:0;padding:0}",
    `html,body{width:${width}px;height:${height}px;overflow:hidden;background:var(--sf-bg);color:var(--sf-text);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`,
    "#sf-stage{position:relative;width:100%;height:100%}",
    ".sf-scene{position:absolute;inset:0}",
    ".sf-scene[hidden]{display:none}",
  ].join("");
}

/** Builds the single HTML document Chromium renders. Deterministic: no clock, no network. */
export function compile(video: ResolvedVideo): Composition {
  const manifest: Manifest = {
    fps: video.fps,
    width: video.width,
    height: video.height,
    totalFrames: video.totalFrames,
    scenes: video.scenes.map(({ index, type, startFrame, durationFrames, enterFrames, exitFrames }) => ({
      index, type, startFrame, durationFrames, enterFrames, exitFrames,
    })),
  };

  const usedTypes = [...new Set(video.scenes.map((scene) => scene.type))];
  const sceneCss = usedTypes.map((type) => getScene(type).css.trim()).join("\n");
  const total = video.scenes.length;
  const sections = video.scenes
    .map((scene) => {
      const inner = getScene(scene.type).compile(scene.props, {
        index: scene.index,
        total,
        path: `scenes[${scene.index}]`,
      });
      return `<section class="sf-scene" data-sf-scene="${scene.index}" data-sf-type="${scene.type}" hidden>${inner}</section>`;
    })
    .join("\n");
  // "<" is escaped so nothing in the JSON can end the script element.
  const manifestJson = JSON.stringify(manifest).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
${SHARED_CSS.trim()}
${sceneCss}</style>
</head>
<body>
<div id="sf-stage">
${sections}
</div>
<script id="sf-manifest" type="application/json">${manifestJson}</script>
</body>
</html>`;

  return { html, manifest };
}
```

Edits:

```text
FILE packages/scenes/src/index.ts
<<<<
export { durationSchema, type Duration } from "./common";
====
export { SHARED_CSS, sceneChrome } from "./chrome";
export { durationSchema, type Duration } from "./common";
>>>>
```

```text
FILE packages/scenes/src/index.ts
<<<<
export type { MountContext, SceneDefinition, SceneHandle, SceneMount } from "./types";
====
export type {
  CompileContext,
  MountContext,
  SceneDefinition,
  SceneHandle,
  SceneMount,
  SceneText,
} from "./types";
>>>>
```

```text
FILE packages/schema/src/scenefile.ts
<<<<
export const THEMES = ["midnight"] as const;
====
export const THEMES = ["signal", "midnight"] as const;
>>>>
```

```text
FILE packages/schema/src/scenefile.ts
<<<<
  theme: z.enum(THEMES).default("midnight"),
====
  theme: z.enum(THEMES).default("signal"),
>>>>
```

```text
FILE packages/engine/src/resolve.ts
<<<<
import { FORMAT_SIZES } from "./formats";
====
import { FORMAT_SIZES } from "./formats";
import { contrastRatio, getTheme } from "./themes";
>>>>
```

```text
FILE packages/engine/src/resolve.ts
<<<<
const FAST_RATIO = 0.75;
const SLOW_RATIO = 3;
====
const FAST_RATIO = 0.75;
const SLOW_RATIO = 3;
/** WCAG's minimum for large text, which is what the accent is used for. */
const MIN_ACCENT_CONTRAST = 3;
>>>>
```

```text
FILE packages/engine/src/resolve.ts
<<<<
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;
====
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  if (scenefile.accent !== undefined) {
    const ratio = contrastRatio(scenefile.accent, getTheme(scenefile.theme).background);
    if (ratio < MIN_ACCENT_CONTRAST) {
      diagnostics.push(
        error(
          "CONTRAST_LOW",
          "accent",
          `Accent ${scenefile.accent} has a contrast of ${ratio.toFixed(1)}:1 against the "${scenefile.theme}" background; text in it cannot be read.`,
          `Choose a color with at least ${MIN_ACCENT_CONTRAST}:1 contrast, or remove "accent" to use the theme's own.`,
        ),
      );
    }
  }
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS for every package. If `titleSchema.shape` is missing after `.refine` (Zod wrapped the object), keep the tests as they are and express the same rule in a form that preserves the object type.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scene context, declared text, Signal markup, and theme model"
```

---

### Task 2: Bundled fonts and glyph coverage

**Files:**
- Create: `packages/engine/src/fonts.ts`, `packages/engine/test/fonts.test.ts`
- Modify: `packages/engine/package.json` (dependencies), `packages/engine/src/compile.ts`, `packages/engine/src/check.ts`, `packages/engine/src/index.ts`, `packages/render/test/render.test.ts`

**Interfaces:**
- Consumes: `FontKey`, `FONT_FAMILIES`, `getTheme` (Task 1); `SceneDefinition.texts` (Task 1); `ResolvedVideo`
- Produces:
  - `loadFont(key: FontKey): LoadedFont` where `interface LoadedFont { family: string; weight: string; subsets: FontSubset[] }` and `interface FontSubset { name: string; unicodeRange: string; ranges: [number, number][]; file: string }`
  - `fontCovers(font: LoadedFont, codePoint: number): boolean`
  - `fontFaceCss(key: FontKey, text: string): string` (rules for the subsets `text` needs; `latin` always)
  - `videoTexts(video: ResolvedVideo): { path: string; text: string; font: "sans" | "mono" }[]` (absolute paths)
  - `glyphDiagnostics(video: ResolvedVideo): Diagnostic[]` with codes `GLYPH_MISSING` (error) and `GLYPH_FALLBACK` (warning)

- [ ] **Step 1: Add the font packages**

Run:

```bash
pnpm --filter @scenefile/engine add @fontsource-variable/onest @fontsource-variable/jetbrains-mono
```

Expected: both added under `dependencies`. Each package has `files/<slug>-<subset>-wght-normal.woff2` and a `unicode.json` mapping subset name to a CSS `unicode-range`.

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/fonts.test.ts`:

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check";
import { fontCovers, fontFaceCss, loadFont } from "../src/fonts";

const cp = (char: string): number => char.codePointAt(0) ?? 0;

describe("bundled fonts", () => {
  it.each(["onest", "jetbrainsMono"] as const)("%s ships Latin and Cyrillic files", (key) => {
    const font = loadFont(key);
    const names = font.subsets.map((subset) => subset.name);
    expect(names).toEqual(expect.arrayContaining(["latin", "latin-ext", "cyrillic"]));
    for (const subset of font.subsets) expect(existsSync(subset.file), subset.file).toBe(true);
  });

  it("covers Latin, Cyrillic and Uzbek Latin, but not CJK", () => {
    const font = loadFont("onest");
    for (const char of ["A", "é", "Ж", "ў", "ʻ", "₽"]) expect(fontCovers(font, cp(char)), char).toBe(true);
    for (const char of ["日", "ع", "한"]) expect(fontCovers(font, cp(char)), char).toBe(false);
  });

  it("embeds only the subsets the text needs, with Latin always present", () => {
    const latin = fontFaceCss("onest", "Hello");
    expect(latin.match(/@font-face/g)).toHaveLength(1);
    expect(latin).toContain('font-family:"Onest"');
    expect(latin).toContain("src:url(data:font/woff2;base64,");
    expect(latin).toContain("unicode-range:");

    const mixed = fontFaceCss("onest", "Привет");
    expect(mixed.match(/@font-face/g)).toHaveLength(2);
    expect(fontFaceCss("onest", "").match(/@font-face/g)).toHaveLength(1);
  });
});

describe("glyph checks in check()", () => {
  const withTitle = (heading: string) =>
    check({ version: 1, scenes: [{ type: "title", heading, sub: "one two three four five six" }] });

  it("accepts Cyrillic and Uzbek Latin without diagnostics", () => {
    expect(withTitle("Привет, дунё").diagnostics).toEqual([]);
    expect(withTitle("Oʻzbekiston").diagnostics).toEqual([]);
  });

  it("rejects text the theme font cannot draw, naming the characters once each", () => {
    const result = withTitle("日本語 video 日");
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GLYPH_MISSING", severity: "error", path: "scenes[0].heading" }),
    ]);
    expect(result.diagnostics[0]?.message).toContain("日 本 語");
    expect(result.diagnostics[0]?.message).toContain("Onest");
  });

  it("warns, without failing, when text contains emoji", () => {
    const result = check({
      version: 1,
      scenes: [{ type: "terminal", steps: [{ run: "🚀 deploy 🇺🇿", output: "ok" }, { run: "echo done please now" }] }],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GLYPH_FALLBACK", severity: "warning", path: "scenes[0].steps[0].run" }),
    ]);
  });

  it("embeds the fonts in the composition and references nothing remote", () => {
    const { composition } = withTitle("Привет");
    const html = composition?.html ?? "";
    expect(html).toContain('font-family:"Onest"');
    expect(html).toContain('font-family:"JetBrains Mono"');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.length).toBeLessThan(600_000);
  });
});
```

Add to `packages/render/test/render.test.ts`:

```text
FILE packages/render/test/render.test.ts
<<<<
  it("wraps long commands and long words instead of clipping them", async () => {
====
  it("draws text in the bundled fonts, including Cyrillic", async () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", heading: "Привет", sub: "one two three four five six" }],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const session = await openComposition(result.composition);
    try {
      await captureFrame(session.page, 40);
      const fonts = await session.page.evaluate(() => {
        const heading = document.querySelector(".sf-title__heading");
        return {
          loaded: Array.from(document.fonts, (face) => `${face.family}:${face.status}`),
          family: heading ? getComputedStyle(heading).fontFamily : "",
          cyrillicOk: document.fonts.check('900 40px "Onest"', "Привет"),
        };
      });
      expect(fonts.family).toContain("Onest");
      expect(fonts.cyrillicOk).toBe(true);
      expect(fonts.loaded.length).toBeGreaterThanOrEqual(3);
      expect(fonts.loaded.every((entry) => entry.endsWith(":loaded"))).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("wraps long commands and long words instead of clipping them", async () => {
>>>>
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/engine packages/render`
Expected: FAIL. `fonts.test.ts` cannot import `../src/fonts`; the render font test fails because no font is embedded.

- [ ] **Step 4: Implement**

`packages/engine/src/fonts.ts`:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type Diagnostic, error, warning } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import type { ResolvedVideo } from "./resolve";
import { FONT_FAMILIES, type FontKey, getTheme } from "./themes";

const require = createRequire(import.meta.url);

/** Where each bundled font comes from. All are SIL Open Font License 1.1. */
const SOURCES: Record<FontKey, { pkg: string; slug: string; weight: string }> = {
  onest: { pkg: "@fontsource-variable/onest", slug: "onest", weight: "100 900" },
  jetbrainsMono: { pkg: "@fontsource-variable/jetbrains-mono", slug: "jetbrains-mono", weight: "100 800" },
};

export interface FontSubset {
  name: string;
  /** CSS `unicode-range` value. */
  unicodeRange: string;
  ranges: [number, number][];
  file: string;
}

export interface LoadedFont {
  family: string;
  weight: string;
  subsets: FontSubset[];
}

const cache = new Map<FontKey, LoadedFont>();

function parseRanges(unicodeRange: string): [number, number][] {
  return unicodeRange.split(",").map((part): [number, number] => {
    const [from = "", to] = part.trim().replace(/^U\+/i, "").split("-");
    const start = Number.parseInt(from, 16);
    return [start, to === undefined ? start : Number.parseInt(to, 16)];
  });
}

/** Reads a bundled font's subset table. The font files themselves are read only when embedded. */
export function loadFont(key: FontKey): LoadedFont {
  const cached = cache.get(key);
  if (cached) return cached;
  const source = SOURCES[key];
  const anchor = require.resolve(`${source.pkg}/files/${source.slug}-latin-wght-normal.woff2`);
  const root = dirname(dirname(anchor));
  const unicode = JSON.parse(readFileSync(join(root, "unicode.json"), "utf8")) as Record<string, string>;
  const subsets = Object.entries(unicode).map(([name, unicodeRange]) => ({
    name,
    unicodeRange,
    ranges: parseRanges(unicodeRange),
    file: join(root, "files", `${source.slug}-${name}-wght-normal.woff2`),
  }));
  const font = { family: FONT_FAMILIES[key], weight: source.weight, subsets };
  cache.set(key, font);
  return font;
}

function subsetCovers(subset: FontSubset, codePoint: number): boolean {
  return subset.ranges.some(([from, to]) => codePoint >= from && codePoint <= to);
}

export function fontCovers(font: LoadedFont, codePoint: number): boolean {
  return font.subsets.some((subset) => subsetCovers(subset, codePoint));
}

/**
 * `@font-face` rules, with the font data inline, for the subsets `text` uses.
 * Latin is always included: scene chrome and punctuation need it.
 */
export function fontFaceCss(key: FontKey, text: string): string {
  const font = loadFont(key);
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  return font.subsets
    .filter((subset) => subset.name === "latin" || codePoints.some((cp) => subsetCovers(subset, cp)))
    .map((subset) => {
      const data = readFileSync(subset.file).toString("base64");
      return `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${subset.unicodeRange}}`;
    })
    .join("\n");
}

/** Every string the video draws, with its full scenefile path. */
export function videoTexts(video: ResolvedVideo): { path: string; text: string; font: "sans" | "mono" }[] {
  return video.scenes.flatMap((scene) =>
    getScene(scene.type)
      .texts(scene.props)
      .map((entry) => ({ ...entry, path: `scenes[${scene.index}].${entry.path}` })),
  );
}

/** Emoji and the invisible characters that join or style them. */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[‍️⃣]/u;

/**
 * Finds text the theme's fonts cannot draw. Without this the browser would
 * substitute whatever font the machine has, or draw empty boxes.
 */
export function glyphDiagnostics(video: ResolvedVideo): Diagnostic[] {
  const theme = getTheme(video.theme);
  const diagnostics: Diagnostic[] = [];
  for (const entry of videoTexts(video)) {
    const font = loadFont(entry.font === "sans" ? theme.fontSans : theme.fontMono);
    const missing = new Set<string>();
    let emoji = false;
    for (const char of entry.text) {
      if (/\s/u.test(char)) continue;
      if (EMOJI.test(char)) emoji = true;
      else if (!fontCovers(font, char.codePointAt(0) ?? 0)) missing.add(char);
    }
    if (missing.size > 0) {
      diagnostics.push(
        error(
          "GLYPH_MISSING",
          entry.path,
          `The ${font.family} font cannot draw: ${[...missing].join(" ")}`,
          "Write this text in Latin or Cyrillic script, or remove these characters.",
        ),
      );
    }
    if (emoji) {
      diagnostics.push(
        warning(
          "GLYPH_FALLBACK",
          entry.path,
          "Emoji are drawn with the computer's own emoji font, so they look different on each machine.",
          "Remove the emoji if the video must look identical everywhere.",
        ),
      );
    }
  }
  return diagnostics;
}
```

Edits:

```text
FILE packages/engine/src/compile.ts
<<<<
import type { ResolvedVideo } from "./resolve";
import { themeCss } from "./themes";
====
import { fontFaceCss, videoTexts } from "./fonts";
import type { ResolvedVideo } from "./resolve";
import { getTheme, themeCss } from "./themes";
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
  // "<" is escaped so nothing in the JSON can end the script element.
====
  const theme = getTheme(video.theme);
  const texts = videoTexts(video);
  const textIn = (font: "sans" | "mono"): string =>
    texts.filter((entry) => entry.font === font).map((entry) => entry.text).join("");
  const fontCss = `${fontFaceCss(theme.fontSans, textIn("sans"))}\n${fontFaceCss(theme.fontMono, textIn("mono"))}`;
  // "<" is escaped so nothing in the JSON can end the script element.
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
<style>${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
====
<style>${fontCss}
${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
>>>>
```

```text
FILE packages/render/src/session.ts
<<<<
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
====
    // Faces load lazily, on first use; a frame captured before then would show a fallback font.
    await page.evaluate(() => Promise.all(Array.from(document.fonts, (face) => face.load())).then(() => undefined));
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
import { type Composition, compile } from "./compile";
====
import { type Composition, compile } from "./compile";
import { glyphDiagnostics } from "./fonts";
>>>>
```

```text
FILE packages/engine/src/check.ts
<<<<
  const diagnostics = [...normalized.diagnostics, ...resolved.diagnostics];
====
  const diagnostics = [
    ...normalized.diagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
>>>>
```

```text
FILE packages/engine/src/index.ts
<<<<
export { FORMAT_SIZES } from "./formats";
====
export { type FontSubset, type LoadedFont, fontCovers, fontFaceCss, glyphDiagnostics, loadFont, videoTexts } from "./fonts";
export { FORMAT_SIZES } from "./formats";
export { type FontKey, type Theme, contrastRatio, getTheme, themeCss } from "./themes";
>>>>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS for every package, including the reproducibility stress test (fonts change every pixel of text, so this run matters). The Plan 1 compile test `html.match(/<script/g)` still expects one match; base64 font data cannot contain `<`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): embed open-license fonts and reject text they cannot draw"
```

---

### Task 3: Text fitting, the inspect step, and layout diagnostics

**Files:**
- Create: `packages/runtime/src/fit.ts`, `packages/engine/src/layout.ts`, `packages/render/src/inspect.ts`, `packages/engine/test/layout.test.ts`, `packages/render/test/inspect.test.ts`
- Replace: `packages/runtime/src/index.ts`, `packages/engine/src/check.ts`
- Modify: `packages/render/src/session.ts`, `packages/render/src/index.ts`, `packages/engine/src/index.ts`, `packages/cli/src/run.ts`, `packages/cli/test/run.test.ts`, `packages/cli/test/cli.e2e.test.ts`

**Interfaces:**
- Consumes: fit-slot attributes (Task 1); `Composition`; `openComposition`
- Produces:
  - In the page: `window.__scenefileReady: Promise<void>`; `window.__scenefile = { seek, totalFrames, report: { slots: SlotReport[] } }`
  - `interface SlotReport { path: string; sizePx: number; lines: number; maxLines: number | null; chars: number; overflow: boolean; outside: boolean }`
  - `interface InspectReport { slots: SlotReport[] }`
  - `verifyLayout(report: InspectReport): Diagnostic[]` with codes `TEXT_OVERFLOW` and `SAFE_AREA` (both errors)
  - `inspectComposition(composition: Composition): Promise<InspectReport>`
  - `CheckResult` gains `video: ResolvedVideo | null`
  - `storyboard(video: ResolvedVideo, report?: InspectReport): string`
  - `applyLayout(result: CheckResult, report: InspectReport): CheckResult`
  - `Io.inspect?: (composition: Composition) => Promise<InspectReport>` (test seam; defaults to `inspectComposition`)

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyLayout, check } from "../src/check";
import { type SlotReport, verifyLayout } from "../src/layout";

const slot = (over: Partial<SlotReport>): SlotReport => ({
  path: "scenes[0].heading", sizePx: 100, lines: 2, maxLines: 3, chars: 40, overflow: false, outside: false, ...over,
});

const valid = {
  version: 1,
  scenes: [{ type: "title", heading: "Ship faster", sub: "A CLI for X" }, { type: "terminal", steps: [{ run: "npx x init" }] }],
};

describe("verifyLayout", () => {
  it("accepts slots that fit", () => {
    expect(verifyLayout({ slots: [slot({}), slot({ path: "scenes[1].steps", maxLines: null })] })).toEqual([]);
  });

  it("gives a character budget when text needs too many lines", () => {
    const [diagnostic, ...rest] = verifyLayout({ slots: [slot({ overflow: true, lines: 5, chars: 100 })] });
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", severity: "error", path: "scenes[0].heading" });
    expect(diagnostic?.message).toContain("5 lines");
    expect(diagnostic?.message).toContain("3");
    // 100 chars over 5 lines is 20 per line; 3 lines hold 60; keep 10% spare.
    expect(diagnostic?.fix).toContain("54 characters");
    expect(diagnostic?.fix).toContain("100");
  });

  it("says a word is too long when the line count is fine but a word had to be broken", () => {
    const [diagnostic] = verifyLayout({ slots: [slot({ overflow: true, lines: 3, chars: 68 })] });
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", path: "scenes[0].heading" });
    expect(diagnostic?.message).toContain("word");
    expect(diagnostic?.fix).toMatch(/shorter words/);
  });

  it("asks for less content when a block is too tall", () => {
    const [diagnostic] = verifyLayout({ slots: [slot({ path: "scenes[1].steps", maxLines: null, overflow: true })] });
    expect(diagnostic).toMatchObject({ code: "TEXT_OVERFLOW", path: "scenes[1].steps" });
    expect(diagnostic?.fix).toMatch(/fewer|shorter|split/);
  });

  it("reports text outside the safe area, once, and not on top of an overflow", () => {
    expect(verifyLayout({ slots: [slot({ outside: true })] })).toEqual([
      expect.objectContaining({ code: "SAFE_AREA", severity: "error", path: "scenes[0].heading" }),
    ]);
    expect(verifyLayout({ slots: [slot({ outside: true, overflow: true, lines: 4 })] })).toHaveLength(1);
  });
});

describe("applyLayout", () => {
  it("adds sizes and line counts to the storyboard", () => {
    const result = applyLayout(check(valid), {
      slots: [
        slot({ sizePx: 237.6, lines: 1 }),
        slot({ path: "scenes[0].sub", sizePx: 49.68, lines: 1, maxLines: 4 }),
        slot({ path: "scenes[1].steps", sizePx: 47.52, lines: 1, maxLines: null }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.storyboard.split("\n")).toEqual([
      "1920x1080, 30 fps, 5.40s, 2 scenes",
      "1. title     0.00s-3.00s  Ship faster",
      "     heading  238px, 1 line",
      "     sub      50px, 1 line",
      "2. terminal  3.00s-5.40s  $ npx x init",
      "     steps  48px",
    ]);
  });

  it("blocks rendering when layout fails but keeps the storyboard", () => {
    const result = applyLayout(check(valid), { slots: [slot({ overflow: true, lines: 6, chars: 80 })] });
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TEXT_OVERFLOW"]);
    expect(result.storyboard).toContain("1. title");
  });

  it("leaves a result that already failed untouched", () => {
    const failed = check({ version: 1, scenes: [{ type: "nope" }] });
    expect(applyLayout(failed, { slots: [slot({ overflow: true })] })).toEqual(failed);
  });
});
```

`packages/render/test/inspect.test.ts`:

```ts
import { check, verifyLayout } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { inspectComposition } from "../src/index";

async function inspect(input: Record<string, unknown>) {
  const result = check({ version: 1, ...input });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  const report = await inspectComposition(result.composition);
  const slot = (path: string) => {
    const found = report.slots.find((entry) => entry.path === path);
    if (!found) throw new Error(`no slot ${path} in ${report.slots.map((s) => s.path).join(", ")}`);
    return found;
  };
  return { report, slot, diagnostics: verifyLayout(report) };
}

const filler = { type: "title", heading: "one two three four five six seven eight nine" };
const UNIT = 10.8;

describe("text fitting", () => {
  it("gives a short heading the largest size", async () => {
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading: "Hi", sub: "there" }, filler] });
    expect(slot("scenes[0].heading")).toMatchObject({ lines: 1, overflow: false, outside: false, chars: 2 });
    expect(slot("scenes[0].heading").sizePx).toBeCloseTo(22 * UNIT, 1);
    expect(slot("scenes[0].sub").sizePx).toBeCloseTo(4.6 * UNIT, 1);
    expect(diagnostics).toEqual([]);
  });

  it("shrinks a long heading until it fits within three lines", async () => {
    const heading = "Render the same video from the same file on every machine";
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading }, filler] });
    const fitted = slot("scenes[0].heading");
    expect(fitted.sizePx).toBeLessThan(22 * UNIT);
    expect(fitted.sizePx).toBeGreaterThanOrEqual(8 * UNIT - 0.01);
    expect(fitted.lines).toBeLessThanOrEqual(3);
    expect(fitted.overflow).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it("reports a heading that cannot fit, with a character budget", async () => {
    const heading = "Supercalifragilisticexpialidocious".repeat(2);
    const { slot, diagnostics } = await inspect({ scenes: [{ type: "title", heading, sub: "x" }, filler] });
    expect(slot("scenes[0].heading").overflow).toBe(true);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TEXT_OVERFLOW", path: "scenes[0].heading" }),
    ]);
    expect(diagnostics[0]?.fix).toMatch(/shorter words|about \d+ characters/);
  });

  it("shrinks terminal text to fit its area, and reports when it cannot", async () => {
    const few = await inspect({ scenes: [{ type: "terminal", steps: [{ run: "ls" }, { run: "pwd" }] }, filler] });
    expect(few.slot("scenes[0].steps").sizePx).toBeCloseTo(4.4 * UNIT, 1);
    expect(few.diagnostics).toEqual([]);

    const step = { run: "x".repeat(120), output: "y ".repeat(200).trim() };
    const many = await inspect({ scenes: [{ type: "terminal", steps: Array.from({ length: 6 }, () => step) }] });
    expect(many.slot("scenes[0].steps").overflow).toBe(true);
    expect(many.diagnostics).toEqual([expect.objectContaining({ code: "TEXT_OVERFLOW", path: "scenes[0].steps" })]);
  });

  it("keeps the heading wide in portrait and square formats", async () => {
    for (const [format, width] of [["portrait-1080p", 1080], ["square-1080p", 1080]] as const) {
      const { report, diagnostics } = await inspect({
        format,
        scenes: [{ type: "title", heading: "Video from JSON.", sub: "Any model can write a scenefile." }, filler],
      });
      expect(diagnostics, format).toEqual([]);
      expect(report.slots.every((entry) => !entry.outside), format).toBe(true);
      // Fits "Video from" on one line only if the heading has most of the frame's width.
      const heading = report.slots.find((entry) => entry.path === "scenes[0].heading");
      expect(heading?.sizePx, format).toBeGreaterThanOrEqual(12 * (width / 100));
    }
  });

  it("is repeatable: two inspections of one composition agree exactly", async () => {
    const input = { scenes: [{ type: "title", heading: "Render the same video from the same file", sub: "Every time." }, filler] };
    expect((await inspect(input)).report).toEqual((await inspect(input)).report);
  });
});
```

Edits to the CLI tests:

```text
FILE packages/cli/test/run.test.ts
<<<<
function capture(render?: Io["render"]): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), ...(render ? { render } : {}) },
====
function capture(
  render?: Io["render"],
  inspect: NonNullable<Io["inspect"]> = async () => ({ slots: [] }),
): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), inspect, ...(render ? { render } : {}) },
>>>>
```

```text
FILE packages/cli/test/run.test.ts
<<<<
  it("reports a missing file as a diagnostic", async () => {
====
  it("reports text that does not fit, found by inspecting the layout", async () => {
    const c = capture(undefined, async () => ({
      slots: [
        { path: "scenes[0].heading", sizePx: 86.4, lines: 5, maxLines: 3, chars: 70, overflow: true, outside: false },
      ],
    }));
    expect(await run(["check", file("long.json", valid)], c.io)).toBe(1);
    expect(c.out()).toContain("error  TEXT_OVERFLOW  scenes[0].heading");
    expect(c.out()).toContain("characters");
    expect(c.out()).toContain("heading  86px, 5 lines");
  });

  it("does not inspect a scenefile that already has errors", async () => {
    let inspected = false;
    const c = capture(undefined, async () => {
      inspected = true;
      return { slots: [] };
    });
    expect(await run(["check", file("broken3.json", JSON.stringify({ version: 1, scenes: [] }))], c.io)).toBe(1);
    expect(inspected).toBe(false);
  });

  it("exits 2 when the browser needed for layout checks is missing", async () => {
    const c = capture(undefined, async () => {
      throw new EnvironmentError("Chromium is not installed for scenefile.", "Install the browser: ...");
    });
    expect(await run(["check", file("nobrowser.json", valid)], c.io)).toBe(2);
    expect(c.err()).toContain("Chromium is not installed");
  });

  it("reports a missing file as a diagnostic", async () => {
>>>>
```

```text
FILE packages/cli/test/cli.e2e.test.ts
<<<<
  it("exits 1 and prints diagnostics for a broken scenefile", async () => {
====
  it("finds text that cannot fit by measuring it in the browser", async () => {
    const input = join(dir, "overflow.json");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        scenes: [
          { type: "title", heading: "Supercalifragilisticexpialidocious".repeat(2), sub: "x" },
          { type: "title", heading: "one two three four five six seven eight nine" },
        ],
      }),
    );
    const result = await scenefile(["check", input]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("TEXT_OVERFLOW  scenes[0].heading");
    expect(result.stdout).toMatch(/heading\s+\d+px, \d+ lines/);
  });

  it("exits 1 and prints diagnostics for a broken scenefile", async () => {
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL. `layout.test.ts` and `inspect.test.ts` cannot import; the three new `run.test.ts` cases fail (`inspect` is ignored); the new e2e case exits 0.

- [ ] **Step 3: Implement**

`packages/runtime/src/fit.ts`:

```ts
/** What happened to one fitted piece of text. Mirrors `SlotReport` in @scenefile/engine. */
export interface SlotReport {
  path: string;
  sizePx: number;
  lines: number;
  maxLines: number | null;
  chars: number;
  overflow: boolean;
  outside: boolean;
}

/** Nothing may come closer to the edge of the frame than this, in units. */
const SAFE_MARGIN_UNITS = 4;

function measure(el: HTMLElement, maxLines: number | null, boxed: boolean): { lines: number; fits: boolean } {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const lines = Math.max(1, Math.round((el.clientHeight - padding) / lineHeight));
  const tooWide = el.scrollWidth > el.clientWidth + 1;
  const tooTall = boxed && el.scrollHeight > el.clientHeight + 1;
  return { lines, fits: !tooWide && !tooTall && (maxLines === null || lines <= maxLines) };
}

/**
 * Sizes every `[data-sf-fit]` element under `root`: the largest size on its
 * scale at which the text fits. Shrinking is preferred to breaking a word;
 * only at the smallest size may a word break, and if the text still does not
 * fit, that is reported rather than hidden.
 */
export function fitSlots(root: HTMLElement, unitPx: number, frame: { width: number; height: number }): SlotReport[] {
  const reports: SlotReport[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-sf-fit]")) {
    const [min = 1, max = 1, step = 1] = (el.dataset.sfFit ?? "").split(",").map(Number);
    const maxLines = el.dataset.sfLines ? Number(el.dataset.sfLines) : null;
    const boxed = "sfBox" in el.dataset;

    // Block-level text must not break words while a smaller size might still fit them.
    if (!boxed) el.style.overflowWrap = "normal";
    let size = max;
    let result = { lines: 1, fits: false };
    for (;;) {
      el.style.fontSize = `${size * unitPx}px`;
      result = measure(el, maxLines, boxed);
      const next = Math.round((size - step) * 100) / 100;
      if (result.fits || next < min) break;
      size = next;
    }
    // Whether it fits is decided before any word is broken. Breaking is damage
    // control for the picture; the text is still reported as not fitting.
    const fits = result.fits;
    if (!boxed) {
      el.style.overflowWrap = fits ? "" : "anywhere";
      if (!fits) result = measure(el, maxLines, boxed);
    }

    const rect = el.getBoundingClientRect();
    const margin = SAFE_MARGIN_UNITS * unitPx - 1;
    reports.push({
      path: el.dataset.sfPath ?? "",
      sizePx: size * unitPx,
      lines: result.lines,
      maxLines,
      chars: Array.from(el.textContent ?? "").length,
      overflow: !fits,
      outside:
        rect.left < margin ||
        rect.top < margin ||
        rect.right > frame.width - margin ||
        rect.bottom > frame.height - margin,
    });
  }
  return reports;
}
```

`packages/runtime/src/index.ts`:

```ts
import { type SceneHandle, mounts } from "@scenefile/scenes/browser";
import { type SlotReport, fitSlots } from "./fit";

interface ManifestScene {
  index: number;
  type: string;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
}

interface Manifest {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  scenes: ManifestScene[];
}

interface Mounted {
  scene: ManifestScene;
  el: HTMLElement;
  handle: SceneHandle;
}

interface Api {
  seek(frame: number): void;
  totalFrames: number;
  report: { slots: SlotReport[] };
}

function init(): Api {
  const manifestEl = document.getElementById("sf-manifest");
  if (!manifestEl?.textContent) throw new Error("scenefile: the composition has no manifest");
  const manifest = JSON.parse(manifestEl.textContent) as Manifest;

  const mounted = manifest.scenes.map((scene): Mounted => {
    const el = document.querySelector<HTMLElement>(`[data-sf-scene="${scene.index}"]`);
    const mount = mounts[scene.type];
    if (!el) throw new Error(`scenefile: scene ${scene.index} is missing from the document`);
    if (!mount) throw new Error(`scenefile: no browser mount for scene type "${scene.type}"`);
    const handle = mount(el, {
      fps: manifest.fps,
      durationFrames: scene.durationFrames,
      enterFrames: scene.enterFrames,
      exitFrames: scene.exitFrames,
    });
    return { scene, el, handle };
  });

  // Fit text once, before any frame is drawn. Each scene is measured as it
  // looks fully revealed (its last frame before the exit), so text that is
  // typed or staggered in over time is measured at full length.
  const unitPx = Math.min(manifest.width, manifest.height) / 100;
  const slots: SlotReport[] = [];
  for (const { scene, el, handle } of mounted) {
    el.hidden = false;
    handle.seek(Math.max(0, scene.durationFrames - scene.exitFrames - 1));
    slots.push(...fitSlots(el, unitPx, manifest));
    el.hidden = true;
  }

  const root = document.documentElement;

  return {
    totalFrames: manifest.totalFrames,
    report: { slots },
    seek(frame) {
      // Chromium carries paint and compositing state from one frame to the next,
      // so identical DOM can differ by one level on anti-aliased edges depending
      // on which frames came before. Taking the whole document out of layout and
      // putting it back discards that state, so pixels depend on the frame alone.
      // Detaching less than the document is not enough: it was tried with only
      // the stage and frames still differed. Both forced layouts are required;
      // without them the browser coalesces the two style changes.
      root.style.display = "none";
      void root.offsetHeight;
      for (const { scene, el, handle } of mounted) {
        const local = frame - scene.startFrame;
        const active = local >= 0 && local < scene.durationFrames;
        el.hidden = !active;
        if (active) handle.seek(local);
      }
      root.style.display = "";
      void root.offsetHeight;
    },
  };
}

async function start(): Promise<void> {
  // Faces load lazily; text measured before they arrive would be measured in a fallback font.
  await Promise.all(Array.from(document.fonts, (face) => face.load()));
  (window as unknown as { __scenefile: Api }).__scenefile = init();
}

(window as unknown as { __scenefileReady: Promise<void> }).__scenefileReady = start();
```

`packages/engine/src/layout.ts`:

```ts
import { type Diagnostic, error } from "@scenefile/schema";

/** What the browser reports for one fitted piece of text. */
export interface SlotReport {
  /** Scenefile path of the text, e.g. `scenes[0].heading`. */
  path: string;
  /** Final font size. */
  sizePx: number;
  lines: number;
  /** Line limit, or null when the text must fit a fixed-height area instead. */
  maxLines: number | null;
  /** Characters of text in the slot. */
  chars: number;
  /** True when the text does not fit even at its smallest size. */
  overflow: boolean;
  /** True when the text reaches into the frame's safe margin. */
  outside: boolean;
}

export interface InspectReport {
  slots: SlotReport[];
}

/** Share of the computed character budget to recommend, leaving room for wide letters. */
const BUDGET_SPARE = 0.9;

/** Turns browser measurements into diagnostics a model can act on without seeing the frame. */
export function verifyLayout(report: InspectReport): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const slot of report.slots) {
    if (slot.overflow && slot.maxLines !== null && slot.lines <= slot.maxLines) {
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          "A word in this text is too long to fit on one line, even at its smallest size, so it was broken.",
          "Use shorter words, or add spaces or hyphens where the text may break.",
        ),
      );
    } else if (slot.overflow && slot.maxLines !== null) {
      const perLine = slot.chars / Math.max(slot.lines, 1);
      const budget = Math.max(1, Math.floor(perLine * slot.maxLines * BUDGET_SPARE));
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          `This text needs ${slot.lines} lines at its smallest size; only ${slot.maxLines} fit.`,
          `Shorten it to about ${budget} characters (it has ${slot.chars}).`,
        ),
      );
    } else if (slot.overflow) {
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          "This content is taller than the scene, even at its smallest size.",
          "Use fewer or shorter items, or split them across two scenes.",
        ),
      );
    } else if (slot.outside) {
      diagnostics.push(
        error(
          "SAFE_AREA",
          slot.path,
          "This text reaches the edge of the frame, where players and phones may crop it.",
          "Shorten it.",
        ),
      );
    }
  }
  return diagnostics;
}
```

`packages/engine/src/check.ts`:

```ts
import { type Diagnostic, type Scenefile, hasErrors, normalize } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { type Composition, compile } from "./compile";
import { glyphDiagnostics } from "./fonts";
import { type InspectReport, verifyLayout } from "./layout";
import { type ResolvedVideo, resolve } from "./resolve";

export interface CheckResult {
  /** True when there are no errors. Warnings do not block rendering. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The scenefile with defaults filled and repairs applied; null when it failed validation. */
  scenefile: Scenefile | null;
  video: ResolvedVideo | null;
  composition: Composition | null;
  storyboard: string;
}

/**
 * A plain-text description of the video, so a model without vision can review
 * it. With a layout report, each scene also lists its text sizes and line counts.
 */
export function storyboard(video: ResolvedVideo, report?: InspectReport): string {
  const seconds = (frames: number): string => `${(frames / video.fps).toFixed(2)}s`;
  const typeWidth = Math.max(...video.scenes.map((scene) => scene.type.length));
  const lines = [
    `${video.width}x${video.height}, ${video.fps} fps, ${seconds(video.totalFrames)}, ${video.scenes.length} scenes`,
  ];
  for (const scene of video.scenes) {
    const range = `${seconds(scene.startFrame)}-${seconds(scene.startFrame + scene.durationFrames)}`;
    lines.push(
      `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}`,
    );
    const prefix = `scenes[${scene.index}].`;
    const slots = (report?.slots ?? []).filter((slot) => slot.path.startsWith(prefix));
    const fieldWidth = Math.max(0, ...slots.map((slot) => slot.path.length - prefix.length));
    for (const slot of slots) {
      const field = slot.path.slice(prefix.length).padEnd(fieldWidth);
      const count = slot.maxLines === null ? "" : `, ${slot.lines} ${slot.lines === 1 ? "line" : "lines"}`;
      lines.push(`     ${field}  ${Math.round(slot.sizePx)}px${count}`);
    }
  }
  return lines.join("\n");
}

/** Everything that can be checked without a browser: validate, resolve, compile. */
export function check(input: unknown): CheckResult {
  const normalized = normalize(input);
  if (!normalized.scenefile) {
    return {
      ok: false,
      diagnostics: normalized.diagnostics,
      scenefile: null,
      video: null,
      composition: null,
      storyboard: "",
    };
  }

  const resolved = resolve(normalized.scenefile);
  const diagnostics = [
    ...normalized.diagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
  if (hasErrors(diagnostics)) {
    return {
      ok: false,
      diagnostics,
      scenefile: normalized.scenefile,
      video: resolved.video,
      composition: null,
      storyboard: "",
    };
  }

  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    video: resolved.video,
    composition: compile(resolved.video),
    storyboard: storyboard(resolved.video),
  };
}

/**
 * Adds what the browser measured to a passing check: layout diagnostics, and
 * text sizes in the storyboard. A result that already failed is returned as is.
 */
export function applyLayout(result: CheckResult, report: InspectReport): CheckResult {
  if (!result.ok || !result.video) return result;
  const diagnostics = [...result.diagnostics, ...verifyLayout(report)];
  const ok = !hasErrors(diagnostics);
  return {
    ...result,
    ok,
    diagnostics,
    composition: ok ? result.composition : null,
    storyboard: storyboard(result.video, report),
  };
}
```

`packages/render/src/inspect.ts`:

```ts
import type { Composition, InspectReport } from "@scenefile/engine";
import { openComposition } from "./session";

/** Loads a composition in the browser and returns how its text was fitted. */
export async function inspectComposition(composition: Composition): Promise<InspectReport> {
  const session = await openComposition(composition);
  try {
    return await session.page.evaluate(
      () => (window as unknown as { __scenefile: { report: InspectReport } }).__scenefile.report,
    );
  } finally {
    await session.close();
  }
}
```

Edits:

```text
FILE packages/render/src/session.ts
<<<<
    // Faces load lazily, on first use; a frame captured before then would show a fallback font.
    await page.evaluate(() => Promise.all(Array.from(document.fonts, (face) => face.load())).then(() => undefined));
    const ready = await page.evaluate(() => "__scenefile" in window);
    if (!ready) throw new Error("The scenefile runtime did not start in the page.");
====
    // Resolves once fonts are loaded and text is fitted; rejects if the runtime failed to start.
    await page.evaluate(() => (window as unknown as { __scenefileReady: Promise<void> }).__scenefileReady);
>>>>
```

```text
FILE packages/render/src/index.ts
<<<<
export { type ProbeResult, probeVideo } from "./probe";
====
export { inspectComposition } from "./inspect";
export { type ProbeResult, probeVideo } from "./probe";
>>>>
```

```text
FILE packages/engine/src/index.ts
<<<<
export { type CheckResult, check, storyboard } from "./check";
====
export { type CheckResult, applyLayout, check, storyboard } from "./check";
export { type InspectReport, type SlotReport, verifyLayout } from "./layout";
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
import { type CheckResult, type Composition, check } from "@scenefile/engine";
import {
  EnvironmentError,
====
import { type CheckResult, type Composition, type InspectReport, applyLayout, check } from "@scenefile/engine";
import {
  EnvironmentError,
  inspectComposition,
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
  /** Test seam. Defaults to the real renderer. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
====
  /** Test seam. Defaults to the real renderer. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
  /** Test seam. Defaults to measuring the layout in Chromium. */
  inspect?: (composition: Composition) => Promise<InspectReport>;
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
async function load(path: string): Promise<CheckResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    const diagnostic = error("SCHEMA_FILE", "", `Cannot read "${path}".`, "Check that the path exists and is a file.");
    return { ok: false, diagnostics: [diagnostic], scenefile: null, composition: null, storyboard: "" };
  }
  const parsed = parseScenefileText(text);
  if (parsed.value === undefined) {
    return { ok: false, diagnostics: parsed.diagnostics, scenefile: null, composition: null, storyboard: "" };
  }
  const result = check(parsed.value);
  return { ...result, diagnostics: [...parsed.diagnostics, ...result.diagnostics] };
}
====
function failed(diagnostics: Diagnostic[]): CheckResult {
  return { ok: false, diagnostics, scenefile: null, video: null, composition: null, storyboard: "" };
}

/** Reads, validates, and measures a scenefile: everything short of rendering it. */
async function load(path: string, io: Io): Promise<CheckResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return failed([error("SCHEMA_FILE", "", `Cannot read "${path}".`, "Check that the path exists and is a file.")]);
  }
  const parsed = parseScenefileText(text);
  if (parsed.value === undefined) return failed(parsed.diagnostics);

  const checked = check(parsed.value);
  const result = { ...checked, diagnostics: [...parsed.diagnostics, ...checked.diagnostics] };
  if (!result.ok || !result.composition) return result;
  return applyLayout(result, await (io.inspect ?? inspectComposition)(result.composition));
}
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
    if (command === "check") {
      const result = await load(file);
====
    if (command === "check") {
      const result = await load(file, io);
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
    const result = await load(file);
    if (!result.ok || !result.composition) {
====
    const result = await load(file, io);
    if (!result.ok || !result.composition) {
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean. The reproducibility stress test must pass; fitting writes inline `font-size`, which must not vary between seeks.

If a fitting test fails on a size or line count, read the reported slot before changing anything: the tests assert relations (largest size, within three lines, overflow or not), and a failure usually means `measure` is counting lines wrongly for that element (padding, or a `line-height` below 1), not that the expectation is wrong.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: fit text in the browser and report text that cannot fit"
```

---

### Task 4: Example, README, and review by eye

**Files:**
- Modify: `examples/launch.json`, `README.md`
- Possibly modify: scene CSS in `packages/scenes/src/title/definition.ts`, `packages/scenes/src/terminal/definition.ts`, `packages/scenes/src/chrome.ts`

**Interfaces:**
- Consumes: everything above. Produces no new interfaces.

- [ ] **Step 1: Update the example**

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
      "type": "terminal",
      "steps": [
        { "run": "scenefile check launch.json", "output": "No problems found." },
        { "run": "scenefile render launch.json -o launch.mp4", "output": "Rendered launch.mp4" }
      ]
    },
    {
      "type": "title",
      "heading": "No keyframes. No pixels.",
      "highlight": "No pixels.",
      "sub": "Describe the scenes."
    }
  ]
}
```

- [ ] **Step 2: Render and look**

Run:

```bash
pnpm build
node packages/cli/dist/main.js check examples/launch.json
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
ffmpeg -y -loglevel error -i out/launch.mp4 -vf "fps=1/2,scale=960:-1,tile=3x3:padding=6:color=0x444444" -frames:v 1 out/sheet.png
```

Expected: `check` prints a storyboard with a size and line count under each scene and "No problems found."; the render succeeds.

Open `out/sheet.png` beside `out/directions/signal-1.png` and `signal-2.png` and compare. Fix in the scene CSS, then re-render, until all hold:

- Black is pure black; lime is the only color; greys are neutral.
- The heading is the dominant element and sits low-left; the highlighted part is lime.
- The sub line reads comfortably at video size (not smaller than about 37 px at 1080p) and aligns with the heading's last line.
- The counter and hairline sit at the top, quiet, the same in every scene.
- Terminal text is large, starts under the hairline, prompt and caret lime, output grey.
- Nothing touches the frame edge. No dead quarter of the frame in the title.
- Also render one portrait scenefile (`"format": "portrait-1080p"`) and check the title stacks cleanly.

- [ ] **Step 3: Update the README**

Replace the status paragraph and the "A scenefile" example so they describe what now exists:

```text
FILE README.md
<<<<
**Status: early development.** Two scene types (`title`, `terminal`) and one theme
work today. Not yet published to npm.
====
**Status: early development.** Two scene types (`title`, `terminal`) and two themes
(`signal`, the default, and `midnight`) work today. Fonts are bundled, so text looks
the same on every machine. Not yet published to npm.
>>>>
```

```text
FILE README.md
<<<<
    { "type": "title", "heading": "Ship faster", "sub": "A CLI for X" },
====
    { "type": "title", "heading": "Ship faster", "highlight": "faster", "sub": "A CLI for X" },
>>>>
```

```text
FILE README.md
<<<<
Durations are worked out from how long the text takes to read. `check` reports
problems as text, each with the path of the field and how to fix it:
====
Durations are worked out from how long the text takes to read, and text is sized to
fit. `check` measures the layout in a real browser and reports problems as text, each
with the path of the field and how to fix it:

```
error  TEXT_OVERFLOW  scenes[0].heading
  This text needs 5 lines at its smallest size; only 3 fit.
  fix: Shorten it to about 54 characters (it has 96).
```
>>>>
```

- [ ] **Step 4: Run everything once more**

Run: `pnpm test && pnpm typecheck`
Expected: PASS and clean, including the reproducibility stress test after any CSS changes made in Step 2.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Signal look for the example, README for fonts and text fitting"
```

---

## What Plan 2a leaves for later

| Item | Plan |
|---|---|
| Scene types `statement`, `bullets`, `code`, `screenshot`, `stat`, `quote`, `compare`, `outro`, `custom` | 2b |
| Asset fetch and cache; `ASSET_NOT_FOUND`, `ASSET_LOW_RES`, `CODE_TOO_LONG` | 2b |
| Nested field aliases and suggestions | 2b |
| Scene counter as a persistent overlay rather than per scene | 2c |
| Transitions, camera drift | 2c |
| Themes `paper` and `terminal` (need a panel-color token) | 2c |
| Audio mux, parallel workers, `blackdetect`, measured performance | 2c |
| Golden frames and the Docker image | 2c |
| Deferred minors from the Plan 1 review | 2b, alongside normalizer work |
