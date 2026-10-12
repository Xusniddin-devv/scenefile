# Security

## Reporting a problem

Please report security problems privately through the repository's **Security** tab
("Report a vulnerability") rather than in a public issue. You should hear back within a
week.

## What scenefile treats as untrusted

A scenefile is often written by a language model, which may be following instructions
from text it was asked to read. So the scenefile, and every call to the MCP server, is
treated as hostile:

- Text from a scenefile never becomes markup or a shell argument, and only a validated
  six-digit colour reaches CSS.
- The page that draws the video runs with all network requests blocked.
- Images are read only from the scenefile's own folder, or over https from public
  addresses with redirects, size and private-network ranges checked. Music is local only.
- The MCP server reads and writes only inside the folder it was started with, does not
  download images unless started with `--allow-remote-images`, never downloads a voice,
  and does not replace an existing file unless asked to.
- `scenefile capture`, and the MCP `capture` tool when the server is started with
  `--allow-capture`, open whatever http address they are given, by design: the page's
  code runs (in the browser's sandbox where the system provides one), and `localhost`
  and private addresses are reachable. Through MCP, link-local addresses are refused,
  each capture is stopped after a minute, and the picture is confined to the root. A
  model allowed to capture can still fetch internal pages and encode what it knows in
  the address it asks for, so the flag is for models you trust with that.
- A narrator's voice is downloaded from one fixed address and used only if its checksum
  matches.

A way around any of these is a vulnerability, and so is anything that lets a scenefile
exhaust the machine without limit.

## Out of scope

Bugs in ffmpeg, Chromium or the speech engine themselves should go to those projects;
tell us too if scenefile makes one reachable.
