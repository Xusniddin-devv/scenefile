# scenefile Plan 1 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scenefile render examples/launch.json -o out.mp4` turns a JSON scenefile with `title` and `terminal` scenes into a correct 1080p MP4, and `scenefile check` returns model-readable diagnostics.

**Architecture:** A pnpm TypeScript monorepo. A scenefile is normalized and validated (`schema`), resolved to frame timings and compiled to one HTML document plus a manifest (`engine`), then a browser bundle (`runtime`) exposes a pure `seek(frame)` that Chromium is driven through frame by frame while PNGs are piped to `ffmpeg` (`render`). Each scene type lives in one directory of `scenes` with its schema, HTML compiler, and browser mount.

**Tech Stack:** Node 20+, pnpm 9, TypeScript (strict), Zod 4, Vitest, happy-dom, tsup, playwright-core (Chromium headless shell), system ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md`

## Where this plan sits

The spec is delivered by three plans. Each ends with working software.

1. **This plan:** end-to-end pipeline with two scene types, one theme, CLI `check` and `render`.
2. **Design system:** remaining eight scene types and `custom`, four themes, bundled fonts, text fitting and the browser `inspect` step, transitions, audio mux, parallel workers, golden frames in Docker.
3. **Distribution:** MCP server, generated agent docs, `preview`, `doctor`, `init`, `scenes`, `themes`, `schema`, `guide`, CI, release tooling, live non-Claude model pass.

Plans 2 and 3 are written after this one runs, because their details depend on measured behavior here (capture speed, text metrics in real Chromium).

### Deviations from the spec, deliberate

- **Extra package `@scenefile/scenes`.** The spec says adding a scene type touches one directory. That requires scene schema, compiler, and browser mount to live together, so they get their own package that `schema`, `engine`, and `runtime` consume.
- **No Web Animations API yet.** Mounts compute styles directly from the frame number. This satisfies the determinism contract more simply. WAAPI arrives in Plan 2 only for `custom` scenes, whose CSS animations must be driven externally.
- **System font stack.** Bundled fonts and `GLYPH_MISSING` are Plan 2. Until then output is not font-identical across machines.
- **Only implemented values are accepted.** The schema lists one theme and two scene types. Nothing is advertised before it works.

## Global Constraints

- Node `>=20`. Package manager pnpm. License MIT.
- TypeScript `strict` and `noUncheckedIndexedAccess`. No `any`.
- User-facing failures are diagnostics `{ code, severity, path, message, fix }`, never stack traces.
- Diagnostic paths use the form `scenes[2].heading`.
- CLI exit codes: `0` success, `1` diagnostics with errors, `2` environment problem.
- `seek(frame)` is a pure function of the frame number: DOM state after `seek(n)` must not depend on earlier seeks.
- During render the page makes no network requests; every request is aborted.
- `ffmpeg` and `ffprobe` come from the system `PATH`. They are not bundled.
- Frames are the internal time unit. Scenefiles use seconds.
- Reading speed for automatic timing: 3 words per second.
- Total video length must be between 3 s and 600 s.
- Dependencies are added with `pnpm add` so versions resolve at install time; do not hand-write version numbers, except `zod@^4`.
- **This machine only (do not commit):** `git-lfs` is marked required in `~/.gitconfig` but is not installed, so plain `git add`/`git commit` hang. Prefix every git command with `git -c filter.lfs.required=false -c filter.lfs.process= -c filter.lfs.clean=cat -c filter.lfs.smudge=cat`. Vitest sometimes stalls at 0% CPU under the agent sandbox; if a run shows no output for 60 s, kill it and rerun.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **The file is not JSON** (empty, prose, or JSON wrapped in a Markdown code fence, which weak models emit constantly). Expected: fences are stripped with an `AUTOFIXED` warning; anything else is a `SCHEMA_JSON` diagnostic, not a stack trace. Task 4.
2. **Text contains HTML** (`<b>`, `</script>`, `&`). Expected: shown literally in the video, composition stays intact. Tasks 1 and 5.
3. **Typed terminal text contains emoji or other astral characters.** Expected: the typewriter never shows half a character. Task 3.
4. **`ffmpeg` is missing.** Expected: exit code 2 with the install command, and no partial output file. Tasks 6 and 7.
5. **Output directory does not exist.** Expected: it is created. Task 6.

## File Structure

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.config.ts
.gitignore  LICENSE  README.md
test/global-setup.ts                 builds all packages before tests (Task 6)
examples/launch.json
packages/
  scenes/        one directory per scene type
    src/text.ts            readingSeconds, escapeHtml (no zod; safe for browser)
    src/common.ts          durationSchema
    src/types.ts           SceneDefinition, MountContext, SceneHandle, SceneMount
    src/motion.ts          staggerEnter, fadeExit (browser)
    src/title/{schema,definition,mount}.ts
    src/terminal/{schema,timing,definition,mount}.ts
    src/index.ts           Node registry: sceneSchema, getScene, SCENE_TYPES
    src/browser.ts         browser registry: mounts
  schema/
    src/diagnostics.ts     Diagnostic type and constructors
    src/distance.ts        levenshtein, nearest
    src/scenefile.ts       scenefileSchema, FORMATS, THEMES
    src/parse.ts           parseScenefileText (JSON, code fences)
    src/normalize.ts       normalize
    src/index.ts
  engine/
    src/formats.ts         FORMAT_SIZES
    src/resolve.ts         resolve → ResolvedVideo
    src/themes.ts          theme tokens → CSS variables
    src/compile.ts         compile → Composition
    src/check.ts           check, storyboard
    src/index.ts
  runtime/
    src/index.ts           window.__scenefile = { seek, totalFrames }
  render/
    src/errors.ts          EnvironmentError
    src/session.ts         openComposition
    src/capture.ts         captureFrame
    src/encode.ts          startEncoder
    src/probe.ts           probeVideo
    src/render.ts          renderVideo
    src/index.ts
  cli/
    src/run.ts             run(argv, io) → exit code
    src/main.ts            bin entry
```

---

### Task 1: Workspace and the `title` scene (Node side)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`
- Create: `packages/scenes/package.json`, `packages/scenes/tsconfig.json`, `packages/scenes/tsup.config.ts`
- Create: `packages/scenes/src/text.ts`, `src/common.ts`, `src/types.ts`, `src/title/schema.ts`, `src/title/definition.ts`
- Test: `packages/scenes/test/title.test.ts`

**Interfaces:**
- Produces:
  - `readingSeconds(text: string): number`, `escapeHtml(text: string): string`
  - `durationSchema` (Zod: `"auto"` or a number in `(0, 120]`)
  - `interface SceneDefinition<P> { type: string; fields: readonly string[]; enterSeconds: number; exitSeconds: number; minHoldSeconds: number; holdSeconds(props: P): number; summary(props: P): string; compile(props: P): string; css: string }`
  - `interface MountContext { fps: number; durationFrames: number; enterFrames: number; exitFrames: number }`
  - `interface SceneHandle { seek(localFrame: number): void }`
  - `type SceneMount = (el: HTMLElement, ctx: MountContext) => SceneHandle`
  - `titleSchema`, `type TitleProps`, `titleDefinition: SceneDefinition<TitleProps>`

- [ ] **Step 1: Create the workspace files**

`package.json`:

```json
{
  "name": "scenefile-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm build && pnpm -r exec tsc --noEmit"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string, file = "index.ts"): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@scenefile/scenes/browser", replacement: src("scenes", "browser.ts") },
      { find: "@scenefile/scenes", replacement: src("scenes") },
      { find: "@scenefile/schema", replacement: src("schema") },
      { find: "@scenefile/engine", replacement: src("engine") },
      { find: "@scenefile/render", replacement: src("render") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
```

`.gitignore`:

```
node_modules
dist
out
*.tsbuildinfo
.DS_Store
```

`LICENSE`: the standard MIT license text with the line `Copyright (c) 2026 Xusniddin Qalandarov`.

- [ ] **Step 2: Create the scenes package shell and install dependencies**

`packages/scenes/package.json`:

```json
{
  "name": "@scenefile/scenes",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./browser": { "types": "./dist/browser.d.ts", "default": "./dist/browser.js" }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" }
}
```

`packages/scenes/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/scenes/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
```

Run:

```bash
pnpm add -Dw typescript vitest tsup @types/node happy-dom
pnpm --filter @scenefile/scenes add zod@^4
```

Expected: both commands finish without errors and `pnpm-lock.yaml` exists.

- [ ] **Step 3: Write the failing test**

`packages/scenes/test/title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeHtml, readingSeconds } from "../src/text";
import { titleDefinition } from "../src/title/definition";
import { titleSchema } from "../src/title/schema";

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
    expect(titleDefinition.fields).toEqual(["type", "heading", "sub", "duration"]);
  });

  it("compiles escaped HTML with enter order on each element", () => {
    const html = titleDefinition.compile(
      titleSchema.parse({ type: "title", heading: "A <b> tag", sub: "Tom & Jerry" }),
    );
    expect(html).toContain('<h1 class="sf-title__heading" data-sf-enter="0">A &lt;b&gt; tag</h1>');
    expect(html).toContain('<p class="sf-title__sub" data-sf-enter="1">Tom &amp; Jerry</p>');
  });

  it("omits the sub element when there is no sub", () => {
    const html = titleDefinition.compile(titleSchema.parse({ type: "title", heading: "Solo" }));
    expect(html).not.toContain("sf-title__sub");
  });

  it("holds for the reading time of heading and sub together", () => {
    const props = titleSchema.parse({ type: "title", heading: "one two three", sub: "four five six" });
    expect(titleDefinition.holdSeconds(props)).toBe(2);
    expect(titleDefinition.summary(props)).toBe("one two three");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run packages/scenes/test/title.test.ts`
Expected: FAIL, cannot resolve `../src/text`.

- [ ] **Step 5: Implement**

`packages/scenes/src/text.ts`:

```ts
const WORDS_PER_SECOND = 3;

/** Seconds a viewer needs to read `text` on screen. */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

`packages/scenes/src/common.ts`:

```ts
import { z } from "zod";

export const durationSchema = z.union([z.literal("auto"), z.number().positive().max(120)]);
export type Duration = z.infer<typeof durationSchema>;
```

`packages/scenes/src/types.ts`:

```ts
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
  /** Inner HTML of the scene's <section>. All text must be escaped. */
  compile(props: P): string;
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

`packages/scenes/src/title/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

export const titleSchema = z.strictObject({
  type: z.literal("title"),
  heading: z.string().min(1).max(80),
  sub: z.string().min(1).max(140).optional(),
  duration: durationSchema.default("auto"),
});

export type TitleProps = z.infer<typeof titleSchema>;
```

`packages/scenes/src/title/definition.ts`:

```ts
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type TitleProps, titleSchema } from "./schema";

export const titleDefinition: SceneDefinition<TitleProps> = {
  type: "title",
  fields: Object.keys(titleSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds: (props) => readingSeconds(`${props.heading} ${props.sub ?? ""}`),
  summary: (props) => props.heading,
  compile(props) {
    const sub = props.sub
      ? `<p class="sf-title__sub" data-sf-enter="1">${escapeHtml(props.sub)}</p>`
      : "";
    return `<div class="sf-title"><h1 class="sf-title__heading" data-sf-enter="0">${escapeHtml(props.heading)}</h1>${sub}</div>`;
  },
  css: `
