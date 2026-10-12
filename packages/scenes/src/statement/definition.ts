import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type StatementProps, statementSchema } from "./schema";
import { statementRevealSeconds } from "./timing";

function words(text: string) {
  return Array.from(text.matchAll(/\S+/g));
}

/** Each word in its own element, so words can appear one at a time; highlighted words are accented. */
function wordsHtml(text: string, highlight: string | undefined): string {
  const from = highlight === undefined ? -1 : text.indexOf(highlight);
  const to = highlight === undefined || from < 0 ? -1 : from + highlight.length;
  return words(text)
    .map((match, index) => {
      const start = match.index ?? 0;
      const accent = from >= 0 && start < to && start + match[0].length > from;
      return `<span class="sf-statement__word${accent ? " is-accent" : ""}" data-sf-word="${index}">${escapeHtml(match[0])}</span>`;
    })
    .join(" ");
}

export const statementDefinition: SceneDefinition<StatementProps> = {
  type: "statement",
  fields: Object.keys(statementSchema.shape),
  enterSeconds: 0.2,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  revealSeconds: (props) => statementRevealSeconds(words(props.text).length),
  holdSeconds: (props) => statementRevealSeconds(words(props.text).length) + readingSeconds(props.text),
  summary: (props) => props.text,
  texts: (props) => [{ path: "text", text: props.text, font: "sans" }],
  compile(props, ctx) {
    return `<div class="sf-statement"><p class="sf-statement__text" data-sf-fit="6,15,0.5" data-sf-lines="5" data-sf-path="${ctx.path}.text">${wordsHtml(props.text, props.highlight)}</p></div>`;
  },
  doc: {
    purpose: "One sentence that fills the frame, arriving word by word.",
    fields: {
      "text": "The sentence. Required, up to 140 characters.",
      "highlight": "A part of the text, copied exactly, to draw in the accent color."
    },
    example: {
      "type": "statement",
      "text": "Describe what the video shows. The engine does the drawing.",
      "highlight": "The engine does the drawing."
    },
  },
  css: `
.sf-statement{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*10);display:flex;align-items:flex-end}
.sf-statement__text{width:100%;font:var(--sf-heading-weight) calc(var(--sf-unit)*15)/0.98 var(--sf-font-display);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-statement__word{display:inline-block}
.sf-statement__word.is-accent{color:var(--sf-accent)}
`,
};
