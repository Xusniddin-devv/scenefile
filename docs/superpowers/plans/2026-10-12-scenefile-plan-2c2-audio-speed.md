# scenefile Plan 2c-2 — Parallel Rendering and a Music Bed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendering uses several browsers at once and finishes faster than the video plays, and a scenefile can name a music file to play under the video.

**Architecture:** The video is cut into fixed five-second segments. A pool of workers, each with its own browser, takes segments from a queue; every segment is encoded on its own and the segments are joined without re-encoding. Because the segments are fixed, the finished file does not depend on how many workers made it. Music is a local file, checked like an image, mixed in after the picture is complete.

**Tech Stack:** As before. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md` (§7 Renderer; §2 "Supplied audio track")

## Measured before planning

Capturing 240 frames of the launch example at 1080p on this machine (8 cores):

| Workers | Pages in one browser | One browser per worker |
|---|---|---|
| 1 | 34 ms/frame | 40 ms/frame |
| 2 | 30 ms/frame | 20 ms/frame |
| 4 | 24 ms/frame | 13 ms/frame |
| 8 | 26 ms/frame | 15 ms/frame |

Pages that share a browser share its compositor and barely speed up. Separate browsers scale to about half the cores. So: one browser per worker, and by default half the cores, at most four.

### Deviations from the spec, deliberate

- **Workers default to half the cores, capped at four**, not "CPU count minus one, at most 8": measured, more is slower.
- **No `blackdetect`.** The default theme is black; a detector for black frames would flag most of the video.
- **Music is a local file only**, with a volume. Fades are fixed (half a second in, a second and a half out). Remote music, narration and beat sync belong to the audio spec.

## Global Constraints

All earlier constraints apply. In addition:

- The finished file's frames do not depend on the number of workers.
- Each encoder uses a fixed number of threads, so several can run at once and output does not vary with the machine.
- All intermediate files live in one scratch folder beside the output, removed whatever happens.
- Music must be inside the scenefile's folder (links followed before deciding), at most 30 MB, and a recognised audio format.
- No `Co-Authored-By` trailer on commits.

## Review Focus

1. **A worker failing partway** (browser crash, ffmpeg dying). Expected: the others stop, nothing is left at the output path, the scratch folder is gone, the error says why. Task 1.
2. **More workers than segments, one worker, a one-segment video.** Expected: all work; the worker count is capped. Task 1.
3. **Music shorter or longer than the video.** Expected: looped or cut to the video's exact length, faded at both ends. Task 2.
4. **A music path that leaves the folder, is not audio, or is an address.** Expected: a diagnostic at `audio.src`; nothing outside the folder is read. Task 2.
5. **Interrupting a parallel render.** Expected: no file at the output path. Task 1.

## How edits are written in this plan

Whole files under their path, and edit blocks (`FILE` / `<<<<` / `====` / `>>>>`) whose old text occurs exactly once.

---

### Task 1: Rendering in parallel, in fixed segments

**Files:**
- Replace: `packages/render/src/render.ts`
- Modify: `packages/render/src/encode.ts`, `packages/render/src/index.ts`, `packages/cli/src/run.ts`, `packages/render/test/render.test.ts`, `packages/cli/test/run.test.ts`

**Interfaces:**
- Produces:
  - `RenderOptions.workers?: number`; `RenderReport.workers: number`; `RenderReport.audio: boolean`
  - `defaultWorkers(): number`, `MAX_WORKERS = 8`, `SEGMENT_SECONDS = 5`
  - `runFfmpeg(args: string[], ffmpegPath?: string): Promise<void>` (rejects with `EnvironmentError`)
  - CLI option `--workers <n>`

- [ ] **Step 1: Write the failing tests**

```text
FILE packages/render/test/render.test.ts
<<<<
  it("keeps an existing file at the output path when encoding fails, and reports why", async () => {
====
  it("makes the same video whatever the number of workers", async () => {
    // Seven seconds: two segments, so two workers each take one.
    const result = check({
      version: 1,
      transition: "push",
      format: "square-1080p",
      scenes: [
        { type: "title", heading: "Segments one two three", sub: "four five six", duration: 3.5 },
        { type: "terminal", steps: [{ run: "echo parallel", output: "ok" }], duration: 4 },
      ],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const total = result.composition.manifest.totalFrames;
    expect(total).toBeGreaterThan(150);
    expect(total).toBeLessThanOrEqual(300);

    const frameHashes = (file: string): string =>
      execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-f", "framemd5", "-"], { encoding: "utf8" });
    const one = join(dir, "one-worker.mp4");
    const two = join(dir, "two-workers.mp4");
    const reportOne = await renderVideo(result.composition, { output: one, quality: "draft", workers: 1 });
    const reportTwo = await renderVideo(result.composition, { output: two, quality: "draft", workers: 2 });

    expect(reportOne).toMatchObject({ workers: 1, frames: total, audio: false });
    expect(reportTwo).toMatchObject({ workers: 2, frames: total, audio: false });
    expect(frameHashes(two)).toBe(frameHashes(one));
    expect(readFileSync(two).equals(readFileSync(one))).toBe(true);
    expect(partialFiles(dir)).toEqual([]);
  });

  it("never uses more workers than there are segments to render", async () => {
    const report = await renderVideo(fixture(), { output: join(dir, "capped.mp4"), quality: "draft", workers: 6 });
    expect(report.workers).toBe(1);
    expect(defaultWorkers()).toBeGreaterThanOrEqual(1);
    expect(defaultWorkers()).toBeLessThanOrEqual(4);
  });

  it("stops every worker and leaves nothing behind when one encoder dies", async () => {
    const result = check({
      version: 1,
      scenes: [{ type: "title", heading: "one two three", duration: 6 }, { type: "title", heading: "four five six", duration: 6 }],
    });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "dies.mp4");
    writeFileSync(output, "KEEP");
    // Fails only for the second segment, so one worker succeeds while another fails.
    const ffmpegPath = fakeFfmpeg(
      "ffmpeg-second-dies",
      'case "$*" in *00001.mp4*) head -c 2000 >/dev/null; echo "segment two failed" >&2; exit 4;; *) exec ffmpeg "$@";; esac',
    );
    const attempt = renderVideo(result.composition, { output, ffmpegPath, quality: "draft", workers: 2 });
    await expect(attempt).rejects.toBeInstanceOf(EnvironmentError);
    await expect(attempt).rejects.toThrow(/segment two failed/);
    expect(readFileSync(output, "utf8")).toBe("KEEP");
    expect(partialFiles(dir)).toEqual([]);
  });

  it("keeps an existing file at the output path when encoding fails, and reports why", async () => {
>>>>
```

```text
FILE packages/render/test/render.test.ts
<<<<
import { EnvironmentError, captureFrame, openComposition, probeVideo, renderVideo } from "../src/index";
====
import { execFileSync } from "node:child_process";
import { EnvironmentError, captureFrame, defaultWorkers, openComposition, probeVideo, renderVideo } from "../src/index";
>>>>
```

```text
FILE packages/cli/test/run.test.ts
<<<<
  it("requires an output path and a known quality", async () => {
====
  it("passes the number of workers through, and refuses one that makes no sense", async () => {
    const seen: (number | undefined)[] = [];
    const render: Io["render"] = async (_composition, options) => {
      seen.push(options.workers);
      return report;
    };
    const input = file("workers.json", valid);
    expect(await run(["render", input, "-o", "x.mp4", "--workers", "3"], capture(render).io)).toBe(0);
    expect(await run(["render", input, "-o", "x.mp4"], capture(render).io)).toBe(0);
    expect(seen).toEqual([3, undefined]);
    for (const bad of ["0", "-2", "many", "1.5", "99"]) {
      const c = capture(render);
      expect(await run(["render", input, "-o", "x.mp4", "--workers", bad], c.io), bad).toBe(2);
      expect(c.err()).toContain("--workers");
    }
    expect(seen).toHaveLength(2);
  });

  it("requires an output path and a known quality", async () => {
>>>>
```

The test's canned report needs the new fields:

```text
FILE packages/cli/test/run.test.ts
<<<<
  output: "/tmp/out.mp4", width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1234,
====
  output: "/tmp/out.mp4", width: 1920, height: 1080, fps: 30, frames: 150, durationSeconds: 5, elapsedMs: 1234, workers: 2, audio: false,
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/render/test/render.test.ts packages/cli/test/run.test.ts`
Expected: FAIL. `defaultWorkers` is not exported; reports have no `workers`; `--workers` is an unknown option.

- [ ] **Step 3: Implement**

Add to `packages/render/src/encode.ts`, and give the encoder a fixed thread count:

```text
FILE packages/render/src/encode.ts
<<<<
      "-c:v", "libx264", "-crf", String(options.crf),
====
      // A fixed thread count: several encoders run at once, and the encoded
      // bytes must not vary with how many cores the machine has.
      "-c:v", "libx264", "-threads", "2", "-crf", String(options.crf),
>>>>
```

```text
FILE packages/render/src/encode.ts
<<<<
export interface Encoder {
====
/** Runs ffmpeg to completion. A missing binary or a non-zero exit is an environment problem, with ffmpeg's own words. */
export function runFfmpeg(args: string[], ffmpegPath = "ffmpeg"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ["-y", "-loglevel", "error", ...args], (cause, _stdout, stderr) => {
      if (!cause) resolve();
      else if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new EnvironmentError("ffmpeg was not found.", FFMPEG_REMEDY));
      } else {
        reject(new EnvironmentError(`ffmpeg failed: ${stderr.trim().slice(-2000) || cause.message}`, ENCODE_REMEDY));
      }
    });
  });
}

export interface Encoder {
>>>>
```

```text
FILE packages/render/src/encode.ts
<<<<
import { spawn } from "node:child_process";
====
import { execFile, spawn } from "node:child_process";
>>>>
```

`packages/render/src/render.ts`:

```ts
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { Composition } from "@scenefile/engine";
import { captureFrame } from "./capture";
import { runFfmpeg, startEncoder } from "./encode";
import { EnvironmentError, WRITE_REMEDY } from "./errors";
import { type ProbeResult, probeVideo } from "./probe";
import { openComposition } from "./session";

export const QUALITIES = ["draft", "standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

const CRF: Record<Quality, number> = { draft: 28, standard: 20, high: 16 };

/**
 * The video is rendered in segments of this length, each encoded on its own
 * and then joined. The length is fixed rather than derived from the number of
 * workers, so the finished file is the same however many workers made it.
 */
export const SEGMENT_SECONDS = 5;
export const MAX_WORKERS = 8;

/**
 * Each worker runs its own browser. Measured: capture speeds up until about
 * half the cores are busy and gets slower beyond that.
 */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

export interface RenderOptions {
  output: string;
  quality?: Quality;
  /** Browsers to render with at once. Defaults to half the cores, at most four. */
  workers?: number;
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
  workers: number;
  /** Whether the file has a sound track. */
  audio: boolean;
}

interface Segment {
  from: number;
  to: number;
  file: string;
}

function unwritable(output: string, cause: unknown): EnvironmentError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new EnvironmentError(`Cannot write the video to "${output}": ${reason}`, WRITE_REMEDY);
}

/** Joins encoded segments end to end without re-encoding them. */
async function joinSegments(segments: readonly Segment[], scratch: string, target: string, ffmpegPath?: string): Promise<void> {
  const list = join(scratch, "segments.txt");
  // The concat list quotes each path; a quote inside a path is closed, escaped, and reopened.
  await writeFile(list, segments.map((segment) => `file '${segment.file.replace(/'/g, "'\\''")}'\n`).join(""));
  await runFfmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", target], ffmpegPath);
}

/**
 * Renders every frame of a composition to an MP4 and verifies the result with ffprobe.
 *
 * Everything is built in a scratch folder beside the output and moved into
 * place only once it is complete and verified. Whatever was at the output path
 * before is untouched by a failed or interrupted render, and a file at the
 * output path always means a finished video.
 */
export async function renderVideo(composition: Composition, options: RenderOptions): Promise<RenderReport> {
  const started = Date.now();
  const output = resolvePath(options.output);
  const scratch = join(dirname(output), `.${basename(output)}.partial-${process.pid}`);
  const { fps, totalFrames, width, height } = composition.manifest;

  const perSegment = SEGMENT_SECONDS * fps;
  const segments: Segment[] = Array.from({ length: Math.ceil(totalFrames / perSegment) }, (_, index) => ({
    from: index * perSegment,
    to: Math.min(totalFrames, (index + 1) * perSegment),
    file: join(scratch, `${String(index).padStart(5, "0")}.mp4`),
  }));
  const workers = Math.max(1, Math.min(Math.floor(options.workers ?? defaultWorkers()), MAX_WORKERS, segments.length));

  try {
    await mkdir(dirname(output), { recursive: true });
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch);
  } catch (cause) {
    throw unwritable(output, cause);
  }

  let probed: ProbeResult;
  try {
    const queue = [...segments];
    let done = 0;
    let stopped = false;

    /** One worker: its own browser, taking segments until none are left or another worker has failed. */
    const work = async (): Promise<void> => {
      const session = await openComposition(composition);
      try {
        for (let segment = queue.shift(); segment && !stopped; segment = queue.shift()) {
          const encoder = startEncoder({
            output: segment.file,
            fps,
            crf: CRF[options.quality ?? "standard"],
            ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
          });
          try {
            for (let frame = segment.from; frame < segment.to && !stopped; frame++) {
              await encoder.write(await captureFrame(session.page, frame));
              done += 1;
              options.onProgress?.(done, totalFrames);
            }
            await encoder.finish();
          } catch (cause) {
            await encoder.finish().catch(() => undefined);
            throw cause;
          }
        }
      } finally {
        await session.close();
      }
    };

    const outcomes = await Promise.allSettled(
      Array.from({ length: workers }, () =>
        work().catch((cause: unknown) => {
          stopped = true;
          throw cause;
        }),
      ),
    );
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason as unknown] : []));
    if (failures.length > 0) {
      // A problem with the machine is the more useful thing to report than whatever it caused elsewhere.
      throw failures.find((failure) => failure instanceof EnvironmentError) ?? failures[0];
    }

    const picture = join(scratch, "picture.mp4");
    const [only] = segments;
    if (segments.length === 1 && only) await rename(only.file, picture);
    else await joinSegments(segments, scratch, picture, options.ffmpegPath);

    probed = await probeVideo(picture, options.ffprobePath);
    if (probed.width !== width || probed.height !== height || probed.frames !== totalFrames) {
      throw new Error(
        `Rendered file does not match the composition: expected ${width}x${height} with ${totalFrames} frames, ` +
          `got ${probed.width}x${probed.height} with ${probed.frames}.`,
      );
    }
    try {
      await rename(picture, output);
    } catch (cause) {
      throw unwritable(output, cause);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  return {
    output,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    frames: probed.frames,
    durationSeconds: probed.durationSeconds,
    elapsedMs: Date.now() - started,
    workers,
    audio: false,
  };
}
```

```text
FILE packages/render/src/index.ts
<<<<
export { type Encoder, startEncoder } from "./encode";
====
export { type Encoder, runFfmpeg, startEncoder } from "./encode";
>>>>
```

```text
FILE packages/render/src/index.ts
<<<<
export { QUALITIES, type Quality, type RenderOptions, type RenderReport, renderVideo } from "./render";
====
export {
  MAX_WORKERS,
  QUALITIES,
  type Quality,
  type RenderOptions,
  type RenderReport,
  SEGMENT_SECONDS,
  defaultWorkers,
  renderVideo,
} from "./render";
>>>>
```

CLI:

```text
FILE packages/cli/src/run.ts
<<<<
      quality: { type: "string", default: "standard" },
====
      quality: { type: "string", default: "standard" },
      workers: { type: "string" },
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
    const rendered = await (io.render ?? renderVideo)(result.composition, {
      output: values.output,
      quality: values.quality,
    });
====
    const rendered = await (io.render ?? renderVideo)(result.composition, {
      output: values.output,
      quality: values.quality,
      ...(workers === undefined ? {} : { workers }),
    });
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
    const result = await load(file, io);
    if (!result.ok || !result.composition) {
====
    let workers: number | undefined;
    if (values.workers !== undefined) {
      workers = Number(values.workers);
      if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) {
        throw new UsageError(`--workers must be a whole number from 1 to ${MAX_WORKERS}; got "${values.workers}".`);
      }
    }

    const result = await load(file, io);
    if (!result.ok || !result.composition) {
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
  inspectComposition,
====
  inspectComposition,
  MAX_WORKERS,
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--json]
====
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--workers <n>] [--json]
>>>>
```

```text
FILE packages/cli/src/run.ts
<<<<
          `${rendered.durationSeconds.toFixed(2)}s, in ${(rendered.elapsedMs / 1000).toFixed(1)}s.`,
====
          `${rendered.durationSeconds.toFixed(2)}s${rendered.audio ? ", with music" : ""}, in ${(rendered.elapsedMs / 1000).toFixed(1)}s ` +
          `with ${rendered.workers} ${rendered.workers === 1 ? "worker" : "workers"}.`,
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`

If the byte-for-byte comparison of the two files fails while the frame hashes match, the encoder is not deterministic across runs with these settings; keep the frame-hash assertion, remove only the byte comparison, and record a ruling saying what differed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(render): render fixed segments in parallel, one browser per worker"
```

---

### Task 2: A music bed

**Files:**
- Modify: `packages/schema/src/scenefile.ts`, `packages/engine/src/assets.ts`, `packages/engine/src/check.ts`, `packages/engine/src/compile.ts`, `packages/engine/src/index.ts`, `packages/render/src/render.ts`, `packages/render/src/probe.ts`
- Test: `packages/engine/test/audio.test.ts`, `packages/render/test/audio.test.ts`

**Interfaces:**
- Produces:
  - Scenefile `audio?: { src: string; volume: number }` (volume 0 to 1, default 0.4)
  - `MAX_AUDIO_BYTES`, `interface LoadedAudio { file: string; volume: number }`, `loadAudio(scenefile, sources): Promise<{ audio: LoadedAudio | null; diagnostics: Diagnostic[] }>`
  - `LoadedAssets.audio?: LoadedAudio | null`; `Composition.audio?: LoadedAudio`
  - `ProbeResult.audio: boolean`
  - Storyboard header ends with `, music` when there is a music bed

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/audio.test.ts`:

```ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalize } from "@scenefile/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, loadAudio } from "../src/assets";
import { check, checkWithAssets } from "../src/check";

const scenes = [{ type: "title", heading: "one two three", sub: "four five six" }];

describe("the music bed", () => {
  let root: string;
  let baseDir: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "scenefile-audio-")));
    baseDir = join(root, "project");
    mkdirSync(baseDir);
    mkdirSync(join(root, "outside"));
    writeFileSync(join(baseDir, "bed.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "frames.mp3"), Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.wav"), Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.m4a"), Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A "), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.ogg"), Buffer.concat([Buffer.from("OggS"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "bed.flac"), Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(64)]));
    writeFileSync(join(baseDir, "notes.mp3"), "these are not sounds");
    writeFileSync(join(baseDir, "huge.mp3"), "ID3");
    truncateSync(join(baseDir, "huge.mp3"), MAX_AUDIO_BYTES + 1);
    writeFileSync(join(root, "outside", "secret.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]));
    symlinkSync(join(root, "outside", "secret.mp3"), join(baseDir, "link.mp3"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const parsed = (audio: unknown) => {
    const { scenefile, diagnostics } = normalize({ version: 1, audio, scenes });
    if (!scenefile) throw new Error(JSON.stringify(diagnostics));
    return scenefile;
  };
  const load = (audio: unknown) => loadAudio(parsed(audio), { baseDir });

  it("defaults the volume, and keeps it between silent and full", () => {
    expect(parsed({ src: "bed.mp3" }).audio).toEqual({ src: "bed.mp3", volume: 0.4 });
    expect(normalize({ version: 1, audio: { src: "bed.mp3", volume: 1.5 }, scenes }).scenefile).toBeNull();
    expect(normalize({ version: 1, audio: { src: "bed.mp3", loop: true }, scenes }).scenefile).toBeNull();
  });

  it.each(["bed.mp3", "frames.mp3", "bed.wav", "bed.m4a", "bed.ogg", "bed.flac"])("accepts %s", async (src) => {
    const { audio, diagnostics } = await load({ src, volume: 0.25 });
    expect(diagnostics).toEqual([]);
    expect(audio).toEqual({ file: join(baseDir, src), volume: 0.25 });
  });

  it("has nothing to load when the scenefile names no music", async () => {
    const { scenefile } = normalize({ version: 1, scenes });
    if (!scenefile) throw new Error("invalid");
    expect(await loadAudio(scenefile, { baseDir })).toEqual({ audio: null, diagnostics: [] });
  });

  it.each([
    ["nope.mp3", "ASSET_NOT_FOUND", /no file/],
    ["../outside/secret.mp3", "ASSET_NOT_FOUND", /outside/],
    ["link.mp3", "ASSET_NOT_FOUND", /outside/],
    ["https://example.com/bed.mp3", "ASSET_NOT_FOUND", /local file|folder/],
    ["notes.mp3", "ASSET_UNSUPPORTED", /MP3|WAV/],
    ["huge.mp3", "ASSET_TOO_LARGE", /30 MB/],
  ])("refuses %s", async (src, code, message) => {
    const { audio, diagnostics } = await load({ src });
    expect(audio).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ code, severity: "error", path: "audio.src" })]);
    expect(diagnostics[0]?.message).toMatch(message);
  });

  it("carries the music into the composition and mentions it in the storyboard", async () => {
    const result = await checkWithAssets({ version: 1, audio: { src: "bed.mp3" }, scenes }, { baseDir });
    expect(result.ok).toBe(true);
    expect(result.composition?.audio).toEqual({ file: join(baseDir, "bed.mp3"), volume: 0.4 });
    expect(result.storyboard.split("\n")[0]).toMatch(/, 1 scenes, music$/);
    const silent = await checkWithAssets({ version: 1, scenes }, { baseDir });
    expect(silent.composition?.audio).toBeUndefined();
    expect(silent.storyboard.split("\n")[0]).not.toContain("music");
  });

  it("fails a check that names music which was never loaded, or which could not be", async () => {
    const unloaded = check({ version: 1, audio: { src: "bed.mp3" }, scenes });
    expect(unloaded.ok).toBe(false);
    expect(unloaded.diagnostics).toEqual([expect.objectContaining({ code: "ASSET_NOT_FOUND", path: "audio.src" })]);
    const missing = await checkWithAssets({ version: 1, audio: { src: "nope.mp3" }, scenes }, { baseDir });
    expect(missing.ok).toBe(false);
    expect(missing.composition).toBeNull();
  });
});
```

`packages/render/test/audio.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWithAssets } from "@scenefile/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeVideo, renderVideo } from "../src/index";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scenefile-music-"));
  const tone = (name: string, seconds: number, hertz: number): void => {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${hertz}:duration=${seconds}`, join(dir, name)]);
  };
  tone("short.mp3", 1, 440);
  tone("long.wav", 20, 330);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const scenes = [
  { type: "title", heading: "one two three", sub: "four five six", duration: 3 },
  { type: "title", heading: "seven eight nine", duration: 3 },
];

/** Mean volume of a stretch of the file's sound, in dB. Silence is far below -60. */
function loudness(file: string, from: number, seconds: number): number {
  const log = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-ss", String(from), "-t", String(seconds), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return Number(/mean_volume: (-?[\d.]+|-inf) dB/.exec(log)?.[1] ?? Number.NaN);
}

describe("rendering with music", () => {
  it.each([
    ["short.mp3", "music shorter than the video is repeated"],
    ["long.wav", "music longer than the video is cut"],
  ])("%s: %s, to exactly the video's length, faded at both ends", async (src) => {
    const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", audio: { src }, scenes }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, `with-${src}.mp4`);
    const report = await renderVideo(result.composition, { output, quality: "draft" });

    expect(report.audio).toBe(true);
    expect(report.frames).toBe(result.composition.manifest.totalFrames);
    const probed = await probeVideo(output);
    expect(probed.audio).toBe(true);
    expect(probed.frames).toBe(result.composition.manifest.totalFrames);
    expect(probed.durationSeconds).toBeCloseTo(6, 1);

    const middle = loudness(output, 2.5, 1);
    expect(middle).toBeGreaterThan(-45);
    // The last quarter second is the tail of the fade out: much quieter than the middle.
    expect(loudness(output, 5.75, 0.25)).toBeLessThan(middle - 12);
  });

  it("makes a quieter file for a lower volume, and a silent track for none", async () => {
    const render = async (volume: number): Promise<number> => {
      const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", audio: { src: "long.wav", volume }, scenes }, { baseDir: dir });
      if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
      const output = join(dir, `volume-${volume}.mp4`);
      await renderVideo(result.composition, { output, quality: "draft" });
      return loudness(output, 2.5, 1);
    };
    const full = await render(1);
    const half = await render(0.5);
    expect(full - half).toBeGreaterThan(4);
    expect(full - half).toBeLessThan(8);
  });

  it("has no sound track when the scenefile names no music", async () => {
    const result = await checkWithAssets({ version: 1, transition: "fade", format: "square-1080p", scenes }, { baseDir: dir });
    if (!result.composition) throw new Error(JSON.stringify(result.diagnostics));
    const output = join(dir, "silent.mp4");
    const report = await renderVideo(result.composition, { output, quality: "draft" });
    expect(report.audio).toBe(false);
    expect((await probeVideo(output)).audio).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/audio.test.ts packages/render/test/audio.test.ts`
Expected: FAIL. `loadAudio` and `MAX_AUDIO_BYTES` do not exist; `audio` is an unknown top-level field.

- [ ] **Step 3: Implement**

```text
FILE packages/schema/src/scenefile.ts
<<<<
  /** How scenes give way to one another, unless a scene says otherwise. */
====
  /** Music to play under the whole video: a file beside the scenefile. */
  audio: z
    .strictObject({
      src: z.string().min(1).max(2000),
      /** From 0 (silent) to 1 (as loud as the file). */
      volume: z.number().min(0).max(1).default(0.4),
    })
    .optional(),
  /** How scenes give way to one another, unless a scene says otherwise. */
>>>>
```

In `packages/engine/src/assets.ts`, split locating a local file from reading it, and add the music loader. Replace the `readLocal` function with:

```ts
/**
 * Finds a local file a scenefile names, refusing anything outside the
 * scenefile's folder (links are followed before deciding), anything that is
 * not a plain file, and anything over `maxBytes`. Returns its real path.
 */
async function locateLocal(src: string, sources: AssetSources, maxBytes: number): Promise<string | Failure> {
  const outside = notFound(
    `"${src}" is outside the scenefile's folder, so it was not read.`,
    "Copy the file into the scenefile's folder and refer to it by a relative path.",
  );
  const missing = notFound(
    `There is no file "${src}" in the scenefile's folder.`,
    "Check the file name; paths are relative to the scenefile.",
  );
  const folder = resolvePath(sources.baseDir);
  // In the root folder "inside the scenefile's folder" would mean the whole disk.
  if (folder === parsePath(folder).root) {
    return notFound("The scenefile is in the root folder, so local files are not read.", "Move the scenefile and its files into a folder of their own.");
  }
  if (src.includes("\0")) return missing;
  const file = resolvePath(folder, src);
  if (!isInside(folder, file)) return outside;

  try {
    // Follow links before deciding: a link inside the folder may point outside it.
    const [realFolder, realFile] = await Promise.all([realpath(folder), realpath(file)]);
    if (!isInside(realFolder, realFile)) return outside;
    const info = await stat(realFile);
    if (!info.isFile()) return notFound(`"${src}" is a folder or a device, not a file.`, "Give the path of a file.");
    if (info.size > maxBytes) return tooLarge(src, maxBytes);
    return realFile;
  } catch {
    return missing;
  }
}