.sf-title{display:flex;flex-direction:column;justify-content:center;gap:calc(var(--sf-unit)*3);width:100%;height:100%;padding:calc(var(--sf-unit)*12)}
.sf-title__heading{font:700 calc(var(--sf-unit)*14)/1.02 var(--sf-font-sans);letter-spacing:-0.03em;color:var(--sf-text);max-width:16ch}
.sf-title__sub{font:400 calc(var(--sf-unit)*5)/1.25 var(--sf-font-sans);color:var(--sf-muted);max-width:36ch}
`,
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/scenes/test/title.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scenes): workspace scaffold and title scene definition"
```

---

### Task 2: The `terminal` scene (Node side) and the scene registry

**Files:**
- Create: `packages/scenes/src/terminal/schema.ts`, `src/terminal/timing.ts`, `src/terminal/definition.ts`, `src/index.ts`
- Test: `packages/scenes/test/terminal.test.ts`, `packages/scenes/test/registry.test.ts`

**Interfaces:**
- Consumes: `SceneDefinition`, `durationSchema`, `escapeHtml`, `readingSeconds`, `titleSchema`, `titleDefinition` (Task 1)
- Produces:
  - `terminalSchema`, `type TerminalProps`, `terminalDefinition`
  - `interface StepTiming { typeStart: number; typeEnd: number; outputAt: number; end: number }` (seconds from the start of the hold)
  - `terminalSchedule(steps: readonly { run: string; output?: string | undefined }[]): StepTiming[]`
  - `typedLength(length: number, timing: StepTiming, seconds: number): number`
  - From `@scenefile/scenes`: `sceneSchema`, `type Scene`, `type SceneType`, `SCENE_TYPES: SceneType[]`, `isSceneType(value: string): value is SceneType`, `getScene(type: SceneType): SceneDefinition<Scene>`, plus re-exports of `readingSeconds`, `escapeHtml`, and the types in `types.ts`

- [ ] **Step 1: Write the failing tests**

`packages/scenes/test/terminal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { terminalDefinition } from "../src/terminal/definition";
import { terminalSchema } from "../src/terminal/schema";
import { terminalSchedule, typedLength } from "../src/terminal/timing";

describe("terminal timing", () => {
  it("types 20 characters per second, then pauses, then shows output", () => {
    const [first, second] = terminalSchedule([
      { run: "0123456789", output: "one two three" },
      { run: "ab" },
    ]);
    expect(first).toEqual({ typeStart: 0, typeEnd: 0.5, outputAt: 0.8, end: 0.8 + 0.6 + 1 });
    expect(second?.typeStart).toBeCloseTo(2.4);
    expect(second?.end).toBeCloseTo(2.4 + 0.1 + 0.3);
  });

  it("counts characters by code point, not UTF-16 unit", () => {
    const [timing] = terminalSchedule([{ run: "🚀🚀" }]);
    expect(timing?.typeEnd).toBeCloseTo(0.1);
  });

  it("clamps the typed length to the command", () => {
    const [timing] = terminalSchedule([{ run: "abcd" }]);
    if (!timing) throw new Error("no timing");
    expect(typedLength(4, timing, -1)).toBe(0);
    expect(typedLength(4, timing, 0.1)).toBe(2);
    expect(typedLength(4, timing, 99)).toBe(4);
  });
});

describe("terminal scene", () => {
  it("requires at least one step and rejects unknown step fields", () => {
    expect(terminalSchema.safeParse({ type: "terminal", steps: [] }).success).toBe(false);
    expect(
      terminalSchema.safeParse({ type: "terminal", steps: [{ run: "ls", cwd: "/" }] }).success,
    ).toBe(false);
  });

  it("compiles each step with its command in a data attribute, escaped", () => {
    const props = terminalSchema.parse({
      type: "terminal",
      steps: [{ run: 'echo "<hi>"', output: "<hi>" }, { run: "ls" }],
    });
    const html = terminalDefinition.compile(props);
    expect(html).toContain('data-sf-type="echo &quot;&lt;hi&gt;&quot;"');
    expect(html).toContain('<pre class="sf-terminal__out" data-sf-out>&lt;hi&gt;</pre>');
    expect(html.match(/sf-terminal__step/g)).toHaveLength(2);
    expect(html.match(/data-sf-out/g)).toHaveLength(1);
  });

  it("holds until the last step ends, plus a tail", () => {
    const props = terminalSchema.parse({ type: "terminal", steps: [{ run: "0123456789" }] });
    expect(terminalDefinition.holdSeconds(props)).toBeCloseTo(0.5 + 0.3 + 0.4);
    expect(terminalDefinition.summary(props)).toBe("$ 0123456789");
  });

  it("summarizes extra steps as a count", () => {
    const props = terminalSchema.parse({ type: "terminal", steps: [{ run: "a" }, { run: "b" }, { run: "c" }] });
    expect(terminalDefinition.summary(props)).toBe("$ a (+2 more)");
  });
});
```

`packages/scenes/test/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SCENE_TYPES, getScene, isSceneType, sceneSchema } from "../src/index";

describe("scene registry", () => {
  it("knows every scene type in the schema", () => {
    expect(SCENE_TYPES).toEqual(["title", "terminal"]);
    for (const type of SCENE_TYPES) expect(getScene(type).type).toBe(type);
  });

  it("narrows strings to scene types", () => {
    expect(isSceneType("title")).toBe(true);
    expect(isSceneType("toString")).toBe(false);
    expect(isSceneType("video")).toBe(false);
  });

  it("parses a scene by its type", () => {
    const scene = sceneSchema.parse({ type: "terminal", steps: [{ run: "ls" }] });
    expect(scene.type).toBe("terminal");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/scenes`
Expected: the two new files FAIL on unresolved imports; `title.test.ts` still passes.

- [ ] **Step 3: Implement**

`packages/scenes/src/terminal/schema.ts`:

```ts
import { z } from "zod";
import { durationSchema } from "../common";

const stepSchema = z.strictObject({
  run: z.string().min(1).max(120),
  output: z.string().min(1).max(400).optional(),
});

export const terminalSchema = z.strictObject({
  type: z.literal("terminal"),
  steps: z.array(stepSchema).min(1).max(6),
  duration: durationSchema.default("auto"),
});

export type TerminalProps = z.infer<typeof terminalSchema>;
```

`packages/scenes/src/terminal/timing.ts`:

```ts
import { readingSeconds } from "../text";

export const CHARS_PER_SECOND = 20;
export const AFTER_TYPE_SECONDS = 0.3;
export const AFTER_OUTPUT_SECONDS = 0.6;
export const TAIL_SECONDS = 0.4;

/** Times in seconds, measured from the start of the scene's hold. */
export interface StepTiming {
  typeStart: number;
  typeEnd: number;
  outputAt: number;
  end: number;
}

/**
 * Shared by the Node side (to size the scene) and the browser side (to draw
 * it), so the two can never disagree about when a step happens.
 */
export function terminalSchedule(
  steps: readonly { run: string; output?: string | undefined }[],
): StepTiming[] {
  let cursor = 0;
  return steps.map((step) => {
    const typeStart = cursor;
    const typeEnd = typeStart + Array.from(step.run).length / CHARS_PER_SECOND;
    const outputAt = typeEnd + AFTER_TYPE_SECONDS;
    const end = step.output
      ? outputAt + AFTER_OUTPUT_SECONDS + readingSeconds(step.output)
      : outputAt;
    cursor = end;
    return { typeStart, typeEnd, outputAt, end };
  });
}

export function typedLength(length: number, timing: StepTiming, seconds: number): number {
  const typed = Math.floor((seconds - timing.typeStart) * CHARS_PER_SECOND);
  return Math.min(length, Math.max(0, typed));
}
```

`packages/scenes/src/terminal/definition.ts`:

```ts
import { escapeHtml } from "../text";
import type { SceneDefinition } from "../types";
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
  compile(props) {
    const steps = props.steps
      .map((step) => {
        const output = step.output
          ? `<pre class="sf-terminal__out" data-sf-out>${escapeHtml(step.output)}</pre>`
          : "";
        return `<div class="sf-terminal__step"><div class="sf-terminal__cmd"><span class="sf-terminal__prompt">$</span><span data-sf-type="${escapeHtml(step.run)}"></span><span class="sf-terminal__caret"></span></div>${output}</div>`;
      })
      .join("");
    return `<div class="sf-terminal"><div class="sf-terminal__window" data-sf-enter="0"><div class="sf-terminal__bar"><i></i><i></i><i></i></div><div class="sf-terminal__body">${steps}</div></div></div>`;
  },
  css: `
.sf-terminal{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:calc(var(--sf-unit)*10)}
.sf-terminal__window{width:100%;max-width:calc(var(--sf-unit)*130);background:var(--sf-surface);border:1px solid var(--sf-line);border-radius:calc(var(--sf-unit)*1.2);overflow:hidden}
.sf-terminal__bar{display:flex;gap:calc(var(--sf-unit)*0.8);padding:calc(var(--sf-unit)*1.6) calc(var(--sf-unit)*2);border-bottom:1px solid var(--sf-line)}
.sf-terminal__bar i{width:calc(var(--sf-unit)*1.2);height:calc(var(--sf-unit)*1.2);border-radius:50%;background:var(--sf-line)}
.sf-terminal__body{display:flex;flex-direction:column;gap:calc(var(--sf-unit)*1.6);padding:calc(var(--sf-unit)*3.5);font:400 calc(var(--sf-unit)*3.2)/1.4 var(--sf-font-mono);color:var(--sf-text)}
.sf-terminal__cmd{display:flex;align-items:center;white-space:pre}
.sf-terminal__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-terminal__caret{width:0.6em;height:1.1em;margin-left:2px;background:var(--sf-accent)}
.sf-terminal__out{font:inherit;color:var(--sf-muted);white-space:pre-wrap}
`,
};
```

`packages/scenes/src/index.ts`:

```ts
import { z } from "zod";
import { terminalDefinition } from "./terminal/definition";
import { terminalSchema } from "./terminal/schema";
import { titleDefinition } from "./title/definition";
import { titleSchema } from "./title/schema";
import type { SceneDefinition } from "./types";

export const sceneSchema = z.discriminatedUnion("type", [titleSchema, terminalSchema]);
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
  terminal: widen(terminalDefinition),
};

export const SCENE_TYPES = Object.keys(registry) as SceneType[];

export function isSceneType(value: string): value is SceneType {
  return Object.hasOwn(registry, value);
}

export function getScene(type: SceneType): SceneDefinition<Scene> {
  return registry[type];
}

export { durationSchema, type Duration } from "./common";
export { escapeHtml, readingSeconds } from "./text";
export type { MountContext, SceneDefinition, SceneHandle, SceneMount } from "./types";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/scenes`
Expected: PASS, all three files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scenes): terminal scene definition and scene registry"
```

---

### Task 3: Browser mounts with pure `seek`

**Files:**
- Create: `packages/scenes/src/motion.ts`, `src/title/mount.ts`, `src/terminal/mount.ts`, `src/browser.ts`
- Test: `packages/scenes/test/mounts.test.ts`

**Interfaces:**
- Consumes: `MountContext`, `SceneMount` (Task 1); `terminalSchedule`, `typedLength` (Task 2); the HTML produced by `titleDefinition.compile` and `terminalDefinition.compile`
- Produces:
  - `staggerEnter(el: HTMLElement, ctx: MountContext, frame: number): void`
  - `fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void`
  - From `@scenefile/scenes/browser`: `mounts: Record<string, SceneMount>` with keys `title` and `terminal`

- [ ] **Step 1: Write the failing test**

`packages/scenes/test/mounts.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/scenes/test/mounts.test.ts`
Expected: FAIL, cannot resolve `../src/browser`.

- [ ] **Step 3: Implement**

`packages/scenes/src/motion.ts`:

```ts
import type { MountContext } from "./types";

