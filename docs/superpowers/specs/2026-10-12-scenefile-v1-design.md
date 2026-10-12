# scenefile v1 — design

Date: 2026-10-12
Status: awaiting owner review
Working name: `scenefile` (free on npm on 2026-10-12; renaming before first publish is a find-and-replace)

## 1. Purpose

An open-source tool that lets any LLM produce a professional video, including
cheap and text-only models (DeepSeek, MiniMax, Qwen, GLM) that fail at
free-form video code and cannot look at a frame to check their work.

The model writes a small JSON document, a *scenefile*, that describes intent:
what each scene says and shows. It never writes pixels, keyframes, or HTML.
The tool turns that into a designed, animated MP4 and reports every problem as
text the model can act on.

### What the owner asked for

- Open source and installable by other people's agents (skill, MCP, plugin).
- Works for non-Claude models.
- A reputation project: high-end output, used by thousands, not a toy.
- Three video families: software launch videos, social shorts, explainers.
- Own renderer, no dependency on Remotion or HeyGen Hyperframes.
- Professional engineering, no unbacked claims.

### Why this is not a clone

Remotion and Hyperframes both expect the model to write good animation code.
Strong models can. This tool targets the layer below: a closed vocabulary, good
defaults when fields are omitted, and verification that needs no vision.

## 2. Scope

This spec is the first of several. It delivers a complete, usable product:
engine, the `launch` pack, CLI, MCP server, and agent docs.

In scope for v1:

- Scenefile schema, version 1, with JSON Schema export.
- Pipeline: normalize, resolve, compile, inspect, verify, render, mux.
- Ten scene types (the `launch` pack) plus a sandboxed `custom` scene.
- Four themes and a motion system with automatic timing and transitions.
- Supplied audio track muxed under the video (music bed, with fades).
- CLI and MCP server.
- Agent docs generated from the schema.
- Tests, CI, Docker image.

Later specs, in order (each gets its own design and plan):

1. Audio: TTS narration with word timings, captions, beat sync, and the `shorts` pack.
2. The `explain` pack: charts, diagrams, step-through scenes.
3. Benchmark harness: success rate per model, published table and gallery.
4. Preview studio: local web UI with timeline scrub and live reload.
5. Footage: video clips in scenes, Whisper transcripts, cut lists.

Not in v1, by decision: embedded video clips, TTS, beat detection, charts,
any web UI, cloud rendering, GPU encoding.

## 3. Architecture

```
scenefile.json
   │ normalize   lenient parse, coercions, did-you-mean       (pure, Node)
   │ resolve     auto durations, transitions, asset fetch     (Node, I/O at edges)
   │ compile     Composition = HTML + CSS + timeline manifest (pure, Node)
   │ inspect     load in Chromium, fit text, measure boxes    (browser)
   │ verify      diagnostics + text storyboard                (pure, Node)
   │ render      seek frame, screenshot, pipe to ffmpeg       (browser + ffmpeg)
   ▼ mux         audio, final checks with ffprobe             (ffmpeg)
out.mp4
```

Verification runs before render, so a model gets feedback in seconds and only
pays the render cost for a scenefile that already passes.

### Packages (pnpm monorepo, TypeScript strict)

| Package | Responsibility | Depends on |
|---|---|---|
| `@scenefile/schema` | Zod schema, types, JSON Schema export, normalizer, version migrations | zod |
| `@scenefile/engine` | resolve, compile, verify, storyboard; scene and theme registries | schema, shiki |
| `@scenefile/runtime` | Browser bundle: mounts scenes, fits text, exposes `seek(frame)` | none |
| `@scenefile/render` | Chromium session, inspect, frame capture, ffmpeg encode and mux | engine, runtime, playwright-core |
| `@scenefile/mcp` | MCP server over the same functions | engine, render, MCP SDK |
| `scenefile` | CLI; also starts the MCP server (`scenefile mcp`) | all |

`engine` has no browser dependency. It consumes inspect results as plain JSON,
so resolve, compile, and verify are unit-testable without Chromium.

## 4. The scenefile

```json
{
  "version": 1,
  "format": "landscape-1080p",
  "theme": "midnight",
  "accent": "#FF5722",
  "audio": { "music": "./bed.mp3", "volume": 0.4 },
  "scenes": [
    { "type": "title", "heading": "Ship faster", "sub": "A CLI for X" },
    { "type": "code", "lang": "ts", "source": "…", "highlight": [3, 4] },
    { "type": "terminal", "steps": [{ "run": "npx x init", "output": "Done in 2s" }] },
    { "type": "outro", "heading": "Try it", "command": "npm i x", "url": "x.dev" }
  ]
}
```

Rules:

- Only `version` and `scenes` are required. Everything else has a default.
- `format`: `landscape-1080p` (default), `portrait-1080p`, `square-1080p`. 30 fps default, 60 optional.
- `duration` and `transition` on a scene default to `"auto"`.
- Enumerated values everywhere a free string is not needed.
- Assets are local paths (relative to the scenefile) or `https` URLs.
- Frames are the canonical time unit internally; the scenefile uses seconds.

