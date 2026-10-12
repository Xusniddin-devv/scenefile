# Contributing

Thanks for looking. This file says how to get the project running and what a change
needs before it can be merged.

## Set up

You need Node 20 or newer, pnpm, and `ffmpeg` on your `PATH`.

```bash
pnpm install
pnpm --filter @scenefile/render exec playwright-core install chromium --only-shell
pnpm build
node packages/cli/dist/main.js doctor
```

`doctor` lists anything still missing.

## Checks

```bash
pnpm test         # builds, then runs every test (about two minutes)
pnpm typecheck
pnpm generate     # rewrites skills/scenefile/SKILL.md from the scene types
node scripts/pack-test.mjs   # installs the packed packages elsewhere and renders a video
```

CI runs all four on every pull request.

## How the code is laid out

| Package | What it does |
|---|---|
| `packages/schema` | The scenefile format: validation, repair of common slips, diagnostics. |
| `packages/scenes` | One folder per scene type: its schema, its HTML and CSS, its animation, its documentation. |
| `packages/engine` | Timing, the checks that need no browser, and the single HTML page a video is drawn from. |
| `packages/runtime` | The script inside that page: fits text and draws any frame on request. |
| `packages/render` | Chromium capture, ffmpeg, local narration. |
| `packages/cli`, `packages/mcp` | The command line and the MCP server. |

## What a change needs

- **A test that fails without it.** Write the test first and watch it fail.
- **Look at the frames.** For anything that changes what is drawn, render it and look;
  tests of the page's structure do not see what a viewer sees.
- **The same input gives the same pixels.** A frame may depend only on its number: no
  clocks, no randomness, no network. `packages/render/test` has tests that capture a
  frame after visiting others and compare bytes; run them after any CSS change.
- **Every diagnostic says how to fix it.** The reader is often a language model with no
  eyes: give the path of the field, what is wrong, and one concrete fix.
- **Untrusted input.** A scenefile may be written by a model following hostile text.
  Nothing from it may become markup, reach a shell, or read or fetch outside what the
  README's "Images, files and the network" section allows.
- **Say only what is shown.** Numbers in the README and examples are measured, with the
  machine and date. Do not add invented statistics or testimonials, even as samples.

## Adding a scene type

Copy `packages/scenes/src/bullets`, then register the new type in
`packages/scenes/src/index.ts` and `browser.ts`, give it a preferred transition in
`packages/engine/src/transitions.ts`, and add it to both lists in
`packages/scenes/test/fixtures.ts`. The conformance tests then tell you what is missing.
The mount file runs in the browser and must not import the schema or definition.

## Adding a voice

Voices are listed in `packages/render/src/voice.ts` with a checksum. Read the voice's
model card first and record where its training data came from; a voice whose terms are
unclear is not added.