const STAGGER_FRAMES = 4;
const ENTER_OFFSET_PX = 40;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

/** Fades and lifts every [data-sf-enter] element in, in the order its value gives. */
export function staggerEnter(el: HTMLElement, ctx: MountContext, frame: number): void {
  for (const item of el.querySelectorAll<HTMLElement>("[data-sf-enter]")) {
    const start = Number(item.dataset.sfEnter) * STAGGER_FRAMES;
    const t = easeOutCubic(clamp01((frame - start) / ctx.enterFrames));
    item.style.opacity = String(t);
    item.style.transform = `translateY(${(1 - t) * ENTER_OFFSET_PX}px)`;
  }
}

/** Fades the whole scene out over its last `exitFrames` frames. */
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  const start = ctx.durationFrames - ctx.exitFrames;
  const t = easeInCubic(clamp01((frame - start) / ctx.exitFrames));
  el.style.opacity = String(1 - t);
}
```

`packages/scenes/src/title/mount.ts`:

```ts
import { fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";

export const mountTitle: SceneMount = (el, ctx) => ({
  seek(frame) {
    staggerEnter(el, ctx, frame);
    fadeExit(el, ctx, frame);
  },
});
```

`packages/scenes/src/terminal/mount.ts`:

```ts
import { fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { terminalSchedule, typedLength } from "./timing";

export const mountTerminal: SceneMount = (el, ctx) => {
  const steps = Array.from(el.querySelectorAll<HTMLElement>(".sf-terminal__step")).map((stepEl) => {
    const typed = stepEl.querySelector<HTMLElement>("[data-sf-type]");
    const caret = stepEl.querySelector<HTMLElement>(".sf-terminal__caret");
    const out = stepEl.querySelector<HTMLElement>("[data-sf-out]");
    if (!typed || !caret) throw new Error("terminal scene markup is missing its command elements");
    return {
      stepEl,
      typed,
      caret,
      out,
      // Code points, so slicing never cuts a surrogate pair in half.
      chars: Array.from(typed.dataset.sfType ?? ""),
      output: out?.textContent ?? undefined,
    };
  });
  const schedule = terminalSchedule(
    steps.map((step) => ({ run: step.chars.join(""), output: step.output })),
  );

  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      steps.forEach((step, i) => {
        const timing = schedule[i];
        if (!timing) return;
        const next = schedule[i + 1];
        const started = i === 0 || seconds >= timing.typeStart;
        const current = started && (!next || seconds < next.typeStart);
        step.stepEl.style.visibility = started ? "visible" : "hidden";
        step.typed.textContent = step.chars
          .slice(0, typedLength(step.chars.length, timing, seconds))
          .join("");
        step.caret.style.visibility = current ? "visible" : "hidden";
        if (step.out) step.out.style.visibility = seconds >= timing.outputAt ? "visible" : "hidden";
      });
    },
  };
};
```

`packages/scenes/src/browser.ts`:

```ts
import { mountTerminal } from "./terminal/mount";
import { mountTitle } from "./title/mount";
import type { SceneMount } from "./types";

/** Browser-side registry. Must not import zod: this file is bundled into the page. */
export const mounts: Record<string, SceneMount> = {
  title: mountTitle,
  terminal: mountTerminal,
};

export type { MountContext, SceneHandle, SceneMount } from "./types";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/scenes`
Expected: PASS, four files.

- [ ] **Step 5: Verify the package builds**

Run: `pnpm --filter @scenefile/scenes build`
Expected: `packages/scenes/dist/` contains `index.js`, `browser.js`, and their `.d.ts` files.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scenes): browser mounts with pure seek for title and terminal"
```

---

### Task 4: `@scenefile/schema` — scenefile schema, parsing, normalizer

**Files:**
- Create: `packages/schema/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/schema/src/diagnostics.ts`, `src/distance.ts`, `src/scenefile.ts`, `src/parse.ts`, `src/normalize.ts`, `src/index.ts`
- Test: `packages/schema/test/distance.test.ts`, `test/parse.test.ts`, `test/normalize.test.ts`

**Interfaces:**
- Consumes: `sceneSchema`, `SCENE_TYPES`, `isSceneType`, `getScene` from `@scenefile/scenes`
- Produces:
  - `type Severity = "error" | "warning"`
  - `interface Diagnostic { code: string; severity: Severity; path: string; message: string; fix: string }`
  - `error(code, path, message, fix): Diagnostic`, `warning(code, path, message, fix): Diagnostic`, `hasErrors(diagnostics: readonly Diagnostic[]): boolean`
  - `nearest(word: string, candidates: readonly string[]): string | undefined`
  - `FORMATS`, `THEMES`, `scenefileSchema`, `type Scenefile`, `type Format`, `type ThemeName`
  - `parseScenefileText(text: string): { value: unknown; diagnostics: Diagnostic[] }` (`value` is `undefined` when parsing failed)
  - `normalize(input: unknown): { scenefile: Scenefile | null; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Create the package shell**

`packages/schema/package.json`:

```json
{
  "name": "@scenefile/schema",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "dependencies": { "@scenefile/scenes": "workspace:*" }
}
```

`packages/schema/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/schema/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({ entry: ["src/index.ts"], format: ["esm"], dts: true, clean: true });
```

Run: `pnpm --filter @scenefile/schema add zod@^4 && pnpm install`
Expected: install completes; `packages/schema/node_modules/@scenefile/scenes` is a symlink.

- [ ] **Step 2: Write the failing tests**

`packages/schema/test/distance.test.ts`:

```ts
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
```

`packages/schema/test/parse.test.ts`:

```ts
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
```

`packages/schema/test/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize";

const minimal = { version: 1, scenes: [{ type: "title", heading: "Hi" }] };