async function readLocal(src: string, sources: AssetSources): Promise<Buffer | Failure> {
  const located = await locateLocal(src, sources, MAX_ASSET_BYTES);
  if (typeof located !== "string") return located;
  try {
    return await readFile(located);
  } catch {
    return notFound(`"${src}" could not be read.`, "Check the file's permissions.");
  }
}
```

`tooLarge` takes the limit:

```ts
function tooLarge(src: string, maxBytes: number = MAX_ASSET_BYTES): Failure {
  return {
    code: "ASSET_TOO_LARGE",
    message: `"${src}" is larger than ${maxBytes / 1024 / 1024} MB.`,
    fix: "Use a smaller file.",
  };
}
```

and at the end of the file:

```ts
/** Largest music file, in bytes. */
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

export interface LoadedAudio {
  /** The music file's real path. */
  file: string;
  volume: number;
}

/** True when a file's first bytes are those of MP3, AAC, WAV, M4A, Ogg or FLAC. */
function looksLikeAudio(head: Buffer): boolean {
  if (head.length < 12) return false;
  const text = (from: number, to: number): string => head.toString("latin1", from, to);
  return (
    text(0, 3) === "ID3" ||
    (head.readUInt8(0) === 0xff && (head.readUInt8(1) & 0xe0) === 0xe0) ||
    (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") ||
    text(4, 8) === "ftyp" ||
    text(0, 4) === "OggS" ||
    text(0, 4) === "fLaC"
  );
}

/**
 * Finds the scenefile's music, if it names any. Music is a local file only:
 * it is handed to ffmpeg by path, and a scenefile must not be able to point
 * ffmpeg at anything outside its own folder.
 */
export async function loadAudio(
  scenefile: Scenefile,
  sources: AssetSources,
): Promise<{ audio: LoadedAudio | null; diagnostics: Diagnostic[] }> {
  const wanted = scenefile.audio;
  if (!wanted) return { audio: null, diagnostics: [] };
  const fail = (failure: Failure) => ({
    audio: null,
    diagnostics: [error(failure.code, "audio.src", failure.message, failure.fix)],
  });

  if (isAddress(wanted.src)) {
    return fail(notFound("Music must be a local file in the scenefile's folder; addresses are not downloaded.", "Save the music beside the scenefile and give its file name."));
  }
  const located = await locateLocal(wanted.src, sources, MAX_AUDIO_BYTES);
  if (typeof located !== "string") return fail(located);

  const head = Buffer.alloc(12);
  const handle = await open(located, "r");
  try {
    await handle.read(head, 0, 12, 0);
  } finally {
    await handle.close();
  }
  if (!looksLikeAudio(head)) {
    return fail({
      code: "ASSET_UNSUPPORTED",
      message: `"${wanted.src}" is not an MP3, WAV, M4A, AAC, Ogg or FLAC file.`,
      fix: "Convert the music to MP3 or WAV.",
    });
  }
  return { audio: { file: located, volume: wanted.volume }, diagnostics: [] };
}
```

with `open` added to the `node:fs/promises` import and `audio?: LoadedAudio | null` added to `LoadedAssets`.

```text
FILE packages/engine/src/compile.ts
<<<<
export interface Composition {
  html: string;
  manifest: Manifest;
}
====
export interface Composition {
  html: string;
  manifest: Manifest;
  /** Music to mix under the video: a checked local file and its volume. */
  audio?: { file: string; volume: number };
}
>>>>
```

In `packages/engine/src/check.ts`: import `loadAudio`; in `check`, after the loop over image references, add

```ts
  if (normalized.scenefile.audio && !loaded?.audio && !assetDiagnostics.some((diagnostic) => diagnostic.path === "audio.src")) {
    assetDiagnostics.push(
      error(
        "ASSET_NOT_FOUND",
        "audio.src",
        `The music "${normalized.scenefile.audio.src}" has not been loaded.`,
        "Check the scenefile with the scenefile command, which loads its files.",
      ),
    );
  }
```

make the successful return carry the music and say so in the storyboard:

```ts
  const music = loaded?.audio ?? undefined;
  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    video: resolved.video,
    composition: { ...compile(resolved.video), ...(music ? { audio: music } : {}) },
    storyboard: storyboard(resolved.video, undefined, Boolean(music)),
  };
