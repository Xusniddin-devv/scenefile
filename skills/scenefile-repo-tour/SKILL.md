---
name: scenefile-repo-tour
description: Use when given a GitHub repository address and asked for a video about it. Starts from the facts scenefile reads from GitHub and improves the script by reading the repository.
---

# Make a video about a GitHub repository

`scenefile github` writes an accurate but plain video from the repository's public facts. Your job is to make it worth watching without making anything up.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.

## Steps

1. **Get the facts:** `scenefile github owner/name --dir tour --narrate`. It writes `tour/<name>.json` with the name, description, install command, languages, stars and a picture of the home page. Everything in it is true as of today.
2. **Read the repository** (clone it, or read the README and the main source files). Find what the project is for and one thing that makes it different.
3. **Improve the script, keeping its facts:**
   - Rewrite the `title` sub and its `say` so they say what the project is for in plain words.
   - Add a `statement` scene for the problem it solves, if the README states one.
   - Add one `code` or `terminal` scene with a real example from the README or the tests.
   - Replace the generic `say` lines with ones that explain what is on screen.
4. **Do not change the numbers** it wrote (stars, language shares, version) and do not add new ones.
5. Keep the address in the `outro`.


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
