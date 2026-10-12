import { CHARS_PER_SECOND, graphemes } from "../terminal/timing";
import { escapeHtml, highlightHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type OutroProps, outroSchema } from "./schema";
import { TYPE_DELAY_SECONDS } from "./timing";

/** Seconds the finished command stays up so it can be read and remembered. */
const COMMAND_REST_SECONDS = 1.2;

export const outroDefinition: SceneDefinition<OutroProps> = {
  type: "outro",
  fields: Object.keys(outroSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.5,
  minHoldSeconds: 2,
  revealSeconds: (props) =>
    props.command ? TYPE_DELAY_SECONDS + graphemes(props.command).length / CHARS_PER_SECOND : 0,
  holdSeconds(props) {
    const typing = props.command
      ? TYPE_DELAY_SECONDS + graphemes(props.command).length / CHARS_PER_SECOND + COMMAND_REST_SECONDS
      : 0;
    return readingSeconds(`${props.heading} ${props.url ?? ""}`) + typing;
  },
  summary: (props) => `${props.heading}${props.command ? ` ($ ${props.command})` : ""}`,
  texts(props) {
    const texts: SceneText[] = [{ path: "heading", text: props.heading, font: "sans" }];
    if (props.command) texts.push({ path: "command", text: props.command, font: "mono" });
    if (props.url) texts.push({ path: "url", text: props.url, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const command = props.command
      ? `<div class="sf-outro__cmd" data-sf-enter="1" data-sf-fit="3.4,5,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.command"><span class="sf-outro__prompt">$</span><span data-sf-type="${escapeHtml(props.command)}"></span><span class="sf-outro__caret"></span></div>`
      : "";
    const url = props.url
      ? `<p class="sf-outro__url" data-sf-enter="2" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.url">${escapeHtml(props.url)}</p>`
      : "";
    const side = command || url ? `<div class="sf-outro__side">${command}${url}</div>` : "";
    return `<div class="sf-outro"><h1 class="sf-outro__heading" data-sf-enter="0" data-sf-fit="8,22,1" data-sf-lines="3" data-sf-path="${ctx.path}.heading">${highlightHtml(props.heading, props.highlight)}</h1>${side}</div>`;
  },
  doc: {
    purpose: "The closing scene: a last line, with a command to run or an address to visit.",
    fields: {
      "heading": "The closing line. Required, up to 60 characters.",
      "highlight": "A part of the heading, copied exactly, to draw in the accent color.",
      "command": "A command for the viewer to run, up to 80 characters. It is typed out.",
      "url": "An address, up to 80 characters."
    },
    example: {
      "type": "outro",
      "heading": "Deploy in one command.",
      "highlight": "one command.",
      "command": "npm install -g shipit",
      "url": "shipit.example"
    },
  },
  css: `
.sf-outro{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);bottom:calc(var(--sf-unit)*10);display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*60);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-outro__heading{min-width:0;font:var(--sf-heading-weight) calc(var(--sf-unit)*22)/0.92 var(--sf-font-sans);letter-spacing:var(--sf-heading-tracking);color:var(--sf-text);text-wrap:balance}
.sf-outro__heading:only-child{grid-column:1/-1}
.sf-outro__heading em{font-style:normal;color:var(--sf-accent)}
.sf-outro__side{min-width:0;padding-bottom:calc(var(--sf-unit)*1.4)}
.sf-outro__cmd{padding-top:calc(var(--sf-unit)*2.4);border-top:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*5)/1.4 var(--sf-font-mono);font-variant-ligatures:none;white-space:pre-wrap;color:var(--sf-text)}
.sf-outro__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-outro__caret{display:inline-block;width:0.6em;height:1.1em;margin:0 -0.7em 0 0.1em;vertical-align:text-bottom;background:var(--sf-accent)}
.sf-outro__url{margin-top:calc(var(--sf-unit)*1.6);font:400 calc(var(--sf-unit)*4.6)/1.3 var(--sf-font-sans);color:var(--sf-muted)}
@media (max-aspect-ratio:1/1){.sf-outro{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*6)}.sf-outro__side{padding-bottom:0}}
`,
};
