---
name: scenefile
description: Make a video (MP4) from a JSON description of its scenes - product launch videos, explainers, short clips for social media. Use when asked to create a video, a product demo, or an animated summary of a project. Needs the scenefile command.
---

## Commands

```
scenefile check video.json                 # problems, each with a fix, and a text storyboard
scenefile render video.json -o video.mp4   # the video; takes about as long as the video lasts
scenefile scenes <type>                    # one scene type in full
```

Write the scenefile to a file, run `check`, fix what it reports, repeat until there are no errors, then `render`.

# Making a video with scenefile

A scenefile is a JSON object that says what each scene of a video shows. You never set positions, sizes, colors or timing: the engine lays scenes out, sizes text to fit, times each scene by how long it takes to read, and chooses transitions.

## How to work

1. Write the scenefile.
2. Check it. Each problem has a `code`, a `path` to the field (such as `scenes[2].heading`), a message, and a `fix`.
3. Do what each `fix` says, then check again. Errors must be fixed; warnings may be left.
4. When there are no errors, render it to an `.mp4`.

## A complete scenefile

```json
{
  "version": 1,
  "scenes": [
    {
      "type": "title",
      "heading": "Video from JSON",
      "highlight": "JSON",
      "sub": "Describe the scenes. The engine draws and times them."
    },
    {
      "type": "terminal",
      "steps": [
        {
          "run": "scenefile check video.json",
          "output": "No problems found."
        }
      ]
    },
    {
      "type": "stat",
      "value": "11",
      "label": "scene types"
    },
    {
      "type": "outro",
      "heading": "Write JSON. Get a video.",
      "highlight": "Get a video.",
      "command": "scenefile init"
    }
  ]
}
```

## Fields of the scenefile

- `version`: Always 1. Required.
- `format`: "landscape-1080p" (default), "portrait-1080p" for phones, or "square-1080p".
- `fps`: 30 (default) or 60.
- `theme`: The look. Black: "signal" (default, lime), "midnight" (orange), "terminal" (monospace, green), "ink" (wide type, red). White: "paper" (red), "studio" (blue). Color: "cobalt" (blue), "solar" (yellow), "mint" (green), "forest" (dark green).
- `accent`: The accent color as "#RRGGBB". Leave it out to use the theme's.
- `audio`: Music under the whole video: { "src": "music.mp3", "volume": 0.4 }. A file in the scenefile's folder.
- `voice`: Who reads the `say` lines aloud: { "name": "en-kristin", "captions": true }. English: "en-kristin" (default), "en-joe", "en-bryce". Russian: "ru-denis", "ru-dmitri". No other languages. `captions` also shows the words on screen.
- `transition`: How scenes change: "auto" (default), "cut", "fade", "crossfade", "push", "wipe" or "zoom".
- `scenes`: The scenes, in order. Required: 1 to 60.

## Scene types

