---
name: scenefile-edit-video
description: Use when asked to edit existing video files on this computer: cut or trim clips, join several into one, fit a phone recording into a wide video, add titles, captions, narration or music. Builds the edit with scenefile and writes a new file; the originals are never changed.
---

# Edit video files into one video

The person has recordings; you turn them into a finished video. Each recording, or part of one, is a `clip` scene. The originals are only read.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.
3. If `scenefile` is not found as a command, put `npx -y` in front of it every time.
4. For a narrated video, run `scenefile voices install en-emma` once first. It is a 320 MB download that can take several minutes: give that one command a long timeout, and do not start it twice.
5. If the person has not said, ask how long the video should be and whether it is for a wide screen or a phone. Otherwise make it wide and under 90 seconds.

## Steps

1. **Find out what there is.** Ask which files, or list the folder. Run `scenefile probe <files>`: it prints each file's size, length in seconds and whether it has sound. You cannot plan a cut without the lengths. Then run `scenefile transcribe <file>` on each clip that has speech: it prints what is said and when, which is how you know where to cut. The first run downloads a 208 MB listening model; give it a long timeout.
2. **Put the scenefile in the same folder as the clips** (or above them): `src` is read from the scenefile's folder, and files outside it are refused.
3. **One `clip` scene per piece of footage, in order.** `from` and `to` are seconds into the file; leave them out to use the whole file. To drop the middle of a recording, use the same file twice with different cuts.
4. **Fit.** The default shows the whole picture inside the frame. `"fit": "cover"` fills the frame and crops; use it when the clip's shape matches the video's. For phone footage in a phone-shaped video, set `"format": "portrait-1080p"`.
5. **Sound.** A clip keeps its own sound. Set `"volume": 0` on a clip you narrate over, or lower it (for example 0.2) to keep it underneath.
6. **Around the clips,** add what was asked for: a `title` at the start, an `outro` at the end, a `statement` between sections, music with the top-level `audio`.
7. **Captions.** To caption what people say in a clip, set `"captions": true` on it: the words are heard from the clip's own sound and shown as they are spoken. `check` lists what it heard under each clip as `heard`; read it, because a small model mishears some words. `caption` instead puts one fixed line under a clip. To add a narrator, write `say` and set `"voice": { "name": "en-emma", "captions": true }`; a narrated line must be shorter than its clip.
8. **You cannot see the footage.** If you can read images, look at frames (for example `ffmpeg -ss 5 -i clip.mp4 -frames:v 1 frame.png`) before describing what is in a clip. Otherwise describe a clip only as the person described it.

## Check, then render

1. Save the scenefile as `edit.json` beside the clips and run `scenefile check edit.json`.
2. Fix every `error` exactly as its `fix:` line says (a cut past the end of a file is the usual one), then check again.
3. Read the storyboard: it lists each clip with its cut and the file's full length.
4. Run `scenefile render edit.json -o final.mp4` and tell the person where the file is.

## Rules that are not negotiable

- Never write over, move or delete the person's files. The output is always a new file.
- Use only facts from the person and the files. Do not invent what a clip shows, or numbers, quotations, names or web addresses.
- Clips are joined with cuts. Do not promise effects scenefile does not have: no colour grading, no speed changes, no transitions through footage, and no correcting of what the captions heard.

## A worked example

`example.json` beside this file is a complete scenefile made this way. It passes `scenefile check` when `first.mp4` and `second.mp4` exist beside it; use it for shape, not for content.
