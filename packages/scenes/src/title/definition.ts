import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition } from "../types";
import { type TitleProps, titleSchema } from "./schema";

export const titleDefinition: SceneDefinition<TitleProps> = {
  type: "title",
  fields: Object.keys(titleSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds: (props) => readingSeconds(`${props.heading} ${props.sub ?? ""}`),
  summary: (props) => props.heading,
  compile(props) {
    const sub = props.sub
      ? `<p class="sf-title__sub" data-sf-enter="1">${escapeHtml(props.sub)}</p>`
      : "";
    return `<div class="sf-title"><h1 class="sf-title__heading" data-sf-enter="0">${escapeHtml(props.heading)}</h1>${sub}</div>`;
  },
  css: `
.sf-title{display:flex;flex-direction:column;justify-content:center;gap:calc(var(--sf-unit)*3);width:100%;height:100%;padding:calc(var(--sf-unit)*12)}
.sf-title__heading{font:700 calc(var(--sf-unit)*14)/1.02 var(--sf-font-sans);letter-spacing:-0.03em;color:var(--sf-text);max-width:18ch;text-wrap:balance;overflow-wrap:anywhere}
.sf-title__sub{font:400 calc(var(--sf-unit)*5)/1.25 var(--sf-font-sans);color:var(--sf-muted);max-width:40ch;text-wrap:balance;overflow-wrap:anywhere}
`,
};
