# Changelog

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
