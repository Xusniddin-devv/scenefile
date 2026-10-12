# scenefile Plan 3a — MCP Server and Agent Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Any model, through any MCP client, can learn the scenefile format in one call, check a scenefile, and render it, without a shell and without leaving the folder the server was started in.

**Architecture:** Every scene type documents itself (purpose, fields, a working example); the engine assembles those into one short authoring guide, so the guide cannot drift from the code. The steps the CLI performs before rendering (load files, check, confirm music, measure layout) move into one function that the CLI and the MCP server share. The MCP server exposes five tools over stdio and confines every path it is given to its root folder.

**Tech Stack:** As before, plus `@modelcontextprotocol/sdk` (MIT), pinned.

**Spec:** `docs/superpowers/specs/2026-10-12-scenefile-v1-design.md` (§8 security, §9 interfaces)

## Order of work, changed

The engine can now make a complete video. This plan comes before frame-exact Docker tests, more themes and the `custom` scene because it is what lets a model other than the one that wrote the engine use it, which is the reason the project exists.

## Decisions

- **Tools:** `guide`, `scene_docs`, `check`, `render`, `job`. `render` returns a job id at once; `job` reports progress and the result. One render runs at a time; others wait in line.
- **A scenefile reaches the server inline (an object, or JSON text) or as a path.** Inline scenefiles resolve their images against the server's root.
- **Everything stays inside the root.** Scenefile paths, image and music paths, and output paths are confined to the folder the server was started in (links followed before deciding). The root may not be the filesystem root.
- **Remote images are off by default in the server** and on in the CLI. A model handed a scenefile by an untrusted party should not make the server fetch addresses. `--allow-remote-images` turns them on.
- **The guide is generated, never hand-edited**, and stays under 2,000 tokens (tested as under 8,000 characters). `skills/scenefile/SKILL.md` is the same text with front matter, and a test fails if the committed file differs from what the code generates.
- **`preview` (contact sheet) and `doctor` are deferred** to the release plan.

## Global Constraints

All earlier constraints apply. In addition:

- The server writes protocol messages to standard output and nothing else; anything for a human goes to standard error.
- A tool never throws for a problem with the caller's input: it returns a result marked as an error, with text the model can act on.
- No tool reads or writes outside the root.
- Scene documentation lives beside the scene's code, and each scene's example passes a full check.
- No `Co-Authored-By` trailer on commits.

## Review Focus

1. **Paths that leave the root**, in every tool argument that takes one: `..`, absolute paths, links out, an output path equal to an existing non-video file, an output path in a folder that does not exist yet.
2. **Remote images through the server** with the default settings.
3. **A second render while one is running; a job id that does not exist; the server stopped mid-render.**
4. **Scenefile passed as JSON text with a code fence around it**, as models do.
5. **The guide alone is enough.** A model given only the `guide` tool's text and a one-paragraph brief should be able to write a scenefile that passes `check` within two rounds. (Measured with a real non-Claude model in the release plan; here, judged by reading.)

## Tasks

### Task 1: Scenes document themselves; the engine writes the guide

- `SceneDefinition.doc: { purpose: string; fields: Record<string, string>; example: Record<string, unknown> }` for all ten scene types.
- `packages/engine/src/guide.ts`: `authoringGuide(): string`, `sceneGuide(type): string`, `formatDiagnostics(diagnostics): string` (moved from the CLI).
- Tests: every field of every scene (other than `type`, `duration`, `transition`) is documented and nothing else is; every example passes `check` with images stubbed; the guide names every scene type and top-level field, includes the workflow and the diagnostic format, and is under 8,000 characters; `sceneGuide` shows the fields and the example as JSON.

### Task 2: One shared "prepare" step; remote images optional

- `packages/render/src/prepare.ts`: `prepareScenefile(input, options): Promise<CheckResult>` with `options: { baseDir; allowRemote?; inspect?; hasSound? }`; the CLI's `load` uses it.
- `AssetSources.allowRemote?: boolean` (default true); when false, an address is refused before any lookup.
- `isInside` exported from the engine.
- Tests: remote refused when off, with a fix that says to save the file locally; the CLI behaves exactly as before.

### Task 3: The MCP server

- `packages/mcp`: `createServer(options): McpServer` with `options: { root; allowRemoteImages?; render?; inspect?; hasSound? }` (the last three are seams for tests); `scenefile mcp [--root <dir>] [--allow-remote-images]` starts it on stdio.
- Tools and their results as in Decisions. `check` and `render` accept `scenefile` (object or text) or `path`, never both.
- Tests, through the SDK's in-memory transport: tool list; `guide` and `scene_docs`; `check` on valid, invalid, fenced-text and path inputs; every path-escape in Review Focus 1; remote images refused by default and allowed with the option; `render` returns a job, `job` reports progress then the result; a failing render reports failure; an unknown job id; two renders queue; one real render end to end.

### Task 4: Remaining CLI commands, the skill file, and the README

- `scenefile guide`, `scenefile scenes [type]`, `scenefile schema`, `scenefile init [dir]`.
- `skills/scenefile/SKILL.md` generated by `pnpm docs`, with a test that it is current.
- README: how to add the server to an MCP client, what it can and cannot touch.

## Left for later

| Item | Plan |
|---|---|
| `preview` contact sheet, `doctor`, asset cache | Release plan |
| A real run with a non-Claude model through an MCP client | Release plan |
| CI, Changesets, publishing to npm, the real repository address | Release plan |
| Frame-exact Docker tests; themes `paper`, `terminal`; `custom` scene | 2c-3, 2b-3 |
