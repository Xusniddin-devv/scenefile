# scenefile Plan 2c-1 — Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scenes flow into one another: push, wipe, zoom and crossfade transitions chosen automatically from the kinds of scene involved, a scene counter that stays in place while scenes change under it, and motion timed in seconds so 60 fps looks like 30 fps.

**Architecture:** The engine picks a transition into every scene after the first and lets overlapping kinds share frames: the next scene starts before the previous one ends. The runtime draws both scenes during the shared frames and styles the two `<section>` elements as a pure function of how far through the transition the frame is. The scene counter leaves the scenes and becomes one element above them.

**Tech Stack:** As before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md` (§5, Transitions and Choreography)

## Where this plan sits

- **2c-1 (this plan):** transitions, persistent counter, seconds-based stagger.
- **2c-2:** music bed, parallel rendering, measured performance.
- **2c-3:** frame-exact regression tests in Docker, themes `paper` and `terminal`.

### Deviations from the spec, deliberate

- **`transition` belongs to the scene it leads into**, and a top-level `transition` sets the default for all. The spec's example shows only the top-level form.
- **Six kinds:** `cut`, `fade`, `crossfade`, `push`, `wipe`, `zoom`. The spec's "zoom-through" is `zoom`. `fade` is what every scene change did until now: out to black, then in.
- **No camera drift on text scenes.** The spec asks that no frame be static. Screenshots already move; text scenes animate their own content, and a drift on large type costs sharpness. Left out unless the owner asks for it.

## Global Constraints

All earlier constraints apply. In addition:

- A transition's appearance is a function of the frame alone. Styles a transition sets on a scene are cleared on every seek before being set again.
- Overlapping transitions last 0.5 s. The first scene has no transition.
- The automatic choice never uses the same transition twice in a row.
- The scene counter is one element for the whole video and does not move during transitions.
- Animation timing is expressed in seconds and converted with the video's frame rate.
- No `Co-Authored-By` trailer on commits.
- After any scene or CSS change, run the reproducibility tests.

## Review Focus

1. **Transitions between every pair of scene types, at 30 and 60 fps, in all formats.** Expected: both scenes drawn during the overlap, nothing left transformed afterwards. Task 2.
2. **Seeking into the middle of a transition from anywhere.** Expected: identical pixels (the reproducibility tests now include transitions). Task 2.
3. **Very short scenes** (shorter than the overlap). Expected: the overlap shrinks; no negative start, no scene skipped. Task 1.
4. **A scene with typed or counted content pushed out before it finishes.** Expected: cannot happen; reveal time is still honoured. Task 1.
5. **Explicit `transition` values on the first scene, or unknown values.** Expected: ignored on the first scene; a diagnostic for unknown values. Task 1.

## How edits are written in this plan

Whole files under their path, edit blocks (`FILE` / `<<<<` / `====` / `>>>>`) whose old text occurs exactly once, and, for the same change repeated across every scene type, a script to run once.

---

### Task 1: Choosing transitions and laying out the timeline

**Files:**
- Create: `packages/engine/src/transitions.ts`, `packages/engine/test/transitions.test.ts`
- Modify: `packages/scenes/src/common.ts`, every `packages/scenes/src/*/schema.ts`, `packages/scenes/src/index.ts`, `packages/schema/src/scenefile.ts`, `packages/engine/src/resolve.ts`, `packages/engine/src/compile.ts`, `packages/engine/src/check.ts`, `packages/engine/src/index.ts`, and tests that pin timings

**Interfaces:**
- Produces:
  - `TRANSITIONS = ["cut", "fade", "crossfade", "push", "wipe", "zoom"]`, `type TransitionKind`, `transitionSchema` (those six or `"auto"`)
  - Every scene and the scenefile itself gain `transition`, default `"auto"`
  - `TRANSITION_SECONDS = 0.5`, `isOverlapping(kind): boolean`, `pickTransitions(scenefile): (TransitionKind | "none")[]`
  - `ResolvedScene` and `ManifestScene` gain `transition: TransitionKind | "none"` and `overlapFrames: number` (frames this scene shares with the one before it)
  - Storyboard lines for scenes after the first end with `  (enters by <kind>)`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/transitions.test.ts`:

```ts
import { normalize } from "@scenefile/schema";
import { describe, expect, it } from "vitest";
import { check } from "../src/check";
import { resolve } from "../src/resolve";
import { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "../src/transitions";

const title = (heading: string, more: Record<string, unknown> = {}) => ({ type: "title", heading, ...more });
const statement = (text: string, more: Record<string, unknown> = {}) => ({ type: "statement", text, ...more });
const code = { type: "code", source: "x = 1" };
const stat = { type: "stat", value: "94%", label: "valid" };

function scenefile(input: Record<string, unknown>) {
  const { scenefile: parsed, diagnostics } = normalize({ version: 1, ...input });
  if (!parsed) throw new Error(JSON.stringify(diagnostics));
  return parsed;
}

describe("pickTransitions", () => {
  it("gives the first scene none, and every later scene a kind that suits it", () => {
    const picked = pickTransitions(scenefile({ scenes: [title("a"), statement("b"), code, stat, title("c")] }));
    expect(picked[0]).toBe("none");
    expect(picked.slice(1)).toEqual(["push", "wipe", "zoom", "fade"]);
  });

  it("never picks the same kind twice in a row", () => {
    const scenes = [title("a"), code, { type: "terminal", steps: [{ run: "ls" }] }, code, code, code];
    const picked = pickTransitions(scenefile({ scenes }));
    for (let i = 2; i < picked.length; i++) expect(picked[i], `scene ${i}`).not.toBe(picked[i - 1]);
  });

  it("pushes between two scenes of the same type", () => {
    expect(pickTransitions(scenefile({ scenes: [stat, stat] }))[1]).toBe("push");
  });

  it("uses the scenefile's transition for every scene, and a scene's own over that", () => {
    const all = pickTransitions(scenefile({ transition: "crossfade", scenes: [title("a"), code, stat] }));
    expect(all).toEqual(["none", "crossfade", "crossfade"]);
    const mixed = pickTransitions(scenefile({ transition: "cut", scenes: [title("a"), { ...code, transition: "wipe" }, stat] }));
    expect(mixed).toEqual(["none", "wipe", "cut"]);
  });

  it("ignores a transition asked of the first scene", () => {
    expect(pickTransitions(scenefile({ scenes: [title("a", { transition: "push" }), code] }))[0]).toBe("none");
  });

  it("knows which kinds draw both scenes at once", () => {
    expect(["crossfade", "push", "wipe", "zoom"].every((kind) => isOverlapping(kind as never))).toBe(true);
    expect(isOverlapping("cut")).toBe(false);
    expect(isOverlapping("fade")).toBe(false);
  });

  it("rejects an unknown transition with the allowed ones", () => {
    const { diagnostics } = normalize({ version: 1, scenes: [title("a"), title("b", { transition: "spin" })] });
    expect(diagnostics[0]).toMatchObject({ code: "SCHEMA_INVALID", path: "scenes[1].transition" });
    expect(diagnostics[0]?.fix).toContain('"push"');
  });
});

describe("the timeline with transitions", () => {
  const overlap = Math.round(TRANSITION_SECONDS * 30);
  const frames = (input: Record<string, unknown>) =>
    resolve(scenefile(input)).video.scenes.map((s) => [s.startFrame, s.durationFrames, s.exitFrames, s.transition, s.overlapFrames]);

  it("with fade, scenes follow one another and each fades out", () => {
    // Two titles of 2.5 s: 75 frames each, exit 12.
    expect(frames({ transition: "fade", scenes: [title("Hi"), title("Yo")] })).toEqual([
      [0, 75, 12, "none", 0],
      [75, 75, 12, "fade", 0],
    ]);
  });

  it("with cut, scenes follow one another and the earlier one does not fade", () => {
    expect(frames({ transition: "cut", scenes: [title("Hi"), title("Yo")] })).toEqual([
      [0, 75, 0, "none", 0],
      [75, 75, 12, "cut", 0],
    ]);
  });

  it("with an overlapping kind, the later scene starts before the earlier one ends", () => {
    const result = resolve(scenefile({ transition: "push", scenes: [title("Hi"), title("Yo"), title("Ok")] }));
    expect(result.video.scenes.map((s) => [s.startFrame, s.durationFrames, s.exitFrames, s.overlapFrames])).toEqual([
      [0, 75, 0, 0],
      [75 - overlap, 75, 0, overlap],
      [150 - 2 * overlap, 75, 12, overlap],
    ]);
    expect(result.video.totalFrames).toBe(225 - 2 * overlap);
  });

  it("scales the overlap with the frame rate", () => {
    const at60 = resolve(scenefile({ fps: 60, transition: "push", scenes: [title("Hi"), title("Yo")] })).video.scenes;
    expect(at60[1]?.overlapFrames).toBe(30);
  });

  it("shrinks the overlap for very short scenes, never starting a scene before the one ahead of it", () => {
    const result = resolve(
      scenefile({ transition: "push", scenes: [title("Hi", { duration: 1.1 }), title("Yo", { duration: 1.1 }), title("Ok", { duration: 3 })] }),
    );
    const scenes = result.video.scenes;
    for (let i = 1; i < scenes.length; i++) {
      const before = scenes[i - 1];
      const scene = scenes[i];
      if (!before || !scene) throw new Error("missing scene");
      expect(scene.startFrame).toBeGreaterThan(before.startFrame);
      expect(scene.overlapFrames).toBeLessThan(before.durationFrames);
      expect(scene.overlapFrames).toBeLessThan(scene.durationFrames);
      expect(scene.startFrame).toBe(before.startFrame + before.durationFrames - scene.overlapFrames);
    }
  });

  it("does not let a transition begin before the earlier scene's content has finished appearing", () => {
    // A stat needs 0.5 s to enter and 0.9 s to count.
    const scenes = resolve(scenefile({ transition: "push", scenes: [{ ...stat, duration: 1.5 }, title("Yo", { duration: 3 })] })).video.scenes;
    const [first, second] = scenes;
    if (!first || !second) throw new Error("missing scene");
    const countedBy = first.enterFrames + Math.ceil(0.9 * 30);
    expect(second.startFrame).toBeGreaterThanOrEqual(countedBy);
  });

  it("puts each scene's transition in the manifest and the storyboard", () => {
    const result = check({ version: 1, scenes: [title("one two three four five six"), statement("seven eight nine ten")] });
    expect(result.composition?.manifest.scenes.map((s) => [s.transition, s.overlapFrames])).toEqual([["none", 0], ["push", overlap]]);
    const lines = result.storyboard.split("\n");
    expect(lines[1]).not.toContain("enters by");
    expect(lines[2]).toMatch(/^2\. statement .*\(enters by push\)$/);
  });
});
```

Tests that pin timings keep their arithmetic by asking for `fade`, which is what they were written against:

```text
FILE packages/engine/test/resolve.test.ts
<<<<
function resolved(input: unknown) {
  const { scenefile, diagnostics } = normalize(input);
====
function resolved(input: Record<string, unknown>) {
  // These tests are about durations; "fade" keeps scenes end to end, as they were when written.
  const { scenefile, diagnostics } = normalize({ transition: "fade", ...input });
>>>>
```

```text
FILE packages/engine/test/check.test.ts
<<<<
    const result = check({
      version: 1,
      scenes: [
        { type: "title", heading: "Ship faster", sub: "A CLI for X" },
====
    const result = check({
      version: 1,
      transition: "fade",
      scenes: [
        { type: "title", heading: "Ship faster", sub: "A CLI for X" },
>>>>
```

```text
FILE packages/engine/test/check.test.ts
<<<<
      "2. terminal  3.00s-6.70s  $ npx x init",
====
      "2. terminal  3.00s-6.70s  $ npx x init  (enters by fade)",
>>>>
```

```text
FILE packages/engine/test/layout.test.ts
<<<<
const valid = {
  version: 1,
====
const valid = {
  version: 1,
  transition: "fade",
>>>>
```

```text
FILE packages/engine/test/layout.test.ts
<<<<
      "2. terminal  3.00s-5.40s  $ npx x init",
====
      "2. terminal  3.00s-5.40s  $ npx x init  (enters by fade)",
>>>>
```

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
    const fields = getScene(type).fields.filter((field) => field !== "type" && field !== "duration");
====
    const fields = getScene(type).fields.filter((field) => !["type", "duration", "transition"].includes(field));
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/transitions.test.ts`
Expected: FAIL, cannot resolve `../src/transitions`.

- [ ] **Step 3: Implement**

```text
FILE packages/scenes/src/common.ts
<<<<
export type Duration = z.infer<typeof durationSchema>;
====
export type Duration = z.infer<typeof durationSchema>;

/** The ways one scene can give way to the next. */
export const TRANSITIONS = ["cut", "fade", "crossfade", "push", "wipe", "zoom"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

/** How a scene arrives. "auto" lets the engine choose from the kinds of scene involved. */
export const transitionSchema = z.enum(["auto", ...TRANSITIONS]);
>>>>
```

Every scene schema gains the field. Run once:

```bash
python3 - <<'EOF'
import glob
for path in sorted(glob.glob("packages/scenes/src/*/schema.ts")):
    source = open(path).read()
    line = '    duration: durationSchema.default("auto"),\n' if '    duration: durationSchema.default("auto"),\n' in source else '  duration: durationSchema.default("auto"),\n'
    assert source.count(line) == 1, path
    indent = line[: len(line) - len(line.lstrip())]
    source = source.replace(line, line + f'{indent}/** How this scene arrives from the one before it. */\n{indent}transition: transitionSchema.default("auto"),\n')
    old = 'import { durationSchema } from "../common";'
    assert source.count(old) == 1, path
    source = source.replace(old, 'import { durationSchema, transitionSchema } from "../common";')
    open(path, "w").write(source)
    print("edited", path)
EOF
```

Expected: ten files edited.

```text
FILE packages/scenes/src/index.ts
<<<<
export { durationSchema, type Duration } from "./common";
====
export { TRANSITIONS, type TransitionKind, durationSchema, type Duration, transitionSchema } from "./common";
>>>>
```

```text
FILE packages/schema/src/scenefile.ts
<<<<
import { sceneSchema } from "@scenefile/scenes";
====
import { sceneSchema, transitionSchema } from "@scenefile/scenes";
>>>>
```

```text
FILE packages/schema/src/scenefile.ts
<<<<
  scenes: z.array(sceneSchema).min(1).max(60),
====
  /** How scenes give way to one another, unless a scene says otherwise. */
  transition: transitionSchema.default("auto"),
  scenes: z.array(sceneSchema).min(1).max(60),
>>>>
```

`packages/engine/src/transitions.ts`:

```ts
import type { Scenefile } from "@scenefile/schema";
import type { SceneType, TransitionKind } from "@scenefile/scenes";

/** How long two scenes share the frame in an overlapping transition. */
export const TRANSITION_SECONDS = 0.5;

const OVERLAPPING: ReadonlySet<TransitionKind> = new Set(["crossfade", "push", "wipe", "zoom"]);

/** True for kinds that draw the old and the new scene at the same time. */
export function isOverlapping(kind: TransitionKind | "none"): boolean {
  return kind !== "none" && OVERLAPPING.has(kind);
}

/**
 * What suits arriving at each kind of scene, best first. Openers and closers
 * arrive out of black; dense scenes are wiped open; a single figure is zoomed
 * to; lists and sentences are pushed in like the next page.
 */
const PREFERRED: Record<SceneType, readonly TransitionKind[]> = {
  title: ["fade", "zoom"],
  outro: ["fade", "crossfade"],
  statement: ["push", "crossfade"],
  quote: ["crossfade", "push"],
  bullets: ["push", "wipe"],
  stat: ["zoom", "crossfade"],
  code: ["wipe", "push"],
  terminal: ["wipe", "push"],
  screenshot: ["zoom", "wipe"],
  compare: ["push", "crossfade"],
};

/**
 * The transition into each scene; "none" for the first. A scene's own
 * `transition` wins, then the scenefile's; with both on "auto" the choice
 * comes from the scene being arrived at, with two rules: two scenes of the
 * same type are pushed, like pages, and no kind is chosen twice running.
 */
export function pickTransitions(scenefile: Scenefile): (TransitionKind | "none")[] {
  let previous: TransitionKind | "none" = "none";
  return scenefile.scenes.map((scene, index) => {
    if (index === 0) return "none";
    const asked = scene.transition !== "auto" ? scene.transition : scenefile.transition;
    let kind: TransitionKind;
    if (asked !== "auto") {
      kind = asked;
    } else {
      const sameType = scenefile.scenes[index - 1]?.type === scene.type;
      const options: readonly TransitionKind[] = sameType ? ["push", ...PREFERRED[scene.type]] : PREFERRED[scene.type];
      kind = options.find((option) => option !== previous) ?? "crossfade";
    }
    previous = kind;
    return kind;
  });
}
```

In `packages/engine/src/resolve.ts`, scenes are now placed with a loop, so a scene can adjust the one before it. Replace the `scenes` computation (from `const scenes = scenefile.scenes.map((props, index): ResolvedScene => {` through the `});` that closes it) with a loop that keeps the body's duration logic unchanged and ends each iteration with:

```ts
    const transition = transitions[index] ?? "none";
    const before = scenes[index - 1];
    let overlapFrames = 0;
    if (before && transition !== "fade") {
      // Anything but a fade leaves the earlier scene fully drawn to its last frame.
      before.exitFrames = 0;
      if (isOverlapping(transition)) {
        // The shared frames may not eat into the time the earlier scene needs to
        // finish appearing, nor be as long as either scene.
        const beforeReveal = getScene(before.type).revealSeconds?.(before.props) ?? 0;
        const beforeFree = before.durationFrames - before.enterFrames - Math.ceil(beforeReveal * fps) - 1;
        overlapFrames = Math.max(0, Math.min(toFrames(TRANSITION_SECONDS, fps), beforeFree, durationFrames - 1));
      }
    }
    const startFrame = cursor - overlapFrames;
    scenes.push({ index, type: props.type, props, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames });
    cursor = startFrame + durationFrames;
```

with, before the loop:

```ts
  const transitions = pickTransitions(scenefile);
  const scenes: ResolvedScene[] = [];
```

and the loop header `for (const [index, props] of scenefile.scenes.entries()) {`. Add to `ResolvedScene`:

```ts
  /** How this scene arrives from the one before it; "none" for the first scene. */
  transition: TransitionKind | "none";
  /** Frames at the start of this scene during which the scene before it is still drawn. */
  overlapFrames: number;
```

and the imports `import { type Scene, type TransitionKind, getScene } from "@scenefile/scenes";` and `import { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "./transitions";`.

```text
FILE packages/engine/src/compile.ts
<<<<
  enterFrames: number;
  exitFrames: number;
}

/** What the browser runtime needs
====
  enterFrames: number;
  exitFrames: number;
  /** How this scene arrives; "none" for the first. */
  transition: string;
  /** Frames at the start of this scene shared with the scene before it. */
  overlapFrames: number;
}

/** What the browser runtime needs
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
    scenes: video.scenes.map(({ index, type, startFrame, durationFrames, enterFrames, exitFrames }) => ({
      index, type, startFrame, durationFrames, enterFrames, exitFrames,
    })),
====
    scenes: video.scenes.map(
      ({ index, type, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames }) => ({
        index, type, startFrame, durationFrames, enterFrames, exitFrames, transition, overlapFrames,
      }),
    ),
>>>>
```

In `packages/engine/src/check.ts`, the storyboard's scene line gains its transition:

```text
FILE packages/engine/src/check.ts
<<<<
      `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}`,
====
      `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}${
        scene.transition === "none" ? "" : `  (enters by ${scene.transition})`
      }`,
>>>>
```

```text
FILE packages/engine/src/index.ts
<<<<
export { type ResolvedScene, type ResolvedVideo, resolve } from "./resolve";
====
export { type ResolvedScene, type ResolvedVideo, resolve } from "./resolve";
export { TRANSITION_SECONDS, isOverlapping, pickTransitions } from "./transitions";
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/engine packages/schema packages/scenes`
Expected: PASS. Browser tests are run in Task 2, once the runtime understands overlaps.

The engine's existing compile test pins a manifest scene with `toEqual`; add `transition: "none", overlapFrames: 0` to that expected object.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): choose a transition into each scene and overlap the timeline for it"
```

---

### Task 2: Drawing transitions, a counter that stays put, and motion in seconds

**Files:**
- Create: `packages/runtime/src/transitions.ts`, `packages/render/test/transitions.test.ts`
- Modify: `packages/runtime/src/index.ts`, `packages/runtime/src/fit.ts`, `packages/engine/src/compile.ts`, `packages/scenes/src/chrome.ts`, `packages/scenes/src/motion.ts`, every `packages/scenes/src/*/definition.ts`, and tests that look for the counter inside a scene or measure positions late in a scene

**Interfaces:**
- Consumes: `ManifestScene.transition`, `ManifestScene.overlapFrames` (Task 1)
- Produces:
  - `applyTransition(kind: string, from: HTMLElement, to: HTMLElement, progress: number, stage: { wipe: HTMLElement | null; width: number }): void`
  - One `.sf-chrome` element in the stage, and one `.sf-wipe` bar; scenes no longer contain a counter
  - `STAGGER_SECONDS`; `staggerEnter` unchanged in signature

- [ ] **Step 1: Write the failing tests**

`packages/render/test/transitions.test.ts`:

```ts
import { check } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { captureFrame, openComposition } from "../src/index";

const title = (heading: string) => ({ type: "title", heading: `${heading} one two three four five` });

function compose(input: Record<string, unknown>) {
  const result = check({ version: 1, ...input });
  if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
  return result.composition;
}

interface SceneState {
  index: number;
  opacity: string;
  transform: string;
  clipPath: string;
  left: number;
}

async function stateAt(page: Awaited<ReturnType<typeof openComposition>>["page"], frame: number) {
  await captureFrame(page, frame);
  return page.evaluate(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>(".sf-scene:not([hidden])"), (el) => ({
      index: Number(el.dataset.sfScene),
      opacity: el.style.opacity,
      transform: el.style.transform,
      clipPath: el.style.clipPath,
      left: el.getBoundingClientRect().left,
    }));
    const wipe = document.querySelector<HTMLElement>(".sf-wipe");
    return {
      scenes,
      counter: document.querySelector(".sf-chrome__index")?.textContent ?? "",
      counterTop: document.querySelector(".sf-chrome")?.getBoundingClientRect().top ?? -1,
      counters: document.querySelectorAll(".sf-chrome").length,
      wipeShown: wipe ? !wipe.hidden : false,
      wipeLeft: wipe?.getBoundingClientRect().left ?? -1,
    };
  });
}