```

give `storyboard` a third parameter, `music = false`, appending `, music` to its first line when true; have `applyLayout` pass `Boolean(result.composition?.audio)`; and make `checkWithAssets` load both:

```ts
export async function checkWithAssets(input: unknown, sources: AssetSources): Promise<CheckResult> {
  const { scenefile } = normalize(input);
  if (!scenefile) return check(input);
  const images = await loadAssets(assetRefs(scenefile), sources);
  const music = await loadAudio(scenefile, sources);
  return check(input, { ...images, audio: music.audio, diagnostics: [...images.diagnostics, ...music.diagnostics] });
}
```

Export `MAX_AUDIO_BYTES`, `type LoadedAudio` and `loadAudio` from `packages/engine/src/index.ts`.

In `packages/render/src/probe.ts`, report whether the file has sound: add `audio: boolean` to `ProbeResult`, and after reading the video stream make a second, small call:

```ts
  const sound = await run(ffprobePath, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file]);
```

returning `audio: sound.trim() !== ""`.

In `packages/render/src/render.ts`, after the picture is verified and before it is moved into place, mix in the music:

```ts
    let finished = picture;
    if (composition.audio) {
      finished = join(scratch, "with-music.mp4");
      const seconds = totalFrames / fps;
      const fadeOut = Math.min(MUSIC_FADE_OUT_SECONDS, seconds / 3);
      await runFfmpeg(
        [
          "-i", picture,
          // The music is repeated without end and then cut to the picture's length.
          "-stream_loop", "-1", "-i", composition.audio.file,
          "-filter_complex",
          `[1:a]volume=${composition.audio.volume},afade=t=in:st=0:d=${MUSIC_FADE_IN_SECONDS},afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[music]`,
          "-map", "0:v:0", "-map", "[music]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-t", seconds.toFixed(3),
          "-movflags", "+faststart",
          finished,
        ],
        options.ffmpegPath,
      );
      const mixed = await probeVideo(finished, options.ffprobePath);
      if (!mixed.audio || mixed.frames !== totalFrames) {
        throw new Error(`Mixing in the music changed the video: expected ${totalFrames} frames with sound, got ${mixed.frames}${mixed.audio ? "" : " without sound"}.`);
      }
    }