describe("normalize", () => {
  it("fills defaults on a minimal scenefile", () => {
    const { scenefile, diagnostics } = normalize(minimal);
    expect(diagnostics).toEqual([]);
    expect(scenefile).toMatchObject({
      version: 1,
      format: "landscape-1080p",
      fps: 30,
      theme: "midnight",
      scenes: [{ type: "title", heading: "Hi", duration: "auto" }],
    });
  });

  it("does not mutate its input", () => {
    const input = { version: 1, scenes: [{ type: "Title", heading: "Hi", subtitle: "x" }] };
    const copy = structuredClone(input);
    normalize(input);
    expect(input).toEqual(copy);
  });

  it.each([null, 42, "text", []])("rejects a non-object root: %j", (input) => {
    const { scenefile, diagnostics } = normalize(input);
    expect(scenefile).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ code: "SCHEMA_ROOT", path: "" })]);
  });

  it("renames known aliases with a warning", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "title", title: "Hi", subtitle: "there" }],
    });
    expect(scenefile?.scenes[0]).toMatchObject({ heading: "Hi", sub: "there" });
    expect(diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ["AUTOFIXED", "warning", "scenes[0].title"],
      ["AUTOFIXED", "warning", "scenes[0].subtitle"],
    ]);
  });

  it("fixes the case of a scene type and of field names", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: " Title ", Heading: "Hi" }],
    });
    expect(scenefile?.scenes[0]).toMatchObject({ type: "title", heading: "Hi" });
    expect(diagnostics.every((d) => d.code === "AUTOFIXED")).toBe(true);
    expect(diagnostics).toHaveLength(2);
  });

  it("coerces duration strings", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [
        { type: "title", heading: "a", duration: "5s" },
        { type: "title", heading: "b", duration: " 2.5 seconds" },
        { type: "title", heading: "c", duration: "AUTO" },
      ],
    });
    expect(scenefile?.scenes.map((s) => s.duration)).toEqual([5, 2.5, "auto"]);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toMatchObject({ code: "AUTOFIXED", path: "scenes[0].duration" });
  });

  it("suggests the nearest field for a typo and reports it once", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "title", heading: "Hi", duraton: 3 }],
    });
    expect(scenefile).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "SCHEMA_UNKNOWN_FIELD",
      severity: "error",
      path: "scenes[0].duraton",
    });
    expect(diagnostics[0]?.message).toContain('Did you mean "duration"?');
    expect(diagnostics[0]?.fix).toContain("heading");
  });

  it("suggests the nearest scene type and reports the scene once", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [{ type: "terminl", steps: [] }] });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_UNKNOWN_SCENE", path: "scenes[0].type" });
    expect(diagnostics[0]?.message).toContain('Did you mean "terminal"?');
  });

  it("reports a scene with no type", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [{ heading: "Hi" }] });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "SCHEMA_UNKNOWN_SCENE", path: "scenes[0].type" }),
    ]);
    expect(diagnostics[0]?.fix).toContain("title, terminal");
  });

  it("reports unknown top-level fields with a suggestion", () => {
    const { diagnostics } = normalize({ ...minimal, themee: "midnight" });
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_UNKNOWN_FIELD", path: "themee" });
    expect(diagnostics[0]?.message).toContain('"theme"');
  });

  it("reports schema violations with a bracketed path", () => {
    const { scenefile, diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "terminal", steps: [{ run: "ls", cwd: "/" }] }],
    });
    expect(scenefile).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", severity: "error" });
    expect(diagnostics[0]?.path.startsWith("scenes[0].steps[0]")).toBe(true);
  });

  it("reports a missing scenes array and an empty one", () => {
    expect(normalize({ version: 1 }).diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes" });
    expect(normalize({ version: 1, scenes: [] }).diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes" });
  });

  it("rejects an unsupported version and a malformed accent", () => {
    expect(normalize({ ...minimal, version: 2 }).diagnostics[0]).toMatchObject({ path: "version" });
    expect(normalize({ ...minimal, accent: "red" }).diagnostics[0]).toMatchObject({ path: "accent" });
    expect(normalize({ ...minimal, accent: "#FF5722" }).scenefile?.accent).toBe("#FF5722");
  });

  it("keeps reporting other scenes when one is broken", () => {
    const { diagnostics } = normalize({
      version: 1,
      scenes: [{ type: "nope" }, { type: "title", heading: "" }],
    });
    expect(diagnostics.map((d) => d.path)).toEqual(["scenes[0].type", "scenes[1].heading"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/schema`
Expected: FAIL on unresolved imports.

- [ ] **Step 4: Implement**

`packages/schema/src/diagnostics.ts`:

```ts
export type Severity = "error" | "warning";

/** One problem, written so a language model can act on it without seeing the video. */
export interface Diagnostic {
  code: string;
  severity: Severity;
  /** Location in the scenefile, e.g. `scenes[2].heading`. Empty for the document itself. */
  path: string;
  message: string;
  /** A concrete instruction that resolves the problem. */
  fix: string;
}

export function error(code: string, path: string, message: string, fix: string): Diagnostic {
  return { code, severity: "error", path, message, fix };
}

export function warning(code: string, path: string, message: string, fix: string): Diagnostic {
  return { code, severity: "warning", path, message, fix };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
```

`packages/schema/src/distance.ts`:

```ts
function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The candidate closest to `word`, or undefined when none is plausibly a typo of it. */
export function nearest(word: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(2, Math.floor(word.length / 3));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
```

`packages/schema/src/scenefile.ts`:

```ts
import { sceneSchema } from "@scenefile/scenes";
import { z } from "zod";

export const FORMATS = ["landscape-1080p", "portrait-1080p", "square-1080p"] as const;
export const THEMES = ["midnight"] as const;

export const scenefileSchema = z.strictObject({
  version: z.literal(1),
  format: z.enum(FORMATS).default("landscape-1080p"),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  theme: z.enum(THEMES).default("midnight"),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a six-digit hex color like #FF5722.")
    .optional(),
  scenes: z.array(sceneSchema).min(1).max(60),
});

export type Scenefile = z.infer<typeof scenefileSchema>;
export type Format = (typeof FORMATS)[number];
export type ThemeName = (typeof THEMES)[number];

export const TOP_LEVEL_FIELDS: readonly string[] = Object.keys(scenefileSchema.shape);
```

`packages/schema/src/parse.ts`:

```ts
import { type Diagnostic, error, warning } from "./diagnostics";

const JSON_FIX =
  "Output one JSON object only: double-quoted keys and strings, no comments, no trailing commas, no text around it.";

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * Turns file contents into a JSON value. Models often wrap JSON in a Markdown
 * code fence with prose around it; that is unwrapped and reported, not rejected.
 */
export function parseScenefileText(text: string): { value: unknown; diagnostics: Diagnostic[] } {
  const direct = tryParse(text);
  if (direct.ok) return { value: direct.value, diagnostics: [] };

  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i.exec(text);
  if (fenced?.[1] !== undefined) {
    const inner = tryParse(fenced[1]);
    if (inner.ok) {
      return {
        value: inner.value,
        diagnostics: [
          warning("AUTOFIXED", "", "Removed a Markdown code fence and the text around the JSON.", JSON_FIX),
        ],
      };
    }
  }

  const message = text.trim() === "" ? "The scenefile is empty." : `The scenefile is not valid JSON: ${direct.reason}`;
  return { value: undefined, diagnostics: [error("SCHEMA_JSON", "", message, JSON_FIX)] };
}
```

`packages/schema/src/normalize.ts`:

```ts
import { SCENE_TYPES, getScene, isSceneType } from "@scenefile/scenes";
import { type Diagnostic, error, hasErrors, warning } from "./diagnostics";
import { nearest } from "./distance";
import { type Scenefile, TOP_LEVEL_FIELDS, scenefileSchema } from "./scenefile";

type Json = Record<string, unknown>;

/** Names models commonly use for a field, mapped to the real one. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  subtitle: "sub",
  subheading: "sub",
  title: "heading",
  headline: "heading",
  commands: "steps",
};

const DURATION_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?\s*$/i;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}

/** Renames aliases and case variants; reports and removes fields that match nothing. */
function fixKeys(obj: Json, known: readonly string[], path: string, diagnostics: Diagnostic[]): void {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue;
    const at = path ? `${path}.${key}` : key;
    const alias = FIELD_ALIASES[key.toLowerCase()];
    const target =
      alias !== undefined && known.includes(alias)
        ? alias
        : known.find((name) => name.toLowerCase() === key.toLowerCase());

    if (target !== undefined && !(target in obj)) {
      obj[target] = obj[key];
      delete obj[key];
      diagnostics.push(warning("AUTOFIXED", at, `Renamed "${key}" to "${target}".`, `Use "${target}".`));
      continue;
    }

    const guess = nearest(key, known);
    delete obj[key];
    diagnostics.push(
      error(
        "SCHEMA_UNKNOWN_FIELD",
        at,
        guess ? `Unknown field "${key}". Did you mean "${guess}"?` : `Unknown field "${key}".`,
        `Allowed fields here: ${known.join(", ")}.`,
      ),
    );
  }
}

function coerceDuration(scene: Json, path: string, diagnostics: Diagnostic[]): void {
  const raw = scene.duration;
  if (typeof raw !== "string" || raw === "auto") return;
  const at = `${path}.duration`;
  if (raw.trim().toLowerCase() === "auto") {
    scene.duration = "auto";
    diagnostics.push(warning("AUTOFIXED", at, `Read "${raw}" as "auto".`, 'Write "auto" in lower case.'));
    return;
  }
  const match = DURATION_PATTERN.exec(raw);
  if (match?.[1] === undefined) return;
  const seconds = Number(match[1]);
  scene.duration = seconds;
  diagnostics.push(
    warning("AUTOFIXED", at, `Read "${raw}" as ${seconds} seconds.`, `Write a number: "duration": ${seconds}.`),
  );
}

/** Returns true when the scene cannot be validated further (its type is unusable). */
function normalizeScene(scene: unknown, path: string, diagnostics: Diagnostic[]): boolean {
  if (!isObject(scene)) return false;
  const allowed = `"type" must be one of: ${SCENE_TYPES.join(", ")}.`;
  const rawType = scene.type;

  if (typeof rawType !== "string") {
    diagnostics.push(error("SCHEMA_UNKNOWN_SCENE", `${path}.type`, 'This scene has no "type".', allowed));
    return true;
  }

  const type = rawType.trim().toLowerCase();
  if (!isSceneType(type)) {
    const guess = nearest(type, SCENE_TYPES);
    diagnostics.push(
      error(
        "SCHEMA_UNKNOWN_SCENE",
        `${path}.type`,
        guess ? `Unknown scene type "${rawType}". Did you mean "${guess}"?` : `Unknown scene type "${rawType}".`,
        allowed,
      ),
    );
    return true;
  }

  if (type !== rawType) {
    scene.type = type;
    diagnostics.push(warning("AUTOFIXED", `${path}.type`, `Read "${rawType}" as "${type}".`, `Write "${type}".`));
  }
  fixKeys(scene, getScene(type).fields, path, diagnostics);
  coerceDuration(scene, path, diagnostics);
  return false;
}

/**
 * Validates a parsed scenefile, repairing the small mistakes models make and
 * reporting each repair. Returns the normalized scenefile only when no errors
 * remain.
 */
export function normalize(input: unknown): { scenefile: Scenefile | null; diagnostics: Diagnostic[] } {
  if (!isObject(input)) {
    return {
      scenefile: null,
      diagnostics: [
        error(
          "SCHEMA_ROOT",
          "",
          "A scenefile must be a JSON object.",
          'Start with {"version": 1, "scenes": [ ... ]}.',
        ),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const draft = structuredClone(input);
  fixKeys(draft, TOP_LEVEL_FIELDS, "", diagnostics);

  // Scenes whose type is unusable are already reported; hide the schema's echo of them.
  const blocked: string[] = [];
  if (Array.isArray(draft.scenes)) {
    draft.scenes.forEach((scene: unknown, index: number) => {
      const path = `scenes[${index}]`;
      if (normalizeScene(scene, path, diagnostics)) blocked.push(path);
    });
  }

  const parsed = scenefileSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = formatPath(issue.path);
      if (blocked.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) continue;
      diagnostics.push(
        error(
          "SCHEMA_INVALID",
          path,
          issue.message,
          "Run `scenefile scenes` for the allowed fields and values.",
        ),
      );
    }
  }

  return {
    scenefile: parsed.success && !hasErrors(diagnostics) ? parsed.data : null,
    diagnostics,
  };
}
```

`packages/schema/src/index.ts`:

```ts
export { type Diagnostic, type Severity, error, hasErrors, warning } from "./diagnostics";
export { nearest } from "./distance";
export { normalize } from "./normalize";
export { parseScenefileText } from "./parse";
export {
  FORMATS,
  type Format,
  type Scenefile,
  THEMES,
  type ThemeName,
  scenefileSchema,
} from "./scenefile";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/schema`
Expected: PASS, three files. If a `SCHEMA_INVALID` path assertion fails, print `parsed.error.issues` once to see how Zod 4 reports that case and adjust `formatPath` or the `blocked` filter, not the test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(schema): scenefile schema, tolerant parser, and normalizer"
```

---

### Task 5: `@scenefile/engine` — resolve, compile, check

**Files:**
- Create: `packages/engine/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/engine/src/formats.ts`, `src/resolve.ts`, `src/themes.ts`, `src/compile.ts`, `src/check.ts`, `src/index.ts`
- Test: `packages/engine/test/resolve.test.ts`, `test/compile.test.ts`, `test/check.test.ts`

**Interfaces:**
- Consumes: `normalize`, `Scenefile`, `Format`, `ThemeName`, `Diagnostic`, `error`, `warning`, `hasErrors` from `@scenefile/schema`; `getScene`, `Scene` from `@scenefile/scenes`
- Produces:
  - `FORMAT_SIZES: Record<Format, { width: number; height: number }>`
  - `interface ResolvedScene { index: number; type: Scene["type"]; props: Scene; startFrame: number; durationFrames: number; enterFrames: number; exitFrames: number }`
  - `interface ResolvedVideo { width: number; height: number; fps: number; theme: ThemeName; accent: string | undefined; totalFrames: number; scenes: ResolvedScene[] }`
  - `resolve(scenefile: Scenefile): { video: ResolvedVideo; diagnostics: Diagnostic[] }`
  - `interface ManifestScene { index: number; type: string; startFrame: number; durationFrames: number; enterFrames: number; exitFrames: number }`
  - `interface Manifest { fps: number; width: number; height: number; totalFrames: number; scenes: ManifestScene[] }`
  - `interface Composition { html: string; manifest: Manifest }`
  - `compile(video: ResolvedVideo): Composition`
  - `storyboard(video: ResolvedVideo): string`
  - `interface CheckResult { ok: boolean; diagnostics: Diagnostic[]; scenefile: Scenefile | null; composition: Composition | null; storyboard: string }`
  - `check(input: unknown): CheckResult`

- [ ] **Step 1: Create the package shell**

`packages/engine/package.json`:

```json
{
  "name": "@scenefile/engine",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "dependencies": {
    "@scenefile/scenes": "workspace:*",
    "@scenefile/schema": "workspace:*"
  }
}
```

`packages/engine/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/engine/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({ entry: ["src/index.ts"], format: ["esm"], dts: true, clean: true });
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/resolve.test.ts`:

```ts
import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve";

function resolved(input: unknown) {
  const { scenefile, diagnostics } = normalize(input);
  if (!scenefile) throw new Error(JSON.stringify(diagnostics));
  return resolve(scenefile);
}

describe("resolve", () => {
  it("sizes an auto scene as enter + hold + exit, in frames", () => {
    // title: enter 0.6, exit 0.4, min hold 1.5; six words read in 2 s
    const { video, diagnostics } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "one two three", sub: "four five six" }],
    });
    expect(diagnostics).toEqual([]);
    expect(video).toMatchObject({ width: 1920, height: 1080, fps: 30, totalFrames: 90 });
    expect(video.scenes[0]).toMatchObject({ startFrame: 0, durationFrames: 90, enterFrames: 18, exitFrames: 12 });
  });

  it("uses the minimum hold when there is little to read", () => {
    const { video } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(video.scenes.map((s) => [s.startFrame, s.durationFrames])).toEqual([[0, 75], [75, 75]]);
    expect(video.totalFrames).toBe(150);
  });

  it("scales frames with fps and sizes with format", () => {
    const { video } = resolved({
      version: 1,
      fps: 60,
      format: "portrait-1080p",
      scenes: [{ type: "title", heading: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(video).toMatchObject({ width: 1080, height: 1920, fps: 60, totalFrames: 300 });
  });

  it("warns when an explicit duration is too short to read", () => {
    const { video, diagnostics } = resolved({
      version: 1,
      scenes: [
        { type: "title", heading: "one two three four five six seven eight nine", duration: 2 },
        { type: "title", heading: "Hi", duration: 3 },
      ],
    });
    expect(video.scenes[0]?.durationFrames).toBe(60);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "PACING_FAST", severity: "warning", path: "scenes[0].duration" }),
    ]);
    expect(diagnostics[0]?.fix).toContain("4.0");
  });

  it("warns when an explicit duration is far longer than needed", () => {
    const { diagnostics } = resolved({
      version: 1,
      scenes: [{ type: "title", heading: "Hi", duration: 20 }],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "PACING_SLOW", severity: "warning", path: "scenes[0].duration" }),
    ]);
  });

  it("never makes a scene shorter than its enter and exit", () => {
    const { video } = resolved({
      version: 1,
      scenes: [
        { type: "title", heading: "Hi", duration: 0.2 },
        { type: "title", heading: "Hi", duration: 5 },
      ],
    });
    expect(video.scenes[0]?.durationFrames).toBe(31);
  });

  it("rejects a video shorter than three seconds", () => {
    const { diagnostics } = resolved({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "TOTAL_DURATION", severity: "error", path: "scenes" }),
    ]);
  });

  it("rejects a video longer than ten minutes", () => {
    const scenes = Array.from({ length: 6 }, () => ({ type: "title", heading: "Hi", duration: 110 }));
    const { diagnostics } = resolved({ version: 1, scenes });
    expect(diagnostics.filter((d) => d.code === "TOTAL_DURATION")).toHaveLength(1);
  });
});
```

`packages/engine/test/compile.test.ts`:

```ts
import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import { resolve } from "../src/resolve";

function compiled(input: unknown) {
  const { scenefile } = normalize(input);
  if (!scenefile) throw new Error("invalid fixture");
  return compile(resolve(scenefile).video);
}

const input = {
  version: 1,
  accent: "#00FF88",
  scenes: [
    { type: "title", heading: "</script><script>alert(1)</script>" },
    { type: "terminal", steps: [{ run: "ls" }] },
  ],
};

describe("compile", () => {
  it("emits one section per scene, in order", () => {
    const { html } = compiled(input);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const first = html.indexOf('data-sf-scene="0" data-sf-type="title"');
    const second = html.indexOf('data-sf-scene="1" data-sf-type="terminal"');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("embeds a manifest that matches the returned one", () => {
    const { html, manifest } = compiled(input);
    const match = /<script id="sf-manifest" type="application\/json">(.*?)<\/script>/s.exec(html);
    expect(JSON.parse(match?.[1] ?? "null")).toEqual(manifest);
    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.totalFrames).toBe(
      manifest.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0),
    );
    expect(manifest.scenes[0]).toEqual({
      index: 0, type: "title", startFrame: 0, durationFrames: 75, enterFrames: 18, exitFrames: 12,
    });
  });

  it("keeps user text from closing the document's own tags", () => {
    const { html } = compiled(input);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("applies the accent override and sizes the page to the format", () => {
    const { html } = compiled(input);
    expect(html).toContain("--sf-accent:#00FF88");
    expect(html).toContain("--sf-unit:10.8px");
    expect(html).toContain("width:1920px;height:1080px");
  });

  it("includes CSS only for the scene types used", () => {
    const titleOnly = compiled({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(titleOnly.html).toContain(".sf-title__heading");
    expect(titleOnly.html).not.toContain(".sf-terminal__window");
  });
});
```

`packages/engine/test/check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { check } from "../src/check";

describe("check", () => {
  it("returns a composition and storyboard for a valid scenefile", () => {
    const result = check({
      version: 1,
      scenes: [
        { type: "title", heading: "Ship faster", sub: "A CLI for X" },
        { type: "terminal", steps: [{ run: "npx x init", output: "Done in 2s" }] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.composition?.manifest.scenes).toHaveLength(2);
    expect(result.storyboard.split("\n")).toEqual([
      "1920x1080, 30 fps, 6.70s, 2 scenes",
      "1. title     0.00s-3.00s  Ship faster",
      "2. terminal  3.00s-6.70s  $ npx x init",
    ]);
  });

  it("is ok with warnings and keeps them", () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", title: "Hi" }, { type: "title", heading: "Yo" }],
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["AUTOFIXED"]);
    expect(result.scenefile?.scenes[0]).toMatchObject({ heading: "Hi" });
  });

  it("returns no composition when validation fails", () => {
    const result = check({ version: 1, scenes: [{ type: "nope" }] });
    expect(result).toMatchObject({ ok: false, scenefile: null, composition: null, storyboard: "" });
  });

  it("returns no composition when resolving fails, but keeps the normalized scenefile", () => {
    const result = check({ version: 1, scenes: [{ type: "title", heading: "Hi" }] });
    expect(result.ok).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.scenefile).not.toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["TOTAL_DURATION"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/engine`
Expected: FAIL on unresolved imports.

- [ ] **Step 4: Implement**

`packages/engine/src/formats.ts`:

```ts
import type { Format } from "@scenefile/schema";

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  "landscape-1080p": { width: 1920, height: 1080 },
  "portrait-1080p": { width: 1080, height: 1920 },
  "square-1080p": { width: 1080, height: 1080 },
};
```

`packages/engine/src/resolve.ts`:

```ts
import { type Diagnostic, type Scenefile, type ThemeName, error, warning } from "@scenefile/schema";
import { type Scene, getScene } from "@scenefile/scenes";
import { FORMAT_SIZES } from "./formats";

export interface ResolvedScene {
  index: number;
  type: Scene["type"];
  props: Scene;
  startFrame: number;
  durationFrames: number;
  enterFrames: number;
  exitFrames: number;
}

export interface ResolvedVideo {
  width: number;
  height: number;
  fps: number;
  theme: ThemeName;
  accent: string | undefined;
  totalFrames: number;
  scenes: ResolvedScene[];
}

const MIN_TOTAL_SECONDS = 3;
const MAX_TOTAL_SECONDS = 600;
/** An explicit duration below this share of the automatic one is too fast to read. */
const FAST_RATIO = 0.75;
const SLOW_RATIO = 3;

function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** Turns "auto" values into numbers and places every scene on the frame timeline. */
export function resolve(scenefile: Scenefile): { video: ResolvedVideo; diagnostics: Diagnostic[] } {
  const { fps } = scenefile;
  const diagnostics: Diagnostic[] = [];
  let cursor = 0;

  const scenes = scenefile.scenes.map((props, index): ResolvedScene => {
    const definition = getScene(props.type);
    const enterFrames = toFrames(definition.enterSeconds, fps);
    const exitFrames = toFrames(definition.exitSeconds, fps);
    const autoSeconds =
      definition.enterSeconds +
      Math.max(definition.minHoldSeconds, definition.holdSeconds(props)) +
      definition.exitSeconds;

    if (props.duration !== "auto") {
      const path = `scenes[${index}].duration`;
      const needed = autoSeconds.toFixed(1);
      if (props.duration < autoSeconds * FAST_RATIO) {
        diagnostics.push(
          warning(
            "PACING_FAST",
            path,
            `${props.duration}s is too short to read this scene; it needs about ${needed}s.`,
            `Set "duration" to "auto" or to at least ${needed}.`,
          ),
        );
      } else if (props.duration > autoSeconds * SLOW_RATIO) {
        diagnostics.push(
          warning(
            "PACING_SLOW",
            path,
            `${props.duration}s is much longer than the ${needed}s this scene needs; it will feel stalled.`,
            `Set "duration" to "auto" or add content to the scene.`,
          ),
        );
      }
    }

    const requested = toFrames(props.duration === "auto" ? autoSeconds : props.duration, fps);
    const durationFrames = Math.max(requested, enterFrames + exitFrames + 1);
    const scene = { index, type: props.type, props, startFrame: cursor, durationFrames, enterFrames, exitFrames };
    cursor += durationFrames;
    return scene;
  });

  const totalSeconds = cursor / fps;
  if (totalSeconds < MIN_TOTAL_SECONDS || totalSeconds > MAX_TOTAL_SECONDS) {
    diagnostics.push(
      error(
        "TOTAL_DURATION",
        "scenes",
        `The video is ${totalSeconds.toFixed(1)}s long; it must be between ${MIN_TOTAL_SECONDS}s and ${MAX_TOTAL_SECONDS}s.`,
        totalSeconds < MIN_TOTAL_SECONDS ? "Add scenes or lengthen them." : "Remove scenes or shorten them.",
      ),
    );
  }

  const size = FORMAT_SIZES[scenefile.format];
  return {
    video: {
      width: size.width,
      height: size.height,
      fps,
      theme: scenefile.theme,
      accent: scenefile.accent,
      totalFrames: cursor,
      scenes,
    },
    diagnostics,
  };
}
```

`packages/engine/src/themes.ts`:

```ts
import type { ThemeName } from "@scenefile/schema";

export interface Theme {
  background: string;
  surface: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  fontSans: string;
  fontMono: string;
}

/** Neutral greys only: no hue tint in the darks. */
const THEME_TOKENS: Record<ThemeName, Theme> = {
  midnight: {
    background: "#0A0A0A",
    surface: "#141414",
    line: "#2A2A2A",
    text: "#F4F4F4",
    muted: "#8C8C8C",
    accent: "#FF5A1F",
    fontSans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    fontMono: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
  },
};

/** CSS custom properties for a theme. `--sf-unit` is 1% of the short side of the frame. */
export function themeCss(name: ThemeName, accent: string | undefined, width: number, height: number): string {
  const theme = THEME_TOKENS[name];
  return [
    ":root{",
    `--sf-bg:${theme.background};`,
    `--sf-surface:${theme.surface};`,
    `--sf-line:${theme.line};`,
    `--sf-text:${theme.text};`,
    `--sf-muted:${theme.muted};`,
    `--sf-accent:${accent ?? theme.accent};`,
    `--sf-font-sans:${theme.fontSans};`,
    `--sf-font-mono:${theme.fontMono};`,
    `--sf-unit:${Math.min(width, height) / 100}px`,
    "}",
  ].join("");
}
```

`packages/engine/src/compile.ts`:

```ts
import { getScene } from "@scenefile/scenes";
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

/** Builds the single HTML document Chromium renders. Pure: no I/O, no clock. */
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
  const sections = video.scenes
    .map(
      (scene) =>
        `<section class="sf-scene" data-sf-scene="${scene.index}" data-sf-type="${scene.type}" hidden>${getScene(scene.type).compile(scene.props)}</section>`,
    )
    .join("\n");
  // "<" is escaped so nothing in the JSON can end the script element.
  const manifestJson = JSON.stringify(manifest).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${themeCss(video.theme, video.accent, video.width, video.height)}${baseCss(video.width, video.height)}
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

`packages/engine/src/check.ts`:

```ts
import { type Diagnostic, type Scenefile, hasErrors, normalize } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { type Composition, compile } from "./compile";
import { type ResolvedVideo, resolve } from "./resolve";

export interface CheckResult {
  /** True when there are no errors. Warnings do not block rendering. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The scenefile with defaults filled and repairs applied; null when it failed validation. */
  scenefile: Scenefile | null;
  composition: Composition | null;
  storyboard: string;
}

/** A plain-text description of the video, so a model without vision can review it. */
export function storyboard(video: ResolvedVideo): string {
  const seconds = (frames: number): string => `${(frames / video.fps).toFixed(2)}s`;
  const typeWidth = Math.max(...video.scenes.map((scene) => scene.type.length));
  const header = `${video.width}x${video.height}, ${video.fps} fps, ${seconds(video.totalFrames)}, ${video.scenes.length} scenes`;
  const lines = video.scenes.map((scene) => {
    const range = `${seconds(scene.startFrame)}-${seconds(scene.startFrame + scene.durationFrames)}`;
    return `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}`;
  });
  return [header, ...lines].join("\n");
}

/** The whole pre-render pipeline: validate, resolve, compile. Pure. */
export function check(input: unknown): CheckResult {
  const normalized = normalize(input);
  if (!normalized.scenefile) {
    return { ok: false, diagnostics: normalized.diagnostics, scenefile: null, composition: null, storyboard: "" };
  }

  const resolved = resolve(normalized.scenefile);
  const diagnostics = [...normalized.diagnostics, ...resolved.diagnostics];
  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics, scenefile: normalized.scenefile, composition: null, storyboard: "" };
  }

  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    composition: compile(resolved.video),
    storyboard: storyboard(resolved.video),
  };
}
```

`packages/engine/src/index.ts`:

```ts
export { type CheckResult, check, storyboard } from "./check";
export { type Composition, type Manifest, type ManifestScene, compile } from "./compile";
export { FORMAT_SIZES } from "./formats";
export { type ResolvedScene, type ResolvedVideo, resolve } from "./resolve";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/engine`
Expected: PASS, three files.

The storyboard test pins exact numbers, derived by hand from the scene constants:
- Title: six words read in 2 s, which beats the 1.5 s minimum hold, so `0.6 + 2 + 0.4 = 3.0 s` = 90 frames.
- Terminal: typing 10 characters takes 0.5 s, output appears at 0.8 s, then `0.6 + 1.0` s to read three words, plus a 0.4 s tail: hold 2.8 s. Scene `0.5 + 2.8 + 0.4 = 3.7 s` = 111 frames.
- Total 201 frames = 6.70 s.

If these fail, find the arithmetic error in the implementation; do not edit the expected strings or the constants to make them agree.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): resolve timings, compile composition, check with storyboard"
```

---

### Task 6: `@scenefile/runtime` and `@scenefile/render` — frames to MP4

**Files:**
- Create: `packages/runtime/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`
- Create: `packages/render/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/render/src/errors.ts`, `src/session.ts`, `src/capture.ts`, `src/encode.ts`, `src/probe.ts`, `src/render.ts`, `src/index.ts`
- Create: `test/global-setup.ts`
- Modify: `vitest.config.ts` (add `globalSetup`)
- Test: `packages/render/test/render.test.ts`

**Interfaces:**
- Consumes: `Composition`, `Manifest`, `check` from `@scenefile/engine`; `mounts`, `MountContext` from `@scenefile/scenes/browser`
- Produces:
  - In the page: `window.__scenefile = { seek(frame: number): void; totalFrames: number }`
  - `class EnvironmentError extends Error { readonly remedy: string }`
  - `openComposition(composition: Composition): Promise<Session>` where `interface Session { page: Page; close(): Promise<void> }`
  - `captureFrame(page: Page, frame: number): Promise<Buffer>`
  - `startEncoder(options: { output: string; fps: number; crf: number; ffmpegPath?: string }): Encoder` where `interface Encoder { write(frame: Buffer): Promise<void>; finish(): Promise<void> }`
  - `probeVideo(file: string, ffprobePath?: string): Promise<{ width: number; height: number; fps: number; frames: number; durationSeconds: number }>`
  - `type Quality = "draft" | "standard" | "high"`, `QUALITIES: readonly Quality[]`
  - `interface RenderOptions { output: string; quality?: Quality; ffmpegPath?: string; ffprobePath?: string; onProgress?: (done: number, total: number) => void }`
  - `interface RenderReport { output: string; width: number; height: number; fps: number; frames: number; durationSeconds: number; elapsedMs: number }`
  - `renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport>`

- [ ] **Step 1: Create the runtime package**

`packages/runtime/package.json`:

```json
{
  "name": "@scenefile/runtime",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    "./bundle": "./dist/index.global.js"
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "devDependencies": { "@scenefile/scenes": "workspace:*" }
}
```

`packages/runtime/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/runtime/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

// One self-contained script for the page: every dependency is inlined.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["iife"],
  platform: "browser",
  noExternal: [/.*/],
  minify: true,
  clean: true,
});
```

`packages/runtime/src/index.ts`:

```ts
import { type SceneHandle, mounts } from "@scenefile/scenes/browser";

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
  totalFrames: number;
  scenes: ManifestScene[];
}

interface Mounted {
  scene: ManifestScene;
  el: HTMLElement;
  handle: SceneHandle;
}

function init(): { seek(frame: number): void; totalFrames: number } {
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

  return {
    totalFrames: manifest.totalFrames,
    seek(frame) {
      for (const { scene, el, handle } of mounted) {
        const local = frame - scene.startFrame;
        const active = local >= 0 && local < scene.durationFrames;
        el.hidden = !active;
        if (active) handle.seek(local);
      }
    },
  };
}

(window as unknown as { __scenefile: ReturnType<typeof init> }).__scenefile = init();
```

- [ ] **Step 2: Create the render package shell, install Chromium, wire the build into tests**

`packages/render/package.json`:

```json
{
  "name": "@scenefile/render",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "dependencies": {
    "@scenefile/engine": "workspace:*",
    "@scenefile/runtime": "workspace:*"
  }
}
```

`packages/render/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/render/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({ entry: ["src/index.ts"], format: ["esm"], dts: true, clean: true });
```

`test/global-setup.ts`:

```ts
import { execSync } from "node:child_process";

/** The render tests load the built browser bundle, and the CLI tests run the built CLI. */
export default function setup(): void {
  execSync("pnpm -r build", { stdio: "inherit" });
}
```

In `vitest.config.ts`, add one line to the `test` block so it reads:

```ts
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
  },
```

Run:

```bash
pnpm --filter @scenefile/render add playwright-core
pnpm install
pnpm --filter @scenefile/render exec playwright-core install chromium --only-shell
pnpm -r build
ls -la packages/runtime/dist/index.global.js
```

Expected: Chromium headless shell downloads (or is already present), the build succeeds for all four packages in dependency order, and `index.global.js` exists. If `--only-shell` is rejected by the installed Playwright version, run `playwright-core install chromium` instead and use that command in the `EnvironmentError` remedy text in Step 5.

- [ ] **Step 3: Write the failing test**

`packages/render/test/render.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Composition, check } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EnvironmentError, captureFrame, openComposition, probeVideo, renderVideo } from "../src/index";

function fixture(): Composition {
  const result = check({
    version: 1,
    format: "square-1080p",
    scenes: [
      { type: "title", heading: "Ship faster", sub: "A CLI", duration: 1.5 },
      { type: "terminal", steps: [{ run: "npx x", output: "ok" }], duration: 2 },
    ],
  });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-render-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runtime bundle", () => {
  it("is small, which proves zod was not bundled into the page", () => {
    const bundle = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
    expect(statSync(bundle).size).toBeLessThan(20_000);
    expect(readFileSync(bundle, "utf8")).toContain("__scenefile");
  });
});

describe("openComposition", () => {
  it("exposes seek and the frame count, and shows exactly one scene per frame", async () => {
    const composition = fixture();
    const session = await openComposition(composition);
    try {
      const total = await session.page.evaluate(
        () => (window as unknown as { __scenefile: { totalFrames: number } }).__scenefile.totalFrames,
      );
      expect(total).toBe(composition.manifest.totalFrames);
      for (const frame of [0, 44, 45, total - 1]) {
        await captureFrame(session.page, frame);
        const visible = await session.page.evaluate(
          () => document.querySelectorAll(".sf-scene:not([hidden])").length,
        );
        expect(visible).toBe(1);
      }
    } finally {
      await session.close();
    }
  });

  it("produces identical pixels for a frame regardless of the frames visited before it", async () => {
    const session = await openComposition(fixture());
    try {
      const frames = [0, 10, 30, 50, 80, 104];
      const sequential: Buffer[] = [];
      for (const frame of frames) sequential.push(await captureFrame(session.page, frame));
      for (const i of [4, 1, 5, 0, 3, 2]) {
        const frame = frames[i];
        const expected = sequential[i];
        if (frame === undefined || !expected) throw new Error("bad index");
        const again = await captureFrame(session.page, frame);
        expect(again.equals(expected), `frame ${frame}`).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it("draws something: an early frame and a mid frame differ", async () => {
    const session = await openComposition(fixture());
    try {
      const blank = await captureFrame(session.page, 0);
      const full = await captureFrame(session.page, 30);
      expect(blank.equals(full)).toBe(false);
    } finally {
      await session.close();
    }
  });
});

describe("renderVideo", () => {
  it("writes an MP4 whose stream matches the composition, creating the output directory", async () => {
    const composition = fixture();
    const output = join(dir, "nested", "deeper", "out.mp4");
    const progress: number[] = [];
    const report = await renderVideo(composition, {
      output,
      quality: "draft",
      onProgress: (done) => progress.push(done),
    });

    expect(existsSync(output)).toBe(true);
    expect(report).toMatchObject({
      output,
      width: 1080,
      height: 1080,
      fps: 30,
      frames: composition.manifest.totalFrames,
    });
    expect(report.durationSeconds).toBeCloseTo(composition.manifest.totalFrames / 30, 1);
    expect(progress.at(-1)).toBe(composition.manifest.totalFrames);

    const probed = await probeVideo(output);
    expect(probed.frames).toBe(composition.manifest.totalFrames);
  });

  it("fails with an EnvironmentError and leaves no file when ffmpeg is missing", async () => {
    const output = join(dir, "missing-ffmpeg.mp4");
    const attempt = renderVideo(fixture(), { output, ffmpegPath: "/nonexistent/ffmpeg" });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toMatchObject({ remedy: expect.stringContaining("ffmpeg") });
    expect(existsSync(output)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run packages/render`
Expected: the global setup build runs, then FAIL, cannot resolve `../src/index`.

- [ ] **Step 5: Implement**

`packages/render/src/errors.ts`:

```ts
/** The machine is missing something scenefile needs. Not a problem with the scenefile. */
export class EnvironmentError extends Error {
  readonly remedy: string;

  constructor(message: string, remedy: string) {
    super(message);
    this.name = "EnvironmentError";
    this.remedy = remedy;
  }
}

export const FFMPEG_REMEDY =
  "Install ffmpeg: `brew install ffmpeg` on macOS, `sudo apt install ffmpeg` on Debian or Ubuntu.";
export const CHROMIUM_REMEDY = "Install the browser: `npx playwright-core install chromium --only-shell`.";
```

`packages/render/src/session.ts`:

```ts
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Composition } from "@scenefile/engine";
import { type Browser, type Page, chromium } from "playwright-core";
import { CHROMIUM_REMEDY, EnvironmentError } from "./errors";

export interface Session {
  page: Page;
  close(): Promise<void>;
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars"],
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (/executable doesn't exist/i.test(reason)) {
      throw new EnvironmentError("Chromium is not installed for scenefile.", CHROMIUM_REMEDY);
    }
    throw cause;
  }
}

/** Loads a composition into a fresh, offline Chromium page with the runtime attached. */
export async function openComposition(composition: Composition): Promise<Session> {
  const bundlePath = createRequire(import.meta.url).resolve("@scenefile/runtime/bundle");
  const runtime = await readFile(bundlePath, "utf8");
  const browser = await launch();
  try {
    const { width, height } = composition.manifest;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Rendering is offline by design: it keeps output reproducible and custom content contained.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(composition.html, { waitUntil: "load" });
    await page.addScriptTag({ content: runtime });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const ready = await page.evaluate(() => "__scenefile" in window);
    if (!ready) throw new Error("The scenefile runtime did not start in the page.");
    return { page, close: () => browser.close() };
  } catch (cause) {
    await browser.close();
    throw cause;
  }
}
```

`packages/render/src/capture.ts`:

```ts
import type { Page } from "playwright-core";

/** Moves the page to `frame` and returns it as PNG bytes. */
export async function captureFrame(page: Page, frame: number): Promise<Buffer> {
  await page.evaluate((target) => {
    (window as unknown as { __scenefile: { seek(frame: number): void } }).__scenefile.seek(target);
  }, frame);
  return page.screenshot({ type: "png" });
}
```

`packages/render/src/encode.ts`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { EnvironmentError, FFMPEG_REMEDY } from "./errors";

export interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
}

/** Starts ffmpeg reading PNG frames on stdin and writing H.264 to `output`. */
export function startEncoder(options: { output: string; fps: number; crf: number; ffmpegPath?: string }): Encoder {
  const child = spawn(
    options.ffmpegPath ?? "ffmpeg",
    [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(options.fps), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(options.crf),
      "-movflags", "+faststart",
      options.output,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2000);
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", (cause: NodeJS.ErrnoException) => {
      reject(cause.code === "ENOENT" ? new EnvironmentError("ffmpeg was not found.", FFMPEG_REMEDY) : cause);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
  // Remember a failure so the next write() reports it instead of feeding a dead process.
  let failure: unknown;
  exited.catch((cause: unknown) => {
    failure = cause;
  });
  // A broken pipe is reported through `exited` with ffmpeg's own message.
  child.stdin.on("error", () => undefined);

  return {
    async write(frame) {
      if (failure !== undefined) throw failure;
      if (!child.stdin.write(frame)) await Promise.race([once(child.stdin, "drain"), exited]);
    },
    async finish() {
      child.stdin.end();
      await exited;
    },
  };
}
```

`packages/render/src/probe.ts`:

```ts
import { execFile } from "node:child_process";
import { EnvironmentError, FFMPEG_REMEDY } from "./errors";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
}

interface ProbeJson {
  streams?: { width?: number; height?: number; r_frame_rate?: string; nb_frames?: string }[];
  format?: { duration?: string };
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (cause, stdout) => {
      if (!cause) resolve(stdout);
      else if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new EnvironmentError("ffprobe was not found.", FFMPEG_REMEDY));
      } else reject(cause);
    });
  });
}

