---
name: scenefile-explain-code
description: Use when asked for a video that explains how some code works: a function, a module, a pull request or a whole project. Reads the real code and turns it into a narrated, captioned explainer with scenefile.
---

# Explain code in a video

The video teaches one thing about the code. You read the code; scenefile draws it.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.

## Steps

1. **Read the code first.** Open the files. Find the one idea worth explaining and the 2 to 4 places in the code that show it. If the request is broad ("explain this repo"), pick what a newcomer needs first: what it does, the main flow, where to start reading.
2. **Outline in plain words** before writing JSON: opening claim, the problem, each step of the mechanism, the result.
3. **Show real code.** Use `code` scenes with lines copied from the files, trimmed to at most 12 lines of at most 60 characters. Shorten by cutting whole lines, never by rewriting what a line does. Use `highlight` for the lines the narration is talking about, and `caption` for the file name.
4. **Use the other scenes for everything that is not code:** `statement` for the idea, `compare` for before and after, `bullets` for a sequence of steps, `terminal` for how to run it, `chart` only for numbers you measured or found in the repository.
5. **Narrate.** Each `say` explains what the viewer is looking at and why it matters. Do not read the code aloud.


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
