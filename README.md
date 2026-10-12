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