/** Reads back what was actually written, so a render is verified rather than assumed. */
export async function probeVideo(file: string, ffprobePath = "ffprobe"): Promise<ProbeResult> {
  const stdout = await run(ffprobePath, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration",
    "-of", "json", file,
  ]);
  const json = JSON.parse(stdout) as ProbeJson;
  const stream = json.streams?.[0];
  const [numerator, denominator] = (stream?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: stream?.width ?? 0,
    height: stream?.height ?? 0,
    fps: (numerator ?? 0) / (denominator || 1),
    frames: Number(stream?.nb_frames ?? 0),
    durationSeconds: Number(json.format?.duration ?? 0),
  };
}
```

`packages/render/src/render.ts`:

```ts
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { startEncoder } from "./encode";
import { probeVideo } from "./probe";
import { openComposition } from "./session";

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

const CRF: Record<Quality, number> = { draft: 28, standard: 20, high: 16 };

export interface RenderOptions {
  output: string;
  quality?: Quality;
  ffmpegPath?: string;
  ffprobePath?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderReport {
  output: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSeconds: number;
  elapsedMs: number;
}

/** Renders every frame of a composition to an MP4 and verifies the result with ffprobe. */
export async function renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport> {
  const started = Date.now();
  const output = resolvePath(options.output);
  const { fps, totalFrames, width, height } = composition.manifest;
  await mkdir(dirname(output), { recursive: true });

  const session = await openComposition(composition);
  try {
    const encoder = startEncoder({
      output,
      fps,
      crf: CRF[options.quality ?? "standard"],
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
    });
    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        await encoder.write(await captureFrame(session.page, frame));
        options.onProgress?.(frame + 1, totalFrames);
      }
      await encoder.finish();
    } catch (cause) {
      await encoder.finish().catch(() => undefined);
      await rm(output, { force: true });
      throw cause;
    }
  } finally {
    await session.close();
  }

  const probed = await probeVideo(output, options.ffprobePath);
  if (probed.width !== width || probed.height !== height || probed.frames !== totalFrames) {
    throw new Error(
      `Rendered file does not match the composition: expected ${width}x${height} with ${totalFrames} frames, ` +
        `got ${probed.width}x${probed.height} with ${probed.frames}. Please report this at the scenefile issue tracker.`,
    );
  }

  return {
    output,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    frames: probed.frames,
    durationSeconds: probed.durationSeconds,
    elapsedMs: Date.now() - started,
  };
}
```

`packages/render/src/index.ts`:

```ts
export { captureFrame } from "./capture";
export { type Encoder, startEncoder } from "./encode";
export { EnvironmentError } from "./errors";
export { type ProbeResult, probeVideo } from "./probe";
export { QUALITIES, type Quality, type RenderOptions, type RenderReport, renderVideo } from "./render";
export { type Session, openComposition } from "./session";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run packages/render`
Expected: PASS, 6 tests. The fixture is 45 + 60 = 105 frames; the render test should take a few seconds.

If the pixel-identity test fails, a mount is not pure. Find which scene by rendering each alone; do not loosen the comparison.

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: PASS for `scenes`, `schema`, `engine`, `render`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(render): browser runtime, frame capture, and ffmpeg encode with verification"
```

