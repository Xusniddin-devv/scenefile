# scenefile

Turn a small JSON file into a video. Built so that any language model, including
ones that cannot see images, can produce a correct video and fix its own mistakes.

**Status: early development.** Ten scene types (`title`, `statement`, `quote`,
`bullets`, `stat`, `code`, `screenshot`, `compare`, `outro`, `terminal`) and two themes
(`signal`, the default, and `midnight`) work today. Fonts are bundled, so Latin and
Cyrillic text is drawn the same on every machine; emoji use the machine's own emoji
font. Not yet published to npm.

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
    { "type": "title", "heading": "Ship faster", "highlight": "faster", "sub": "A CLI for X" },
    { "type": "terminal", "steps": [{ "run": "npx x init", "output": "Done in 2s" }] }
  ]
}
```

Durations are worked out from how long the text takes to read, and text is sized to
fit. `check` measures the layout in a real browser and reports problems as text, each
with the path of the field and how to fix it:

```
error  TEXT_OVERFLOW  scenes[0].heading
  This text needs 4 lines at its smallest size; only 3 fit.
  fix: Shorten it to about 51 characters (it has 77).
```

```
error  SCHEMA_UNKNOWN_SCENE  scenes[0].type
  Unknown scene type "titel". Did you mean "title"?
  fix: "type" must be one of: title, statement, quote, bullets, stat, code, outro, screenshot, compare, terminal.
```

## Use from an AI agent

**With a shell** (Claude Code, Codex, and similar): `skills/scenefile/SKILL.md` is a
skill file that teaches the format and the commands. `scenefile guide` prints the
same guide; `scenefile scenes <type>` one scene type in full; `scenefile schema` a JSON
Schema for tools that can enforce one on a model's output.

**Through MCP** (any client that speaks the Model Context Protocol, with any model):

```json
{
  "mcpServers": {
    "scenefile": {
      "command": "node",
      "args": ["/path/to/scenefile/packages/cli/dist/main.js", "mcp", "--root", "/path/to/your/project"]
    }
  }
}
```

The server offers five tools: `guide` (how to write a scenefile, in about 2,000 tokens),
`scene_docs`, `check`, `render` (returns a job id at once) and `job` (progress, then the
finished file; it can also cancel). A scenefile can be passed inline or as a path.

What the server can touch:

- It reads and writes only inside `--root` (the folder it was started in, if not given).
  Paths that leave it, or links that lead out of it, are refused.
- Inside the root it can read any scenefile, image or music file it is pointed at, and a
  failed check may quote a few characters of a file that was not a scenefile.
- It does not replace an existing file unless the caller passes `overwrite: true`.
- It does not download images unless started with `--allow-remote-images`.
- It renders one video at a time, keeps at most five waiting, and stops at once when
  its client disconnects.

The guide and the skill file are generated from the scene types themselves
(`pnpm generate`), and a test fails if they fall out of step.

Tried on 12 October 2026 with four inexpensive models through OpenRouter (DeepSeek v4
flash, MiniMax M3, Qwen 3.7 flash, GLM 5.3 flash), each given only the guide and a
one-paragraph brief, three briefs each: 11 of 12 scenefiles passed the full check on the
first reply and all 12 by the second. That is one run of a small test, not a benchmark.

## Narration

Give a scene a `say` line and it is read aloud; the scene stays on screen until the
line has been said, and music turns itself down under the voice.

```json
{ "version": 1, "voice": { "name": "en-joe" },
  "scenes": [{ "type": "title", "heading": "Ship faster", "say": "This tool deploys your site with one command." }] }
```

The voice is made on your machine by an open speech model ([Piper](https://github.com/rhasspy/piper)
voices run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)). There is no
account, no key and no charge, and the text is not sent anywhere. A voice is downloaded
once (about 67 MB), from a fixed address, and checked against a known checksum.

| Voice | Language | Recordings licensed as |
|---|---|---|
| `en-joe`, `en-kristin`, `en-bryce` | English | CC0 / public domain |
| `ru-denis`, `ru-dmitri` | Russian | CC0 |

`scenefile voices` lists them; `scenefile voices install <name>` downloads one ahead of
time. The MCP server never downloads: it uses voices that are already installed.

What it is not: these voices are clear but plainly synthetic, there is no Uzbek voice
yet (no freely licensed one exists in this family), and there are no captions yet.

## Themes

`signal` (black, lime), `midnight` (black, orange), `paper` (white, red), `cobalt`
(blue, yellow), `solar` (yellow, blue). Set `"theme"`, and optionally your own `"accent"`.

## Transitions

Scenes give way to one another by `cut`, `fade`, `crossfade`, `push`, `wipe` or `zoom`.
Left alone, the engine picks one that suits the scene being arrived at, and its own
picks never use the same one twice running. Set `"transition"` on the scenefile to use
one kind throughout, or on a scene to choose how that scene arrives (it is ignored on
the first scene).

`crossfade`, `push`, `wipe` and `zoom` take half a second, during which both scenes are
on screen. That half second belongs to both scenes' durations, so a video is shorter
than its durations added up. The storyboard says so for each scene:

```
2. statement  5.17s-11.70s  Models are good at saying...  (enters by push over 0.50s)
```

## Music

```json
{ "version": 1, "audio": { "src": "bed.mp3", "volume": 0.4 }, "scenes": [ ... ] }
```

`audio.src` names a music file in the scenefile's own folder: MP3, WAV, M4A, AAC, Ogg or
FLAC, up to 30 MB. It plays under the whole video, repeated if it is shorter and cut if
it is longer, fading in over half a second and out over the last second and a half.
`volume` runs from 0 to 1. No music is bundled with scenefile.

## Speed

Rendering uses several browsers at once: by default half the machine's cores, at most
four (`--workers` changes it). The video is rendered in five-second segments that are
joined afterwards, and the finished file is the same whatever the number of workers.

Measured with `pnpm bench` on `examples/launch.json` (1920x1080, 30 fps, 52 s) on an
8-core Apple M1, 12 October 2026:

| Workers | Render time | Compared with the video's length |
|---|---|---|
| 1 | 62 s | 0.84x |
| 2 | 36 s | 1.5x |
| 4 | 30 s | 1.7x |

## Images, files and the network

A scenefile can show images (`screenshot` and `compare` scenes). `check` and `render`
load them, which means reading files and, for `https` addresses, making requests:

- Local images must be inside the scenefile's own folder; links leading out of it are not followed.
- Remote images must be `https` on the public internet. Addresses on this machine or a
  private network are refused, including through redirects.
- PNG, JPEG and still WebP, up to 8 MB each and 32 MB in total.

## Development

```bash
pnpm test        # builds, then runs every test, including real renders
pnpm typecheck
```

## License

MIT
