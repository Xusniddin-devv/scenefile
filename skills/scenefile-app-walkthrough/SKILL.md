---
name: scenefile-app-walkthrough
description: Use when asked for a video that shows a web app or site: a product demo, a feature tour or onboarding. Captures real screens of the running app with scenefile and builds a narrated walkthrough.
---

# Walk through an app in a video

The video shows the real app. You capture its screens, and record it being used; scenefile frames and narrates them.

## Before you start

1. Run `scenefile doctor` (or `npx -y scenefile doctor`). If it is not ready, run `scenefile setup` and install `ffmpeg` as it says.
2. Run `scenefile guide` once and keep to it: it is the whole format, and it is short.
3. If `scenefile` is not found as a command, put `npx -y` in front of it every time.
4. For a narrated video, run `scenefile voices install en-emma` once first. It is a 320 MB download that can take several minutes: give that one command a long timeout, and do not start it twice.
5. If the person has not said, ask how long the video should be and whether it is for a wide screen or a phone. Otherwise make it wide and under 90 seconds.

## Steps

1. **Find the address.** Ask the person for the running app's address, or start the dev server the project documents and use its local address (for example `http://localhost:3000`).
2. **Capture each screen you will show**, in the scenefile's folder:
   - `scenefile capture http://localhost:3000/ -o home.png`
   - `scenefile capture http://localhost:3000/ -o home-phone.png --device phone` for a phone-sized picture.
   Read what it prints: it gives the page title and the exact `screenshot` scene to use. If it says the page answered with an error, or needs signing in, tell the person; do not use that picture.
3. **Record what the app does**, where a still picture cannot show it (typing into a form, a click that changes the page). Write the steps a person would take to a file, then record them:
   ```json
   [{ "type": "ada@example.com", "into": "#email" }, { "click": "text=Continue" }, { "wait": 1 }]
   ```
   `scenefile record http://localhost:3000/ --steps steps.json -o signup.mp4`
   Selectors are CSS (`#email`, `button.primary`) or `text=` with words shown on the page; take them from the app's code. Other steps: `{ "hover": "..." }`, `{ "press": "Enter" }`, `{ "scroll": 600 }` or `{ "scroll": "#pricing" }`, `{ "goto": "/settings" }`. It prints the `clip` scene to use and the second each step happens at: write that scene's `say` to match. If it says a step could not be done, fix that step's selector and record again.
4. **Look at the picture if you can read images.** If you cannot, describe the screen only from the page's code and title, and do not use `callouts`: they need positions you cannot see.
5. **One screen or recording per scene**, in the order a person would use the app, each with a `say` line that explains what the person does there and what they get. When you narrate with captions, leave `caption` and `url` off the screenshot scenes: the picture is then drawn as large as the frame allows, and the captions already carry the words. Use `"device": "phone"` for phone pictures.
6. **Open with a `title`** that names what the app is for, and **close with an `outro`** that says where to get it.
7. Screens behind a sign-in cannot be captured unless the steps sign in with a test account the person gives you; never type a real password. Ask the person for screenshots of those and use the files the same way.


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