---

### Task 7: `scenefile` CLI — `check` and `render`

**Files:**
- Create: `packages/cli/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/run.ts`, `src/main.ts`
- Create: `examples/launch.json`, `README.md`
- Test: `packages/cli/test/run.test.ts`, `packages/cli/test/cli.e2e.test.ts`

**Interfaces:**
- Consumes: `parseScenefileText`, `Diagnostic`, `hasErrors` from `@scenefile/schema`; `check`, `CheckResult` from `@scenefile/engine`; `renderVideo`, `EnvironmentError`, `QUALITIES`, `Quality`, `RenderOptions`, `RenderReport` from `@scenefile/render`
- Produces:
  - `interface Io { out(text: string): void; err(text: string): void; render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport> }` (`render` is a seam for tests; it defaults to `renderVideo`)
  - `run(argv: readonly string[], io: Io): Promise<0 | 1 | 2>`
  - Binary `scenefile` with commands `check <file> [--json]` and `render <file> -o <out.mp4> [--quality draft|standard|high] [--json]`

- [ ] **Step 1: Create the package shell**

`packages/cli/package.json`:

```json
{
  "name": "scenefile",
  "version": "0.0.0",
  "description": "Turn a JSON scenefile into a professional video. Built for language models.",
  "type": "module",
  "license": "MIT",
  "bin": { "scenefile": "./dist/main.js" },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "dependencies": {
    "@scenefile/engine": "workspace:*",
    "@scenefile/render": "workspace:*",
    "@scenefile/schema": "workspace:*"
  }
}
```

