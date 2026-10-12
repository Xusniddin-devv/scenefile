---
name: scenefile-changelog-video
description: Use when asked for a video about a release, a changelog, release notes or "what changed". Builds a short update video with scenefile from the real commits and release notes.
---

# Make a release video

What changed in this version, for people who already use the project.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.

## Steps

1. **Get the changes from the source:** `CHANGELOG.md`, the release notes, or `git log <last tag>..HEAD --oneline`. Use the version number and date that are written there.
2. **Pick at most five changes** that a user would notice. Group small fixes into one line; leave out internal refactors.
3. **Use this shape:**
   1. `title`: the project and version, for example "scenefile 0.2".
   2. One scene per headline change: `terminal` for a new command (the real command), `code` for a new option (real syntax), `screenshot` for something visible, `compare` for a behaviour that changed (before and after, both true).
   3. `bullets`: the smaller changes, one short line each.
   4. `outro`: how to upgrade, with the real command.
4. **Say nothing about speed, size or counts** unless the changelog or a measurement you ran gives the number.


## Check, then render

1. Save the scenefile as `video.json` and run `scenefile check video.json`.
2. Fix every `error` exactly as its `fix:` line says, then check again. Read the warnings; fix the ones that are about your content.
3. Read the storyboard that `check` prints: it is the video in words. Make sure it says what you meant.
4. Run `scenefile render video.json -o video.mp4` and tell the person where the file is.

## Rules that are not negotiable

- Use only facts from the code, the commit history, the running app or the person. Do not invent numbers, quotations, names, benchmarks or web addresses. If you do not know something, leave it out.
- One point per scene, 5 to 9 scenes, under 90 seconds unless asked otherwise.
- If you narrate, narrate every scene: write `say` as full spoken sentences with numbers as words, and set `"voice": { "name": "en-emma", "captions": true }` (or `"en-george"`; `"ru-denis"` for Russian).
- Text on screen is short; the narration carries the explanation.

## A worked example

`example.json` beside this file is a complete scenefile made this way. It passes `scenefile check`; use it for shape, not for content.
