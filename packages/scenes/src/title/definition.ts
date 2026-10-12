import { escapeHtml, highlightHtml, readingSeconds } from "../text";
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
  texts(props) {
    const texts = [{ path: "heading", text: props.heading, font: "sans" as const }];
    if (props.sub) texts.push({ path: "sub", text: props.sub, font: "sans" as const });
    return texts;
  },
  compile(props, ctx) {
    const sub = props.sub
      ? `<p class="sf-title__sub" data-sf-enter="1" data-sf-fit="3.4,4.6,0.2" data-sf-lines="4" data-sf-path="${ctx.path}.sub">${escapeHtml(props.sub)}</p>`
      : "";
    return `<div class="sf-title"><h1 class="sf-title__heading" data-sf-enter="0" data-sf-fit="8,22,1" data-sf-lines="3" data-sf-path="${ctx.path}.heading">${highlightHtml(props.heading, props.highlight)}</h1>${sub}</div>`;
  },
  doc: {
    purpose: "An opening or section heading: one large line, with an optional smaller line beside it.",
    fields: {
      "heading": "The large line. Required, up to 80 characters; two to five words read best.",
      "highlight": "A part of the heading, copied exactly, to draw in the accent color.",
      "sub": "A supporting sentence beside the heading, up to 140 characters."
    },
    example: {
      "type": "title",
      "heading": "Video from JSON",
      "highlight": "JSON",
      "sub": "Describe the scenes. The engine draws and times them."
    },
  },
  css: `
.sf-title{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);bottom:calc(var(--sf-unit)*10);display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*54);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-title__heading{min-width:0;font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.92 var(--sf-font-sans);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-title__heading:only-child{grid-column:1/-1}
.sf-title__heading em{font-style:normal;color:var(--sf-accent)}
.sf-title__sub{min-width:0;font:400 calc(var(--sf-unit)*4.6)/1.28 var(--sf-font-sans);color:var(--sf-muted);padding-bottom:calc(var(--sf-unit)*1.4);text-wrap:pretty}
@media (max-aspect-ratio:1/1){.sf-title{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*5)}.sf-title__sub{padding-bottom:0;max-width:calc(var(--sf-unit)*70)}}
`,
};