`packages/cli/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/cli/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({ entry: ["src/main.ts"], format: ["esm"], clean: true });
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

`packages/cli/test/run.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvironmentError, type RenderReport } from "@scenefile/render";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Io, run } from "../src/run";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-cli-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function capture(render?: Io["render"]): { io: Io; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text), ...(render ? { render } : {}) },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  };
}

const valid = JSON.stringify({
  version: 1,
  scenes: [{ type: "title", heading: "Ship faster" }, { type: "terminal", steps: [{ run: "npx x" }] }],
});

const report: RenderReport = {
  output: "/tmp/out.mp4", width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1234,
};

describe("scenefile check", () => {
  it("prints the storyboard and exits 0 for a valid scenefile", async () => {
    const c = capture();
    expect(await run(["check", file("ok.json", valid)], c.io)).toBe(0);
    expect(c.out()).toContain("1. title");
    expect(c.out()).toContain("No problems found.");
  });

  it("prints each diagnostic with its path and fix, and exits 1", async () => {
    const c = capture();
    const path = file("bad.json", JSON.stringify({ version: 1, scenes: [{ type: "titel", heading: "x" }] }));
    expect(await run(["check", path], c.io)).toBe(1);
    expect(c.out()).toContain("error  SCHEMA_UNKNOWN_SCENE  scenes[0].type");
    expect(c.out()).toContain('Did you mean "title"?');
    expect(c.out()).toContain("fix: ");
    expect(c.out()).toContain("1 error, 0 warnings");
  });

  it("emits machine-readable JSON with --json", async () => {
    const c = capture();
    expect(await run(["check", file("ok2.json", valid), "--json"], c.io)).toBe(0);
    const parsed = JSON.parse(c.out()) as { ok: boolean; diagnostics: unknown[]; storyboard: string; scenefile: { fps: number } };
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.scenefile.fps).toBe(30);
    expect(parsed.storyboard).toContain("2. terminal");
    expect(parsed).not.toHaveProperty("composition");
  });

  it("accepts JSON wrapped in a code fence, with a warning", async () => {
    const c = capture();
    expect(await run(["check", file("fenced.json", `\`\`\`json\n${valid}\n\`\`\``)], c.io)).toBe(0);
    expect(c.out()).toContain("warning  AUTOFIXED");
  });

  it.each([
    ["empty.json", ""],
    ["prose.json", "Sure! Here is your video."],
  ])("reports %s as a diagnostic, not a stack trace", async (name, contents) => {
    const c = capture();
    expect(await run(["check", file(name, contents)], c.io)).toBe(1);
    expect(c.out()).toContain("SCHEMA_JSON");
    expect(c.out() + c.err()).not.toMatch(/\bat .+:\d+:\d+/);
  });

  it("reports a missing file as a diagnostic", async () => {
    const c = capture();
    expect(await run(["check", join(dir, "nope.json")], c.io)).toBe(1);
    expect(c.out()).toContain("SCHEMA_FILE");
  });
});