```

with constants `MUSIC_FADE_IN_SECONDS = 0.5` and `MUSIC_FADE_OUT_SECONDS = 1.5`, the final `rename` moving `finished` rather than `picture`, and the report's `audio` set to `Boolean(composition.audio)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`, then `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: a music bed under the video, from a checked local file"
```

---

### Task 3: Measure, document, and listen

**Files:**
- Create: `scripts/bench.mjs`
- Modify: `package.json`, `README.md`

- [ ] **Step 1: Write the benchmark**

`scripts/bench.mjs`:

```js
// Renders one scenefile with 1, 2 and 4 workers and prints how long each took.
// Usage: node scripts/bench.mjs [scenefile]   (after `pnpm build`)
import { readFileSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkWithAssets } from "../packages/engine/dist/index.js";
import { renderVideo } from "../packages/render/dist/index.js";

const file = resolve(process.argv[2] ?? "examples/launch.json");
const result = await checkWithAssets(JSON.parse(readFileSync(file, "utf8")), { baseDir: dirname(file) });
if (!result.composition) throw new Error(JSON.stringify(result.diagnostics, null, 2));
const { totalFrames, fps, width, height } = result.composition.manifest;
const seconds = totalFrames / fps;

console.log(`${file}`);
console.log(`${width}x${height}, ${fps} fps, ${seconds.toFixed(1)} s, ${totalFrames} frames, on ${cpus().length} cores (${cpus()[0]?.model ?? "unknown"})`);
console.log("workers  seconds  frames/s  x realtime");
for (const workers of [1, 2, 4]) {
  const output = join(tmpdir(), `scenefile-bench-${process.pid}-${workers}.mp4`);
  const report = await renderVideo(result.composition, { output, workers });
  const took = report.elapsedMs / 1000;
  console.log(`${String(report.workers).padStart(7)}  ${took.toFixed(1).padStart(7)}  ${(totalFrames / took).toFixed(0).padStart(8)}  ${(seconds / took).toFixed(2).padStart(10)}`);
  rmSync(output, { force: true });
}
```

Add `"bench": "pnpm build && node scripts/bench.mjs"` to the root `package.json` scripts.

- [ ] **Step 2: Run it and record what it prints**

Run: `pnpm bench`
Expected: a table of three rows. Rendering with four workers should be faster than the video plays; if it is not, find out why before writing anything in the README.

- [ ] **Step 3: Listen**

Make a short tone and a scenefile that uses it, render it, and play it:

```bash
mkdir -p out/music && ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=220:duration=4" out/music/tone.mp3
cp examples/launch.json out/music/launch.json
python3 - <<'EOF'
import json
p = "out/music/launch.json"; d = json.load(open(p)); d["audio"] = {"src": "tone.mp3", "volume": 0.3}
json.dump(d, open(p, "w"), indent=2)
EOF
node packages/cli/dist/main.js render out/music/launch.json -o out/launch-music.mp4
```

Check with `ffprobe` that the file has an AAC stream as long as the video, and with `volumedetect` that the first and last half seconds are quieter than the middle. A sine tone only proves the plumbing; say so, and do not ship it as an example.

- [ ] **Step 4: Update the README**

Add a "Speed" section with the table from Step 2, stating the machine it was measured on and the date, and a "Music" section: the `audio` field, that the file must be beside the scenefile, the formats, that it loops or is cut to the video's length, and that no music is bundled. Update the `render` usage line with `--workers`.

- [ ] **Step 5: Run everything once more and commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add -A
git commit -m "docs: measured render speed and the music bed; benchmark script"
```

---

## What Plan 2c-2 leaves for later

| Item | Plan |
|---|---|
| Frame-exact regression tests in Docker; themes `paper` and `terminal` | 2c-3 |
| Narration, captions, beat sync, remote audio | Audio spec |
| `custom` scene | 2b-3 |
| MCP server, generated agent docs, CI, release | 3 |