### Scene types

| Type | Shows |
|---|---|
| `title` | Heading, optional sub line and logo |
| `statement` | One large sentence, word-by-word emphasis |
| `bullets` | Heading and up to five points, revealed in sequence |
| `code` | Highlighted source, line focus, typewriter or block reveal |
| `terminal` | Commands typed, output printed |
| `screenshot` | Image inside browser or window chrome, pan, zoom, callouts |
| `stat` | Large number counting up, with label |
| `quote` | Quotation and attribution |
| `compare` | Before and after, side by side or wipe |
| `outro` | Call to action: heading, install command, URL |
| `custom` | Raw HTML and CSS (see section 8) |

A scene type is one module with four parts: its Zod schema, a compile function
(props to HTML), a browser module (`mount(el, props)` returning `seek(frame)`),
and its doc text. Adding a scene type touches one directory.

### Normalizer

Weak models make small, predictable mistakes. The normalizer accepts and fixes
them, and reports each fix as a warning so the model learns:

- `"5s"` or `"5"` becomes `5`; `"Typewriter"` becomes `"typewriter"`.
- Unknown field or enum value: nearest match by edit distance, as an error with
  the suggestion (`unknown field "subtitle", did you mean "sub"?`).
- A known alias table for common synonyms (`subtitle`, `text`, `body`).

`check` returns the normalized scenefile so the model can adopt it.

## 5. Motion and design system

This is where output quality comes from. Models choose content; the system
owns design.

**Themes** are token sets: colors (background, surface, text, muted, accent),
font families, type scale, spacing scale, corner radius, background treatment,
and a motion personality (easing set, speed multiplier, stagger). v1 ships
four: `midnight`, `paper`, `terminal`, `signal`. A scenefile may override
`accent` with a brand color; the contrast check guards the result.

**Fonts** are bundled as WOFF2 under the SIL Open Font License, so rendering
needs no network. Every theme font must cover Latin and Cyrillic. Text using
glyphs outside the theme's fonts is a `GLYPH_MISSING` error, never a silent
system-font fallback.

**Text fitting.** Each scene declares text slots with a maximum line count and
an allowed range on the type scale. In the browser, the runtime steps a slot
down the scale until it fits. If it cannot fit at the minimum size, that is a
`TEXT_OVERFLOW` error stating the character budget.

**Timing.** Automatic duration is enter time, plus hold, plus exit time. Hold
is the larger of a per-type minimum and the reading time of the scene's text
at 3 words per second (code: per line; terminal: per step).

**Transitions.** `auto` picks from cut, push, wipe, zoom-through, and
crossfade using a table keyed on the pair of scene types, and never repeats
the same transition twice in a row.

**Choreography.** Each scene type has authored enter, hold, and exit motion:
staggered element entry, a slow continuous camera drift so no frame is static,
and exits that hand off to the next transition.

### Determinism contract

`seek(frame)` is a pure function of the frame number. DOM state after
`seek(n)` must not depend on which frames were visited before. Property tweens
use paused Web Animations API animations with `currentTime` set explicitly;
discrete effects (typewriter, counters) compute state from the frame.

Guarantee: the same scenefile, tool version, and Chromium build produce the
same frames. Chromium is pinned through the `playwright-core` version. Font
rasterization differs slightly between operating systems, so byte-identical
output is guaranteed inside the Docker image, not across macOS and Linux.

## 6. Verification

Every diagnostic has the same shape:

```json
{
  "code": "TEXT_OVERFLOW",
  "severity": "error",
  "path": "scenes[2].heading",
  "message": "Heading needs 3 lines at the smallest allowed size; 2 are available.",
  "fix": "Shorten to 42 characters or fewer, or move detail into \"sub\"."
}
```

Errors block rendering. Warnings do not.

| Code | Source | Meaning |
|---|---|---|
| `SCHEMA_*` | normalize | Missing, unknown, or wrongly typed field |
| `AUTOFIXED` | normalize | Input was coerced; shows the corrected value |
| `ASSET_NOT_FOUND` | resolve | Path or URL could not be loaded |
| `ASSET_LOW_RES` | resolve | Image smaller than its display size |
| `TEXT_OVERFLOW` | inspect | Text does not fit its slot |
| `GLYPH_MISSING` | inspect | Characters outside the theme's fonts |
| `CONTRAST_LOW` | resolve | Accent or text below WCAG contrast against background |
| `SAFE_AREA` | inspect | Content outside the format's safe margins |
| `CODE_TOO_LONG` | resolve | More lines than fit; suggests focus range or split |
| `PACING_FAST` / `PACING_SLOW` | resolve | Explicit duration far from reading time |
| `TOTAL_DURATION` | resolve | Video shorter than 3 s or longer than 10 min |

**Storyboard.** `check` also returns a text storyboard: for each scene, its
time range, transition, final font sizes, and line breaks. This is how a
text-only model sees the video.

**Contact sheet.** `preview` renders one representative frame per scene into a
single PNG, for humans and vision models.

