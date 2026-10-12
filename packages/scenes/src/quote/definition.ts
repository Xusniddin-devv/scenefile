import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type QuoteProps, quoteSchema } from "./schema";

export const quoteDefinition: SceneDefinition<QuoteProps> = {
  type: "quote",
  fields: Object.keys(quoteSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => readingSeconds(`${props.text} ${props.author ?? ""} ${props.role ?? ""}`),
  summary: (props) => `"${props.text}"${props.author ? ` (${props.author})` : ""}`,
  texts(props) {
    const texts: SceneText[] = [{ path: "text", text: props.text, font: "sans" }];
    if (props.author) texts.push({ path: "author", text: props.author, font: "sans" });
    if (props.role) texts.push({ path: "role", text: props.role, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const by = props.author
      ? `<figcaption class="sf-quote__by" data-sf-enter="2"><b>${escapeHtml(props.author)}</b>${props.role ? `, ${escapeHtml(props.role)}` : ""}</figcaption>`
      : "";
    // The figure as a whole is the slot: mark, text and attribution scale
    // together until all three fit the area below the scene counter.
    return `<figure class="sf-quote" data-sf-fit="4.6,10,0.4" data-sf-box data-sf-path="${ctx.path}.text"><span class="sf-quote__mark" data-sf-enter="0" aria-hidden="true">\u201C</span><blockquote class="sf-quote__text" data-sf-enter="1">${escapeHtml(props.text)}</blockquote>${by}</figure>`;
  },
  doc: {
    purpose: "Something a person said, with who said it.",
    fields: {
      "text": "The quotation, without quote marks. Required, up to 220 characters.",
      "author": "Who said it, up to 60 characters.",
      "role": "Their job or company, up to 60 characters. Needs author."
    },
    example: {
      "type": "quote",
      "text": "Premature optimization is the root of all evil.",
      "author": "Donald Knuth",
      "role": "Computer scientist"
    },
  },
  css: `
.sf-quote{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*10);display:flex;flex-direction:column;overflow:hidden;font-size:calc(var(--sf-unit)*10);font-family:var(--sf-font-sans)}
.sf-quote__mark{margin-top:auto;height:0.9em;font-size:2.2em;line-height:0.6;font-weight:var(--sf-heading-weight);color:var(--sf-accent)}
.sf-quote__text{font-weight:800;line-height:1.05;letter-spacing:-0.04em;color:var(--sf-text);text-wrap:balance}
.sf-quote__by{margin-top:0.4em;font-size:max(0.44em,calc(var(--sf-unit)*3.4));font-weight:400;line-height:1.3;color:var(--sf-muted)}
.sf-quote__by b{font-weight:600;color:var(--sf-text)}
`,
};
