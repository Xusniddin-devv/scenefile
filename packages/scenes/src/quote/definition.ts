import { sceneChrome } from "../chrome";
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
      ? `<figcaption class="sf-quote__by" data-sf-enter="2" data-sf-fit="3.4,4.4,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.author"><b>${escapeHtml(props.author)}</b>${props.role ? `, ${escapeHtml(props.role)}` : ""}</figcaption>`
      : "";
    return `${sceneChrome(ctx)}<figure class="sf-quote"><span class="sf-quote__mark" data-sf-enter="0" aria-hidden="true">“</span><blockquote class="sf-quote__text" data-sf-enter="1" data-sf-fit="4.6,10,0.4" data-sf-lines="6" data-sf-path="${ctx.path}.text">${escapeHtml(props.text)}</blockquote>${by}</figure>`;
  },
  css: `
.sf-quote{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*10);display:flex;flex-direction:column;justify-content:flex-end}
.sf-quote__mark{font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.6 var(--sf-font-sans);color:var(--sf-accent);height:calc(var(--sf-unit)*9)}
.sf-quote__text{font:800 calc(var(--sf-unit)*10)/1.05 var(--sf-font-sans);letter-spacing:-0.04em;color:var(--sf-text);text-wrap:balance}
.sf-quote__by{margin-top:calc(var(--sf-unit)*4);font:400 calc(var(--sf-unit)*4.4)/1.3 var(--sf-font-sans);color:var(--sf-muted)}
.sf-quote__by b{font-weight:600;color:var(--sf-text)}
`,
};
