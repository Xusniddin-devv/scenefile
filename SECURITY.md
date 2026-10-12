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
- A narrator's voice is downloaded from one fixed address and used only if its checksum
  matches.

A way around any of these is a vulnerability, and so is anything that lets a scenefile
exhaust the machine without limit.

## Out of scope

Bugs in ffmpeg, Chromium or the speech engine themselves should go to those projects;
tell us too if scenefile makes one reachable.