describe("scenefile render", () => {
  it("renders through the pipeline and reports the result", async () => {
    const calls: { output: string; quality: string | undefined }[] = [];
    const c = capture(async (_composition, options) => {
      calls.push({ output: options.output, quality: options.quality });
      return report;
    });
    expect(await run(["render", file("r.json", valid), "-o", "out/video.mp4", "--quality", "high"], c.io)).toBe(0);
    expect(calls).toEqual([{ output: "out/video.mp4", quality: "high" }]);
    expect(c.out()).toContain("/tmp/out.mp4");
    expect(c.out()).toContain("5.00s");
  });

  it("does not render when the scenefile has errors", async () => {
    let called = false;
    const c = capture(async () => {
      called = true;
      return report;
    });
    const path = file("bad2.json", JSON.stringify({ version: 1, scenes: [] }));
    expect(await run(["render", path, "-o", "x.mp4"], c.io)).toBe(1);
    expect(called).toBe(false);
  });

  it("exits 2 with the remedy when the environment is missing something", async () => {
    const c = capture(async () => {
      throw new EnvironmentError("ffmpeg was not found.", "Install ffmpeg: brew install ffmpeg");
    });
    expect(await run(["render", file("r2.json", valid), "-o", "x.mp4"], c.io)).toBe(2);
    expect(c.err()).toContain("ffmpeg was not found.");
    expect(c.err()).toContain("brew install ffmpeg");
  });

  it("requires an output path and a known quality", async () => {
    const a = capture();
    expect(await run(["render", file("r3.json", valid)], a.io)).toBe(2);
    expect(a.err()).toContain("-o");
    const b = capture();
    expect(await run(["render", file("r4.json", valid), "-o", "x.mp4", "--quality", "ultra"], b.io)).toBe(2);
    expect(b.err()).toContain("draft, standard, high");
  });
});

describe("scenefile usage", () => {
  it("prints help and exits 0", async () => {
    const c = capture();
    expect(await run(["--help"], c.io)).toBe(0);
    expect(c.out()).toContain("scenefile check <file>");
  });

  it.each([[[]], [["frobnicate"]], [["check"]], [["check", "a.json", "--bogus"]]])(
    "exits 2 with usage for %j",
    async (argv) => {
      const c = capture();
      expect(await run(argv, c.io)).toBe(2);
      expect(c.err()).toContain("Usage:");
    },
  );
});
```

`packages/cli/test/cli.e2e.test.ts`:

```ts
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeVideo } from "@scenefile/render";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function scenefile(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (error, stdout, stderr) => {
      resolve({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-e2e-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("built CLI", () => {
  it("renders a scenefile to a playable MP4", async () => {
    const input = join(dir, "video.json");
    const output = join(dir, "video.mp4");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        format: "square-1080p",
        scenes: [
          { type: "title", heading: "Hello", duration: 1.5 },
          { type: "terminal", steps: [{ run: "echo hi", output: "hi" }], duration: 2 },
        ],
      }),
    );

    const result = await scenefile(["render", input, "-o", output, "--quality", "draft"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(await probeVideo(output)).toMatchObject({ width: 1080, height: 1080, frames: 105 });
  });

  it("exits 1 and prints diagnostics for a broken scenefile", async () => {
    const input = join(dir, "broken.json");
    writeFileSync(input, "{ not json");
    const result = await scenefile(["check", input]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("SCHEMA_JSON");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/cli`
Expected: FAIL, cannot resolve `../src/run`; the e2e file fails because `dist/main.js` does not exist.

- [ ] **Step 4: Implement**

`packages/cli/src/run.ts`:

```ts
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type CheckResult, type Composition, check } from "@scenefile/engine";
import {
  EnvironmentError,
  QUALITIES,
  type Quality,
  type RenderOptions,
  type RenderReport,
  renderVideo,
} from "@scenefile/render";
import { type Diagnostic, error, parseScenefileText } from "@scenefile/schema";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** Test seam. Defaults to the real renderer. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
}

type ExitCode = 0 | 1 | 2;

const USAGE = `Usage:
  scenefile check <file> [--json]
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--json]

Exit codes: 0 success, 1 the scenefile has errors, 2 usage or environment problem.`;

class UsageError extends Error {}

function isQuality(value: string): value is Quality {
  return (QUALITIES as readonly string[]).includes(value);
}

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

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const lines = diagnostics.flatMap((d) => [
    `${d.severity}  ${d.code}${d.path ? `  ${d.path}` : ""}`,
    `  ${d.message}`,
    `  fix: ${d.fix}`,
  ]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  lines.push(`${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return lines.join("\n");
}

function report(result: CheckResult, json: boolean, io: Io, extra: Record<string, unknown> = {}): void {
  if (json) {
    const { ok, diagnostics, scenefile, storyboard } = result;
    io.out(JSON.stringify({ ok, diagnostics, scenefile, storyboard, ...extra }, null, 2));
    return;
  }
  if (result.storyboard) io.out(result.storyboard);
  io.out(result.diagnostics.length > 0 ? formatDiagnostics(result.diagnostics) : "No problems found.");
}

export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  try {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(argv);
    } catch (cause) {
      throw new UsageError(cause instanceof Error ? cause.message : String(cause));
    }
    const { values, positionals } = parsed;

    if (values.help) {
      io.out(USAGE);
      return 0;
    }

    const [command, file] = positionals;
    if (command !== "check" && command !== "render") throw new UsageError("Expected a command: check or render.");
    if (!file) throw new UsageError(`"${command}" needs a scenefile path.`);

    if (command === "check") {
      const result = await load(file);
      report(result, values.json, io);
      return result.ok ? 0 : 1;
    }

    if (!values.output) throw new UsageError('"render" needs an output path: -o out.mp4');
    if (!isQuality(values.quality)) {
      throw new UsageError(`Unknown quality "${values.quality}". Use one of: ${QUALITIES.join(", ")}.`);
    }

    const result = await load(file);
    if (!result.ok || !result.composition) {
      report(result, values.json, io);
      return 1;
    }
    const rendered = await (io.render ?? renderVideo)(result.composition, {
      output: values.output,
      quality: values.quality,
    });
    report(result, values.json, io, { render: rendered });
    if (!values.json) {
      io.out(
        `Rendered ${rendered.output}: ${rendered.width}x${rendered.height}, ${rendered.fps} fps, ` +
          `${rendered.durationSeconds.toFixed(2)}s, in ${(rendered.elapsedMs / 1000).toFixed(1)}s.`,
      );
    }
    return 0;
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.err(`${cause.message}\n\n${USAGE}`);
      return 2;
    }
    if (cause instanceof EnvironmentError) {
      io.err(`${cause.message}\n${cause.remedy}`);
      return 2;
    }
    throw cause;
  }
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      quality: { type: "string", default: "standard" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}
```

`packages/cli/src/main.ts`:

```ts
#!/usr/bin/env node
import { run } from "./run";

run(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    console.error("scenefile hit an internal error. This is a bug in scenefile, not in your scenefile:");
    console.error(cause);
    process.exitCode = 70;
  },
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/cli`
Expected: PASS, both files (the global setup builds the CLI first).

If the empty-argv usage case fails because `parseArgs` treats `[]` differently, the fix belongs in `run` (the `command` check already covers it); do not special-case the test.

- [ ] **Step 6: Add the example and the README**

`examples/launch.json`:

```json
{
  "version": 1,
  "scenes": [
    { "type": "title", "heading": "Video from JSON", "sub": "Any model can write a scenefile." },
    {
      "type": "terminal",
      "steps": [
        { "run": "scenefile check launch.json", "output": "No problems found." },
        { "run": "scenefile render launch.json -o launch.mp4", "output": "Rendered launch.mp4" }
      ]
    },
    { "type": "title", "heading": "No keyframes. No pixels.", "sub": "Describe the scenes. The engine does the rest." }
  ]
}
```

`README.md`:

````markdown
# scenefile

Turn a small JSON file into a video. Built so that any language model, including
ones that cannot see images, can produce a correct video and fix its own mistakes.

**Status: early development.** Two scene types (`title`, `terminal`) and one theme
work today. Not yet published to npm.

## Requirements

- Node 20 or newer, pnpm
- `ffmpeg` on your `PATH`

## Try it

```bash
pnpm install
pnpm --filter @scenefile/render exec playwright-core install chromium --only-shell
pnpm build
node packages/cli/dist/main.js check examples/launch.json
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
```

## A scenefile

```json
{
  "version": 1,
  "scenes": [
    { "type": "title", "heading": "Ship faster", "sub": "A CLI for X" },
    { "type": "terminal", "steps": [{ "run": "npx x init", "output": "Done in 2s" }] }
  ]
}
```

Durations are worked out from how long the text takes to read. `check` reports
problems as text, each with the path of the field and how to fix it:

```
error  SCHEMA_UNKNOWN_SCENE  scenes[0].type
  Unknown scene type "titel". Did you mean "title"?
  fix: "type" must be one of: title, terminal.
```

## Development

```bash
pnpm test        # builds, then runs every test, including real renders
pnpm typecheck
```

## License

MIT
````

- [ ] **Step 7: Verify end to end, by eye**

Run:

```bash
pnpm test
pnpm typecheck
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
mkdir -p out/frames && ffmpeg -y -loglevel error -i out/launch.mp4 -vf fps=2 out/frames/%03d.png
```

Expected: all tests pass, typecheck is clean, the render prints a `Rendered …` line, and `out/frames/` holds two PNGs per second of video.

Then open the frames and look at them. Passing tests do not show that the video looks right. Check, and fix what fails before committing:
- Text is fully inside the frame with comfortable margins; nothing is clipped or overlapping.
- The heading and sub line are clearly different sizes and the sub line is legible.
- The terminal window is centered, its text is readable, the caret sits on the line being typed.
- Mid-typing frames show partial commands; later frames show output.
- The first and last frames of each scene are faded, not popped.
- Greys are neutral; the accent is the only color.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(cli): check and render commands, example scenefile, README"
```

---

## What Plan 1 leaves for later

Tracked so nothing is silently dropped from the spec:

| Spec item | Plan |
|---|---|
| Scene types `statement`, `bullets`, `code`, `screenshot`, `stat`, `quote`, `compare`, `outro`, `custom` | 2 |
| Themes `paper`, `terminal`, `signal`; bundled fonts; `GLYPH_MISSING` | 2 |
| Browser `inspect`: text fitting, `TEXT_OVERFLOW`, `SAFE_AREA`; font sizes and line breaks in the storyboard | 2 |
| `ASSET_NOT_FOUND`, `ASSET_LOW_RES`, `CONTRAST_LOW`, `CODE_TOO_LONG`; asset fetch and cache | 2 |
| Transitions between scenes; camera drift | 2 |
| Audio mux; parallel workers; `blackdetect`; measured performance numbers | 2 |
| Golden frames in Docker; Docker image | 2 |
| Nested field aliases and suggestions (e.g. inside terminal `steps`) | 2 |
| MCP server; `preview`, `doctor`, `init`, `scenes`, `themes`, `schema`, `guide` | 3 |
| Generated `SKILL.md`, `AGENTS.md`, `llms.txt` | 3 |
| Output-path confinement for the MCP server | 3 |
| CI, Changesets, `CONTRIBUTING.md`, `CHANGELOG.md`, real issue URL | 3 |
| Live pass with a non-Claude model; owner's visual acceptance of all scenes | 3 |
