---
name: scenefile-launch-video
description: Use when asked for a launch, announcement or promo video for a project, tool or feature. Builds a short narrated video with scenefile from what the project really does.
---

# Make a launch video

Thirty to sixty seconds that say what the thing is, show it working, and say how to get it.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.

## Steps

1. **Learn what it is** from the README, the code and the person. Write one sentence: what it does and for whom. If you cannot, ask.
2. **Use this shape**, dropping any scene you have no true content for:
   1. `title`: the one sentence, as a short heading.
   2. `statement`: the problem it removes.
   3. `terminal` or `code`: it working, with the real commands or the real code.
   4. `screenshot`: the real interface, if it has one (see the app-walkthrough skill for capturing).
   5. `bullets`: three things it does. Things it does, not adjectives.
   6. `stat` or `chart`: only with a number you can point to in the repository or that you measured, with what was measured.
   7. `outro`: how to get it, with the real install command and address.
3. **No testimonials** unless the person gives you one with a name to attribute it to.
4. For a phone-first video set `"format": "portrait-1080p"`.


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
