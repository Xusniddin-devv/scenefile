# Trial: four inexpensive models, 12 October 2026

A small, informal check of whether models other than the author's can write a
scenefile from the guide alone. It is one run, not a benchmark.

- **Models** (through OpenRouter, ids as given there on the day):
  `deepseek/deepseek-v4-flash-0731`, `minimax/minimax-m3`, `qwen/qwen3.7-flash`,
  `z-ai/glm-5.3-flash`.
- **Input:** the output of `scenefile guide` as the system prompt, and one of three
  one-paragraph briefs (in `trial.mjs`) as the user message. Temperature 0.4.
- **Loop:** the reply was run through `scenefile check`. On errors, the diagnostics were
  sent back and the model tried again, up to three rounds.
- **Result:** 11 of 12 scenefiles passed on the first reply and all 12 by the second.
  The one miss was an empty reply. 13 calls, $0.022 in total.

`results.json` has every round's diagnostics; `runs/` has each model's replies and the
check output for them. The guide has changed since (narration, captions, a chart
scene and new example content), so rerunning `trial.mjs` will not reproduce these
files exactly.

**What it does not show.** There is no control group, so it says nothing about how these
models do without scenefile. Passing `check` means the video is valid and fits the
frame, not that it is good. Several replies invented facts that were not in the brief
(a testimonial, a statistic, web addresses); the guide now tells models not to.