Every scene needs `type`. Any scene may also set `duration` (seconds on screen, up to 120; leave it out and the scene is timed by how long it takes to read) `transition` (how it arrives, if not the scenefile's) and `say` (a sentence for the narrator to speak, up to 500 characters; the scene stays until it has been said).

### title
An opening or section heading: one large line, with an optional smaller line beside it.
- `heading`: The large line. Required, up to 80 characters; two to five words read best.
- `highlight`: A part of the heading, copied exactly, to draw in the accent color.
- `sub`: A supporting sentence beside the heading, up to 140 characters.
Example: `{"type":"title","heading":"Video from JSON","highlight":"JSON","sub":"Describe the scenes. The engine draws and times them."}`

### statement
One sentence that fills the frame, arriving word by word.
- `text`: The sentence. Required, up to 140 characters.
- `highlight`: A part of the text, copied exactly, to draw in the accent color.
Example: `{"type":"statement","text":"Describe what the video shows. The engine does the drawing.","highlight":"The engine does the drawing."}`

### quote
Something a person said, with who said it.
- `text`: The quotation, without quote marks. Required, up to 220 characters.
- `author`: Who said it, up to 60 characters.
- `role`: Their job or company, up to 60 characters. Needs author.
Example: `{"type":"quote","text":"Premature optimization is the root of all evil.","author":"Donald Knuth","role":"Computer scientist"}`

### bullets
Two to five short points that light up one after another.
- `heading`: A line above the list, up to 60 characters.
- `items`: The points: a list of 2 to 5 strings, each up to 70 characters. Required.
Example: `{"type":"bullets","heading":"What check does","items":["Reads the layout in a real browser","Reports problems as plain text","Gives a fix for each one"]}`

### stat
One large figure that counts up, with a label.
- `value`: The figure as text with its unit, up to 12 characters: "94%", "3.5x", "1,200+". Required.
- `label`: What the figure measures, up to 50 characters. Required.
- `note`: A sentence of context, up to 120 characters.
Example: `{"type":"stat","value":"11","label":"scene types","note":"Each one is sized and timed for you."}`

### code
Source code with line numbers; chosen lines can be marked so they stand out.
- `lang`: The language: "typescript", "python", "bash", "json", "go", "rust" and others, or "text".
- `source`: The code. Required, at most 12 lines; keep each line under 60 characters. Use \n between lines.
- `highlight`: Line numbers, counted from 1, to mark: [2, 3].
- `caption`: A line under the code, up to 80 characters.
Example: `{"type":"code","lang":"bash","source":"scenefile check video.json\nscenefile render video.json -o video.mp4","highlight":[2],"caption":"Two commands from JSON to video."}`

### outro
The closing scene: a last line, with a command to run or an address to visit.
- `heading`: The closing line. Required, up to 60 characters.
- `highlight`: A part of the heading, copied exactly, to draw in the accent color.
- `command`: A command for the viewer to run, up to 80 characters. It is typed out.
- `url`: An address, up to 80 characters.
Example: `{"type":"outro","heading":"Write JSON. Get a video.","highlight":"Get a video.","command":"scenefile init"}`

### screenshot
An image, such as a screenshot, with an optional address bar, caption and up to three callouts.
- `src`: The image: a PNG, JPEG or WebP file in the scenefile's folder. Required.
- `url`: An address to show above the image, up to 80 characters.
- `caption`: A line under the image, up to 80 characters.
- `device`: Set to "phone" to draw a tall mobile screenshot inside a phone.
- `callouts`: Up to 3 pointers: { "x": 0.5, "y": 0.5, "label": "up to 40 characters" }. x and y are fractions of the image, from its left and top.
Example: `{"type":"screenshot","src":"dashboard.png","caption":"Your own screenshot, framed and captioned."}`

### compare
Before and after, side by side.
- `before`: The old way: { "label": "up to 24 characters, optional", "text": "up to 160 characters" } or { "src": "image file" }. Required.
- `after`: The new way, in the same form. Required.
Example: `{"type":"compare","before":{"label":"By hand","text":"Draw and time every frame."},"after":{"label":"With a scenefile","text":"List the scenes."}}`

### chart
Two to six numbers compared as bars that grow, such as speeds, sizes or prices.
- `heading`: What is being measured, up to 60 characters.
- `bars`: The bars: a list of 2 to 6 of { "label": up to 28 characters, "value": a number, 0 or more }. Required.
- `unit`: Written after each value, up to 6 characters: "ms", "%", "x".
- `highlight`: The label of the one bar to draw in the accent color, copied exactly.
Example: `{"type":"chart","heading":"Seconds to render a 52 second video","unit":"s","bars":[{"label":"1 worker","value":62},{"label":"4 workers","value":30}],"highlight":"4 workers"}`

### terminal
Commands typed into a terminal, each followed by what it prints.
- `steps`: A list of 1 to 6 steps: { "run": "command up to 120 characters", "output": "what it prints, up to 400, optional" }. Required.
Example: `{"type":"terminal","steps":[{"run":"scenefile check video.json","output":"No problems found."}]}`

## Rules that save a round of fixes

- Use only the facts you were given. Do not invent numbers, quotations, people's names or web addresses.
- Keep text short. If check reports `TEXT_OVERFLOW`, shorten the text to the number of characters it gives.
- The whole video must last between 3 seconds and 10 minutes.
- `highlight` must be copied exactly, letter for letter, from the text it belongs to.
- In `say`, write full spoken sentences in the voice's language, with numbers and symbols as words ("sixty times", not "60x"). Narrate every scene or none.
- Images and music are files in the same folder as the scenefile, named by their file name.
- Write in Latin or Cyrillic letters. Avoid arrows, check marks and emoji: write "->" and "ok".
- A good video has 5 to 9 scenes, opens with `title`, closes with `outro`, and makes one point per scene.