**After render.** `ffprobe` confirms duration, frame rate, and resolution;
`blackdetect` flags unexpected black spans. Results are part of the render
report.

## 7. Renderer

- `playwright-core` with the pinned `chromium-headless-shell`, installed on
  first use by `scenefile doctor --install`.
- The composition is served from memory. All other network requests are
  aborted. Assets were fetched by Node during resolve (HTTPS only, size cap,
  timeout) into a content-addressed cache.
- Frame loop: `seek(frame)`, capture through the Chrome DevTools Protocol,
  write PNG bytes to an `ffmpeg` image pipe.
- Parallelism: frame ranges are split across N pages (default: CPU count
  minus one, at most 8). Each range encodes to a segment; segments are joined
  with the concat demuxer, then audio is muxed.
- Output: H.264, yuv420p, `+faststart`, CRF by quality preset
  (`draft`, `standard`, `high`).
- `ffmpeg` and `ffprobe` are taken from the system. `doctor` reports what is
  missing with the install command for the platform. The Docker image contains
  everything.

Performance target, to be measured and published rather than assumed: a 30 s
1080p30 video in under 60 s on an 8-core laptop; `check` in under 3 s.

## 8. Custom scenes and security

`custom` accepts HTML and CSS only. Script elements, event-handler attributes,
and external references are stripped by the compiler. CSS animations are
paused by the runtime and driven through `seek`, so custom scenes stay
deterministic. They go through the same inspect and verify steps.

The MCP server and CLI write only inside the working directory (or a directory
given by `--out`), and read assets only from inside the scenefile's directory
or from HTTPS URLs. Paths that escape are an error.

## 9. Interfaces

### CLI

```
scenefile init [dir]            write an example scenefile
scenefile check <file>          diagnostics + storyboard     (--json)
scenefile preview <file>        contact sheet PNG
scenefile render <file> -o out.mp4   (--fps --quality --workers)
scenefile scenes [type]         list scene types, or docs for one
scenefile themes                list themes
scenefile schema                print JSON Schema
scenefile guide                 print the authoring guide
scenefile doctor [--install]    check Chromium and ffmpeg
scenefile mcp                   start the MCP server on stdio
```

Exit codes: 0 success, 1 diagnostics with errors, 2 environment problem.

### MCP tools

| Tool | Returns |
|---|---|
| `guide` | Authoring guide, under 2,000 tokens |
| `scene_docs` | Fields and one example for a scene type |
| `check` | Diagnostics, normalized scenefile, storyboard |
| `preview` | Contact sheet image and its path |
| `render` | Job id, immediately |
| `job` | Progress, then the render report and output path |

`render` is asynchronous because renders outlast typical tool timeouts.
Scenefiles are accepted inline or by path.

### Agent docs

`skills/scenefile/SKILL.md`, an `AGENTS.md` snippet, and `llms.txt` are
generated from the schema and scene doc text. A test fails if the committed
files differ from the generated output, so docs cannot drift from the code.

## 10. Errors

- User-facing failures are diagnostics, never stack traces.
- Environment failures (no Chromium, no ffmpeg, disk full) are a separate
  class with exit code 2 and a concrete remedy.
- A render that fails partway removes its temporary segments and reports the
  frame range that failed.
- Internal invariant violations throw; the CLI prints the error with a link to
  file an issue.

## 11. Testing

- **Unit** (Vitest): normalizer, resolver, timing, transition selection,
  diagnostics, each scene's compile function.
- **Bad-input corpus**: scenefiles with typical weak-model mistakes, each
  paired with the exact diagnostics expected.
- **Seek purity**: for every scene type, frames reached in random order must
  match the same frames reached in sequence.
- **Golden frames**: fixed scenefiles, sampled frames compared against
  committed PNGs inside the Docker image. One golden set per scene type per
  theme.
- **Integration**: render a 3 s scenefile end to end, assert with `ffprobe`.
- **MCP**: protocol tests through the SDK client, including the async job flow.
- **Docs**: generated agent docs match committed files.
- **CI**: GitHub Actions on Linux (full suite, in Docker) and macOS (all but
  golden frames).

## 12. Done means

1. On a clean macOS or Linux machine with `ffmpeg` installed,
   `npx scenefile render examples/launch.json -o out.mp4` produces a 1080p30
   MP4 that passes its own post-render checks.
2. All ten scene types and `custom` render in all four themes with golden
   tests passing.
3. Every diagnostic code in section 6 has a test that triggers it.
4. The MCP server completes check, preview, render, and job from a real MCP
   client.
5. One live pass with a non-Claude model through an MCP client: given only the
   `guide` tool output and a one-paragraph brief, it reaches a passing
   scenefile. The transcript is committed. Token cap set; one pass, not a loop.
6. The owner watches the example videos and accepts the visual quality.
   Screenshots and frames are reviewed by eye, not only by tests.
7. README states only what the above demonstrates.

## 13. Repository

MIT license. `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, semantic
versioning with Changesets, `examples/`, `docker/`. Node 20 or newer.
