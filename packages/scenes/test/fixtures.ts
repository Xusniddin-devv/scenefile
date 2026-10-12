import type { SceneType } from "../src/index";

/** One ordinary example of every scene type. A new scene type must be added here. */
export const FIXTURES: Record<SceneType, Record<string, unknown>> = {
  title: { type: "title", heading: "Video from JSON.", highlight: "JSON.", sub: "Any model can write a scenefile." },
  statement: { type: "statement", text: "Describe the scenes. The engine does the rest.", highlight: "The engine" },
  quote: { type: "quote", text: "It rendered correctly on the first try.", author: "Dilnoza K.", role: "Staff engineer" },
  bullets: { type: "bullets", heading: "Why it works", items: ["Write JSON, not keyframes", "Errors a model can fix", "Same input, same frames"] },
  chart: { type: "chart", heading: "Median build time", unit: "s", bars: [{ label: "Webpack", value: 48 }, { label: "Vite", value: 12 }, { label: "Ours", value: 3 }], highlight: "Ours" },
  stat: { type: "stat", value: "1,200+", label: "videos rendered", note: "In the first week, from four different models." },
  code: {
    type: "code",
    lang: "typescript",
    source: 'import { render } from "scenefile";\n\nconst video = await render({\n  version: 1,\n  scenes: [{ type: "title", heading: "Ship faster" }],\n});',
    highlight: [5],
    caption: "One call. One file. One video.",
  },
  outro: { type: "outro", heading: "Make your first video.", highlight: "first video.", command: "npx scenefile init", url: "scenefile.dev" },
  screenshot: {
    type: "screenshot",
    src: "assets/shot.png",
    url: "scenefile.dev/gallery",
    caption: "Every frame comes from one file.",
    callouts: [{ x: 0.25, y: 0.3, label: "Scene counter" }, { x: 0.7, y: 0.6, label: "Fitted text" }],
  },
  compare: {
    type: "compare",
    before: { text: "Forty lines of animation code the model cannot check." },
    after: { label: "With scenefile", text: "Six lines of JSON it can." },
  },
  terminal: { type: "terminal", steps: [{ run: "scenefile check a.json", output: "No problems found." }] },
};

const NASTY = `<u>x</u> & "q" '</script><img src=x onerror=1>`;

const SHORT_NASTY = `<u>x</u>&"'<img src=x>`;

/** The same scenes with markup in every text field. None of it may become an element. */
export const HOSTILE: Record<SceneType, Record<string, unknown>> = {
  title: { type: "title", heading: NASTY, highlight: "<u>x</u>", sub: NASTY },
  statement: { type: "statement", text: NASTY, highlight: "<u>x</u>" },
  quote: { type: "quote", text: NASTY, author: NASTY, role: NASTY },
  bullets: { type: "bullets", heading: NASTY, items: [NASTY, NASTY] },
  chart: { type: "chart", heading: NASTY, unit: "<b>", bars: [{ label: "<i>a</i>", value: 2 }, { label: "<u>b</u>", value: 1 }], highlight: "<i>a</i>" },
  stat: { type: "stat", value: "<u>9</u>", label: NASTY, note: NASTY },
  code: { type: "code", lang: "html", source: `${NASTY}\n<script>alert(1)</script>`, highlight: [1], caption: NASTY },
  outro: { type: "outro", heading: NASTY, highlight: "<u>x</u>", command: NASTY, url: NASTY },
  screenshot: { type: "screenshot", src: NASTY, url: NASTY, caption: NASTY, callouts: [{ x: 0.5, y: 0.5, label: SHORT_NASTY }] },
  compare: { type: "compare", before: { label: SHORT_NASTY, text: NASTY }, after: { label: SHORT_NASTY, src: NASTY } },
  terminal: { type: "terminal", steps: [{ run: NASTY, output: NASTY }] },
};

/** Every fixture, in registry order: a video that uses all scene types. */
export const ALL_SCENES: Record<string, unknown>[] = Object.values(FIXTURES);
