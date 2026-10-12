import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type StatProps, statSchema } from "./schema";
import { COUNT_SECONDS } from "./timing";

export const statDefinition: SceneDefinition<StatProps> = {
  type: "stat",
  fields: Object.keys(statSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => COUNT_SECONDS + readingSeconds(`${props.label} ${props.note ?? ""}`),
  summary: (props) => `${props.value} ${props.label}`,
  texts(props) {
    const texts: SceneText[] = [
      { path: "value", text: props.value, font: "sans" },
      { path: "label", text: props.label, font: "sans" },
    ];
    if (props.note) texts.push({ path: "note", text: props.note, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const value = escapeHtml(props.value);
    const note = props.note
      ? `<p class="sf-stat__note" data-sf-enter="2" data-sf-fit="3.4,4.2,0.2" data-sf-lines="4" data-sf-path="${ctx.path}.note">${escapeHtml(props.note)}</p>`
      : "";
    return `${sceneChrome(ctx)}<div class="sf-stat"><div class="sf-stat__value" data-sf-enter="0" data-sf-fit="18,56,2" data-sf-lines="1" data-sf-path="${ctx.path}.value" data-sf-value="${value}">${value}</div><div class="sf-stat__foot"><p class="sf-stat__label" data-sf-enter="1" data-sf-fit="4.6,7.8,0.4" data-sf-lines="2" data-sf-path="${ctx.path}.label">${escapeHtml(props.label)}</p>${note}</div></div>`;
  },
  css: `
.sf-stat{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*17);bottom:calc(var(--sf-unit)*9);display:flex;flex-direction:column;justify-content:space-between}
.sf-stat__value{font:var(--sf-heading-weight) calc(var(--sf-unit)*56)/0.86 var(--sf-font-sans);letter-spacing:-0.07em;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--sf-accent)}
.sf-stat__foot{display:grid;grid-template-columns:minmax(0,1fr) calc(var(--sf-unit)*54);column-gap:calc(var(--sf-unit)*6);align-items:end}
.sf-stat__label{min-width:0;font:800 calc(var(--sf-unit)*7.8)/1.02 var(--sf-font-sans);letter-spacing:-0.035em;color:var(--sf-text);text-wrap:balance}
.sf-stat__label:only-child{grid-column:1/-1}
.sf-stat__note{min-width:0;font:400 calc(var(--sf-unit)*4.2)/1.3 var(--sf-font-sans);color:var(--sf-muted);text-wrap:pretty}
@media (max-aspect-ratio:1/1){.sf-stat__foot{grid-template-columns:minmax(0,1fr);row-gap:calc(var(--sf-unit)*4)}}
`,
};
