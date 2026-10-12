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
