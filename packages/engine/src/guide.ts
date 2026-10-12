import type { Diagnostic } from "@scenefile/schema";
import { SCENE_TYPES, type SceneType, getScene } from "@scenefile/scenes";

/** The scenefile's own fields, as a writer needs to know them. Tests require this to match the schema. */
export const TOP_LEVEL_DOCS: Readonly<Record<string, string>> = {
  version: "Always 1. Required.",
  format: '"landscape-1080p" (default), "portrait-1080p" for phones, or "square-1080p".',
  fps: "30 (default) or 60.",
  theme: '"signal" (default: black with one bright accent) or "midnight".',
  accent: 'The accent color as "#RRGGBB". Leave it out to use the theme\'s.',
  audio: 'Music under the whole video: { "src": "music.mp3", "volume": 0.4 }. A file in the scenefile\'s folder.',
  transition: 'How scenes change: "auto" (default), "cut", "fade", "crossfade", "push", "wipe" or "zoom".',
  scenes: "The scenes, in order. Required: 1 to 60.",
};

const EXAMPLE = {
  version: 1,
  scenes: [
    { type: "title", heading: "Ship faster", highlight: "faster", sub: "A command line tool that deploys in one step." },
    { type: "terminal", steps: [{ run: "shipit deploy", output: "Deployed in 58 seconds." }] },
    { type: "stat", value: "60x", label: "faster releases" },
    { type: "outro", heading: "Deploy in one command.", highlight: "one command.", command: "npm install -g shipit" },
  ],
};

/** A small, complete scenefile: the guide's example, and what `scenefile init` writes. */
export function exampleScenefile(): Record<string, unknown> {
  return structuredClone(EXAMPLE);
}

function fieldLines(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, text]) => `- \`${name}\`: ${text}`)
    .join("\n");
}

function sceneSection(type: SceneType, example: "inline" | "block"): string {
  const { doc } = getScene(type);
  const shown =
    example === "inline"
      ? `Example: \`${JSON.stringify(doc.example)}\``
      : `\`\`\`json\n${JSON.stringify(doc.example, null, 2)}\n\`\`\``;
  return `### ${type}\n${doc.purpose}\n${fieldLines(doc.fields)}\n${shown}`;
}

const EVERY_SCENE =
  'Every scene needs `type`. Any scene may also set `duration` (seconds on screen; leave it out and the scene is timed by how long it takes to read) and `transition` (how it arrives, if not the scenefile\'s).';

/**
 * Everything a model needs to write a scenefile, in under 2,000 tokens. It is
 * assembled from the scenes' own documentation, so adding a scene or a field
 * changes the guide, and tests fail if anything is left undocumented.
 */
export function authoringGuide(): string {
  return [
    "# Making a video with scenefile",
    "A scenefile is a JSON object that says what each scene of a video shows. You never set positions, sizes, colors or timing: the engine lays scenes out, sizes text to fit, times each scene by how long it takes to read, and chooses transitions.",
    "## How to work",
    [
      "1. Write the scenefile.",
      "2. Check it. Each problem has a `code`, a `path` to the field (such as `scenes[2].heading`), a message, and a `fix`.",
      "3. Do what each `fix` says, then check again. Errors must be fixed; warnings may be left.",
      "4. When there are no errors, render it to an `.mp4`.",
    ].join("\n"),
    "## A complete scenefile",
    `\`\`\`json\n${JSON.stringify(EXAMPLE, null, 2)}\n\`\`\``,
    "## Fields of the scenefile",
    fieldLines(TOP_LEVEL_DOCS),
    "## Scene types",
    EVERY_SCENE,
    ...SCENE_TYPES.map((type) => sceneSection(type, "inline")),
    "## Rules that save a round of fixes",
    [
      "- Keep text short. If check reports `TEXT_OVERFLOW`, shorten the text to the number of characters it gives.",
      "- `highlight` must be copied exactly, letter for letter, from the text it belongs to.",
      "- Images and music are files in the same folder as the scenefile, named by their file name.",
      '- Write in Latin or Cyrillic letters. Avoid arrows, check marks and emoji: write "->" and "ok".',
      "- A good video has 5 to 9 scenes, opens with `title`, closes with `outro`, and makes one point per scene.",
    ].join("\n"),
  ].join("\n\n");
}

/** One scene type in full: its purpose, every field, and its example as formatted JSON. */
export function sceneGuide(type: SceneType): string {
  return [sceneSection(type, "block"), EVERY_SCENE.replace("Every scene needs `type`. ", "")].join("\n\n");
}

/** Diagnostics as plain text: one block per problem, then a count. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return "No problems found.";
  const lines = diagnostics.flatMap((d) => [
    `${d.severity}  ${d.code}${d.path ? `  ${d.path}` : ""}`,
    `  ${d.message}`,
    `  fix: ${d.fix}`,
  ]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  lines.push(`${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return lines.join("\n");
}

/**
 * The guide as an agent skill: front matter that tells an agent when to load
 * it, the two commands, then the guide itself. Written to
 * skills/scenefile/SKILL.md by `pnpm generate`; a test fails if that file is stale.
 */
export function skillFile(): string {
  return [
    "---",
    "name: scenefile",
    "description: Make a video (MP4) from a JSON description of its scenes - product launch videos, explainers, short clips for social media. Use when asked to create a video, a product demo, or an animated summary of a project. Needs the scenefile command.",
    "---",
    "",
    "## Commands",
    "",
    "```",
    "scenefile check video.json                 # problems, each with a fix, and a text storyboard",
    "scenefile render video.json -o video.mp4   # the video; takes about as long as the video lasts",
    "scenefile scenes <type>                    # one scene type in full",
    "```",
    "",
    "Write the scenefile to a file, run `check`, fix what it reports, repeat until there are no errors, then `render`.",
    "",
    authoringGuide(),
    "",
  ].join("\n");
}
