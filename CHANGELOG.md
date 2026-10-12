# Changelog

## 0.3.0 (13 October 2026)

Version 0.2.0 was never fully published (only one of its seven packages reached npm),
so this release carries everything listed here.

- Two natural English voices, `en-emma` (now the default) and `en-george`, from the
  Kokoro model. `"voice": "female"` or `"male"` picks one.
- A Claude Code plugin, and five recipe skills for coding agents: explain code, walk
  through an app, launch video, release video, repository tour.
- `scenefile capture <url>` saves a picture of a web page, at desktop or phone size,
  for use in a `screenshot` scene. The MCP server offers it as a tool when started
  with `--allow-capture`.
- `scenefile github <owner/name>` builds a scenefile, and a video, from a repository's
  public facts and the commands in its README. No model is involved.
- `screenshot` scenes take `"device": "phone"` to draw a tall screenshot inside a phone.
- Five more themes (`terminal`, `ink`, `mint`, `studio`, `forest`) and two more bundled
  typefaces (Unbounded, Geologica). Headings and other heavy text are set in each
  theme's own display face.

## 0.1.0 (12 October 2026)

First version.

- A scenefile (JSON) becomes an MP4: eleven scene types (`title`, `statement`, `quote`,
  `bullets`, `stat`, `chart`, `code`, `screenshot`, `compare`, `outro`, `terminal`),
  five themes, three formats (landscape, portrait, square), six transitions.
- `check` validates, measures the layout in a browser, and reports each problem with the
  field's path and a fix; common slips are repaired and reported.
- Narration made on the user's machine in English and Russian, captions, and a music
  bed that gives way to the voice.
- Parallel rendering; the same scenefile gives the same video on the same machine.
- For agents: `guide`, `scenes`, `schema`, a generated skill file, and an MCP server
  confined to one folder.
- `setup`, `doctor`, `init`, `voices`.