describe.each([30, 60] as const)("transitions at %i fps", (fps) => {
  const run = async (kind: string, inspect: (states: Awaited<ReturnType<typeof stateAt>>[], overlap: number) => void) => {
    const composition = compose({ fps, transition: kind, scenes: [title("First"), title("Second")] });
    const second = composition.manifest.scenes[1];
    if (!second) throw new Error("no second scene");
    const session = await openComposition(composition);
    try {
      const frames = [
        second.startFrame - 1,
        second.startFrame,
        second.startFrame + Math.floor(second.overlapFrames / 2),
        second.startFrame + Math.max(0, second.overlapFrames - 1),
        second.startFrame + second.overlapFrames,
      ];
      const states = [];
      for (const frame of frames) states.push(await stateAt(session.page, frame));
      inspect(states, second.overlapFrames);
    } finally {
      await session.close();
    }
  };

  it("push slides the old scene out to the left as the new one comes in from the right", async () => {
    await run("push", ([before, start, middle, end, after], overlap) => {
      expect(overlap).toBe(fps / 2);
      expect(before?.scenes.map((s) => s.index)).toEqual([0]);
      expect(start?.scenes.map((s) => s.index)).toEqual([0, 1]);
      expect(middle?.scenes[0]?.left).toBeLessThan(-300);
      expect(middle?.scenes[1]?.left).toBeGreaterThan(300);
      expect(end?.scenes[1]?.left).toBeLessThan(middle?.scenes[1]?.left ?? 0);
      expect(after?.scenes.map((s) => [s.index, s.transform, s.left])).toEqual([[1, "", 0]]);
    });
  });

  it("wipe uncovers the new scene behind a moving edge", async () => {
    await run("wipe", ([before, , middle, , after]) => {
      expect(before?.wipeShown).toBe(false);
      expect(middle?.scenes.map((s) => s.index)).toEqual([0, 1]);
      expect(middle?.scenes[1]?.clipPath).toMatch(/^inset\(/);
      expect(middle?.wipeShown).toBe(true);
      expect(middle?.wipeLeft).toBeGreaterThan(200);
      expect(after?.wipeShown).toBe(false);
      expect(after?.scenes.map((s) => [s.index, s.clipPath])).toEqual([[1, ""]]);
    });
  });

  it("crossfade and zoom bring the new scene up over the old one", async () => {
    for (const kind of ["crossfade", "zoom"]) {
      await run(kind, ([, start, middle, end, after]) => {
        const rising = [start, middle, end].map((state) => Number(state?.scenes[1]?.opacity));
        expect(rising[0]).toBeGreaterThan(0);
        expect(rising[1]).toBeGreaterThan(rising[0] ?? 1);
        expect(rising[2]).toBeGreaterThan(rising[1] ?? 1);
        expect(rising[2]).toBeLessThan(1);
        expect(after?.scenes.map((s) => [s.index, s.opacity, s.transform])).toEqual([[1, "1", ""]]);
      });
    }
  });

  it("cut and fade never draw two scenes at once", async () => {
    for (const kind of ["cut", "fade"]) {
      await run(kind, (states, overlap) => {
        expect(overlap).toBe(0);
        for (const state of states) expect(state.scenes).toHaveLength(1);
      });
    }
  });

  it("keeps one scene counter, in one place, counting the scene that is arriving", async () => {
    await run("push", (states) => {
      expect(states.map((state) => state.counters)).toEqual([1, 1, 1, 1, 1]);
      expect(new Set(states.map((state) => state.counterTop)).size).toBe(1);
      expect(states.map((state) => state.counter)).toEqual(["01 / 02", "02 / 02", "02 / 02", "02 / 02", "02 / 02"]);
    });
  });
});

describe("transitions and reproducibility", () => {
  it("draws identical pixels mid-transition whatever was drawn before, for every kind", async () => {
    const kinds = ["push", "wipe", "zoom", "crossfade", "cut", "fade"];
    const scenes = [
      title("Start"),
      ...kinds.map((kind, i) =>
        i % 2 === 0
          ? { type: "statement", text: `Scene ${i} says a few short words here.`, transition: kind }
          : { type: "terminal", steps: [{ run: `echo ${i}`, output: "ok" }], transition: kind },
      ),
    ];
    const composition = compose({ scenes });
    // Three frames inside each transition window, and one either side of it.
    const frames = composition.manifest.scenes.slice(1).flatMap((scene) => {
      const span = Math.max(scene.overlapFrames, 6);
      return [-1, 1, Math.floor(span / 2), span - 1, span + 2].map((offset) => scene.startFrame + offset);
    });
    let seed = 77;
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
        const order = frames.map((_, i) => i).sort(() => random() - 0.5);
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
});
```

Scenes no longer carry the counter; tests that looked for it inside a scene, or that measure where things are late in a scene, change accordingly:

```text
FILE packages/scenes/test/conformance.test.ts
<<<<
    expect(el.querySelector(".sf-chrome__index")?.textContent).toBe("03 / 08");
====
    // The scene counter belongs to the video, not to any one scene.
    expect(el.querySelector(".sf-chrome")).toBeNull();
>>>>
```

```text
FILE packages/scenes/test/title.test.ts
<<<<
  it("shows the scene's position in the video", () => {
    expect(compile({ heading: "x" }, context(2, 8))).toContain("<b>03</b> / 08");
  });

====
>>>>
```

```text
FILE packages/engine/test/themes.test.ts
<<<<
    expect(html).toContain("<b>01</b> / 02");
    expect(html).toContain("<b>02</b> / 02");
    expect(html.match(/\.sf-chrome\{/g)).toHaveLength(1);
====
    expect(html.match(/<div class="sf-chrome">/g)).toHaveLength(1);
    expect(html).toContain("<b>01</b> / 02");
    expect(html.match(/\.sf-chrome\{/g)).toHaveLength(1);
    expect(html.match(/class="sf-wipe"/g)).toHaveLength(1);
>>>>
```

In `packages/render/test/images.test.ts`, the three places that read the counter with `visible?.querySelector(".sf-chrome")` read it from the document instead (`document.querySelector(".sf-chrome")`), and its `compose` helper asks for cuts, since it measures where things sit on a scene's last frames:

```text
FILE packages/render/test/images.test.ts
<<<<
  const result = await checkWithAssets({ version: 1, ...input }, { baseDir });
====
  // These tests measure positions on a scene's last frames; a cut keeps scenes still there.
  const result = await checkWithAssets({ version: 1, transition: "cut", ...input }, { baseDir });
>>>>
```

`packages/render/test/render.test.ts` and `packages/cli/test/cli.e2e.test.ts` pin frame counts and "one scene per frame"; their fixtures ask for `fade`:

```text
FILE packages/render/test/render.test.ts
<<<<
  const result = check({
    version: 1,
    format: "square-1080p",
====
  const result = check({
    version: 1,
    transition: "fade",
    format: "square-1080p",
>>>>
```

```text
FILE packages/cli/test/cli.e2e.test.ts
<<<<
        version: 1,
        format: "square-1080p",
====
        version: 1,
        transition: "fade",
        format: "square-1080p",
>>>>
```

Add to `packages/scenes/test/mounts.test.ts`, inside `describe("title mount", …)`:

```text
FILE packages/scenes/test/mounts.test.ts
<<<<
  it("staggers the sub line behind the heading", () => {
====
  it("stays fully drawn to its last frame when it has no exit of its own", () => {
    const el = document.createElement("section");
    el.innerHTML = titleHtml;
    document.body.append(el);
    const mount = mounts.title;
    if (!mount) throw new Error("no title mount");
    const handle = mount(el, { ...ctx, exitFrames: 0 });
    for (const frame of [100, 118, 119]) {
      handle.seek(frame);
      expect(el.style.opacity).toBe("1");
    }
  });

  it("staggers by time, not by frame count: the same moment looks the same at 60 fps", () => {
    const at = (fps: number, seconds: number): string => {
      const el = document.createElement("section");
      el.innerHTML = titleHtml;
      document.body.append(el);
      const mount = mounts.title;
      if (!mount) throw new Error("no title mount");
      mount(el, { fps, durationFrames: fps * 4, enterFrames: Math.round(0.6 * fps), exitFrames: Math.round(0.4 * fps) }).seek(Math.round(seconds * fps));
      return must<HTMLElement>(el, ".sf-title__sub").style.opacity;
    };
    expect(Number(at(60, 0.3))).toBeCloseTo(Number(at(30, 0.3)), 5);
    expect(Number(at(30, 0.3))).toBeGreaterThan(0);
    expect(Number(at(30, 0.3))).toBeLessThan(1);
  });

  it("staggers the sub line behind the heading", () => {
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL. The new transition tests see one scene at a time and a counter inside each scene; the mount tests fail on the exit and on 60 fps.

- [ ] **Step 3: Implement**

`packages/scenes/src/motion.ts`, replacing the stagger constant and the two functions that use frames:

```text
FILE packages/scenes/src/motion.ts
<<<<
const STAGGER_FRAMES = 4;
====
/** Delay between one staggered element and the next. */
export const STAGGER_SECONDS = 4 / 30;
>>>>
```

```text
FILE packages/scenes/src/motion.ts
<<<<
    reveal(item, frame, Number(item.dataset.sfEnter) * STAGGER_FRAMES, ctx.enterFrames);
====
    reveal(item, frame, Number(item.dataset.sfEnter) * STAGGER_SECONDS * ctx.fps, ctx.enterFrames);
>>>>
```

```text
FILE packages/scenes/src/motion.ts
<<<<
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  const start = ctx.durationFrames - ctx.exitFrames;
====
export function fadeExit(el: HTMLElement, ctx: MountContext, frame: number): void {
  // With no exit of its own (a transition takes the scene away) it stays fully drawn.
  if (ctx.exitFrames <= 0) {
    el.style.opacity = "1";
    return;
  }
  const start = ctx.durationFrames - ctx.exitFrames;
>>>>
```

Scenes stop drawing the counter. Run once:

```bash
python3 - <<'EOF'
import glob, re
for path in sorted(glob.glob("packages/scenes/src/*/definition.ts")):
    source = open(path).read()
    assert source.count("${sceneChrome(ctx)}") == 1, path
    source = source.replace("${sceneChrome(ctx)}", "")
    source, removed = re.subn(r'^import \{ sceneChrome \} from "\.\./chrome";\n', "", source, flags=re.M)
    assert removed == 1, path
    open(path, "w").write(source)
    print("edited", path)
EOF
```

Expected: ten files edited. A definition whose `compile` no longer uses `ctx` at all keeps the parameter name with a leading underscore only if the type checker asks for it.

```text
FILE packages/scenes/src/chrome.ts
<<<<
/** The counter and hairline every scene carries at the top of the frame. */
export function sceneChrome(ctx: CompileContext): string {
  return `<div class="sf-chrome"><span class="sf-chrome__index"><b>${twoDigits(ctx.index + 1)}</b> / ${twoDigits(ctx.total)}</span></div>`;
}
====
/**
 * The counter and hairline at the top of the frame. There is one for the whole
 * video, above the scenes, so it stays still while scenes change beneath it;
 * the runtime updates the number.
 */
export function sceneChrome(total: number): string {
  return `<div class="sf-chrome"><span class="sf-chrome__index"><b>01</b> / ${twoDigits(total)}</span></div>`;
}
>>>>
```

```text
FILE packages/scenes/src/chrome.ts
<<<<
import type { CompileContext } from "./types";

====
>>>>
```

```text
FILE packages/scenes/src/chrome.ts
<<<<
.sf-chrome{position:absolute;
====
.sf-chrome{z-index:3;position:absolute;
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
import { SHARED_CSS, getScene } from "@scenefile/scenes";
====
import { SHARED_CSS, getScene, sceneChrome } from "@scenefile/scenes";
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
    ".sf-scene{position:absolute;inset:0}",
====
    // Opaque, so a scene arriving over another covers it.
    ".sf-scene{position:absolute;inset:0;background:var(--sf-bg)}",
    // The lime edge that leads a wipe.
    ".sf-wipe{z-index:2;position:absolute;top:0;bottom:0;width:calc(var(--sf-unit)*0.4);margin-left:calc(var(--sf-unit)*-0.2);background:var(--sf-accent)}",
    ".sf-wipe[hidden]{display:none}",
>>>>
```

```text
FILE packages/engine/src/compile.ts
<<<<
${sections}
</div>
====
${sections}
<div class="sf-wipe" hidden></div>
${sceneChrome(total)}
</div>
>>>>
```

`packages/runtime/src/transitions.ts`:

```ts
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A number as CSS text, with rounding fixed so a frame always produces the same string. */
function css(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Styles the outgoing and incoming scenes for one frame of a transition.
 * `progress` runs from just above 0 to just below 1. The incoming scene is
 * drawn above the outgoing one and is opaque, so fading it in is a dissolve.
 * Everything set here is cleared by the runtime before the next frame is drawn.
 */
export function applyTransition(
  kind: string,
  from: HTMLElement,
  to: HTMLElement,
  progress: number,
  stage: { wipe: HTMLElement | null; width: number },
): void {
  const p = easeInOutCubic(progress);
  to.style.zIndex = "1";
  switch (kind) {
    case "push":
      from.style.transform = `translateX(${css(-100 * p)}%)`;
      to.style.transform = `translateX(${css(100 * (1 - p))}%)`;
      break;
    case "wipe":
      // The new scene is uncovered from the left, behind a lime edge.
      to.style.clipPath = `inset(0 ${css(100 * (1 - p))}% 0 0)`;
      if (stage.wipe) {
        stage.wipe.hidden = false;
        stage.wipe.style.left = `${css(stage.width * p)}px`;
      }
      break;
    case "zoom":
      from.style.transform = `scale(${css(1 + 0.08 * p)})`;
      to.style.transform = `scale(${css(0.94 + 0.06 * p)})`;
      to.style.opacity = css(p);
      break;
    case "crossfade":
      to.style.opacity = css(p);
      break;
    default:
      break;
  }
}
```

In `packages/runtime/src/index.ts`: the manifest scene type gains `transition: string` and `overlapFrames: number`; the stage's counter and wipe bar are found once; and `seek` becomes:

```ts
    seek(frame) {
      // (comment about detaching the document stays as it is)
      root.style.display = "none";
      void root.offsetHeight;
      let current = 0;
      for (const { scene, el, handle } of mounted) {
        const local = frame - scene.startFrame;
        const active = local >= 0 && local < scene.durationFrames;
        el.hidden = !active;
        // Whatever a transition did to this scene on an earlier frame is undone first.
        el.style.transform = "";
        el.style.clipPath = "";
        el.style.zIndex = "";
        if (active) handle.seek(local);
        if (local >= 0) current = scene.index;
      }
      if (wipe) wipe.hidden = true;
      for (let i = 1; i < mounted.length; i++) {
        const arriving = mounted[i];
        const leaving = mounted[i - 1];
        if (!arriving || !leaving) continue;
        const { overlapFrames, startFrame, transition } = arriving.scene;
        const into = frame - startFrame;
        if (overlapFrames > 0 && into >= 0 && into < overlapFrames) {
          // Progress never reaches 0 or 1 inside the window: the first shared frame
          // already shows movement, and the last still shows a little of the old scene.
          applyTransition(transition, leaving.el, arriving.el, (into + 1) / (overlapFrames + 1), { wipe, width: manifest.width });
        }
      }
      if (counter) counter.textContent = String(current + 1).padStart(2, "0");
      root.style.display = "";
      void root.offsetHeight;
    },
```

with, before the returned object:

```ts
  const wipe = document.querySelector<HTMLElement>(".sf-wipe");
  const counter = document.querySelector<HTMLElement>(".sf-chrome__index b");
```

and the import `import { applyTransition } from "./transitions";`.

In `packages/runtime/src/fit.ts`, the counter is no longer inside a scene:

```text
FILE packages/runtime/src/fit.ts
<<<<
  const chrome = scene.querySelector(".sf-chrome");
  if (!chrome) return false;
====
  const chrome = document.querySelector(".sf-chrome");
  if (!chrome) return false;
>>>>
```

```text
FILE packages/runtime/src/fit.ts
<<<<
  const counter = scene.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
====
  const counter = document.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean, including all reproducibility tests.

Tests elsewhere that measure positions on a scene's final frames may now find that scene mid-transition. Where one fails for that reason, give its scenefile `transition: "cut"`: the test is about layout, and a cut keeps the scene still. Do not change what it asserts.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: draw transitions between scenes; one scene counter above them; stagger in seconds"
```

---

### Task 3: Examples and review by eye

**Files:**
- Modify: `README.md`; possibly transition timings and styles

- [ ] **Step 1: Render and look**

Run:

```bash
pnpm build
node packages/cli/dist/main.js check examples/launch.json
node packages/cli/dist/main.js render examples/launch.json -o out/launch.mp4
```

For every transition in the video, extract five frames across its half second and look at them in order. Also render the launch example at 60 fps and in portrait, and one video whose transition is each kind in turn. Fix and re-render until all hold:

- Each kind reads as what it is called; none looks like a glitch.
- The counter does not move, flicker, or disappear at any frame, and changes number once.
- No frame shows a scene half-styled after its transition has ended.
- Push and wipe move at an even pace at both frame rates.
- The automatic choices suit the scenes: nothing dense is zoomed, nothing arrives the same way twice running.

- [ ] **Step 2: Update the README**

Add after the paragraph that follows the first scenefile example:

```text
FILE README.md
<<<<
## Images, files and the network
====
## Transitions

Scenes give way to one another by `cut`, `fade`, `crossfade`, `push`, `wipe` or `zoom`.
Left alone, the engine picks one that suits the scene being arrived at and never uses
the same one twice running. Set `"transition"` on the scenefile to use one kind
throughout, or on a scene to choose how that scene arrives.

## Images, files and the network
>>>>
```

- [ ] **Step 3: Run everything once more and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS and clean.

```bash
git add -A
git commit -m "docs: transitions in the README"
```

---

## What Plan 2c-1 leaves for later

| Item | Plan |
|---|---|
| Music bed; parallel rendering; measured performance; `blackdetect` | 2c-2 |
| Frame-exact regression tests in Docker; themes `paper` and `terminal` | 2c-3 |
| Camera drift on text scenes | Only if the owner asks |
| `custom` scene | 2b-3 |
