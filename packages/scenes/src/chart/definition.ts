import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type ChartProps, chartSchema } from "./schema";
import { chartRevealSeconds } from "./timing";

/** A value as it is written beside its bar: grouped thousands, then the unit. */
function written(value: number, unit: string | undefined): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}${unit ?? ""}`;
}

export const chartDefinition: SceneDefinition<ChartProps> = {
  type: "chart",
  fields: Object.keys(chartSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 2.5,
  revealSeconds: (props) => chartRevealSeconds(props.bars.length),
  holdSeconds: (props) =>
    chartRevealSeconds(props.bars.length) +
    readingSeconds(`${props.heading ?? ""} ${props.bars.map((bar) => bar.label).join(" ")}`) +
    0.3 * props.bars.length,
  summary: (props) =>
    `${props.heading ?? "chart"}: ${props.bars.map((bar) => `${bar.label} ${written(bar.value, props.unit)}`).join(", ")}`,
  texts(props) {
    const texts: SceneText[] = props.heading ? [{ path: "heading", text: props.heading, font: "sans" }] : [];
    props.bars.forEach((bar, i) => {
      texts.push({ path: `bars[${i}].label`, text: bar.label, font: "sans" });
      texts.push({ path: `bars[${i}].value`, text: written(bar.value, props.unit), font: "sans" });
    });
    return texts;
  },
  compile(props, ctx) {
    const most = Math.max(...props.bars.map((bar) => bar.value));
    const heading = props.heading
      ? `<p class="sf-chart__heading" data-sf-enter="0" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.heading">${escapeHtml(props.heading)}</p>`
      : "";
    const rows = props.bars
      .map((bar) => {
        const share = bar.value / most;
        const lit = bar.label === props.highlight ? " sf-chart__row--lit" : "";
        return (
          `<li class="sf-chart__row${lit}" data-sf-bar="${share}">` +
          `<span class="sf-chart__label">${escapeHtml(bar.label)}</span>` +
          `<span class="sf-chart__track"><i class="sf-chart__fill" style="width:${(share * 100).toFixed(3)}%"></i></span>` +
          `<span class="sf-chart__value">${escapeHtml(written(bar.value, props.unit))}</span></li>`
        );
      })
      .join("");
    return `<div class="sf-chart">${heading}<ol class="sf-chart__rows" data-sf-enter="1" data-sf-fit="3,9,0.3" data-sf-box data-sf-path="${ctx.path}.bars">${rows}</ol></div>`;
  },
  doc: {
    purpose: "Two to six numbers compared as bars that grow, such as speeds, sizes or prices.",
    fields: {
      "heading": "What is being measured, up to 60 characters.",
      "bars": 'The bars: a list of 2 to 6 of { "label": up to 28 characters, "value": a number, 0 or more }. Required.',
      "unit": 'Written after each value, up to 6 characters: "ms", "%", "x".',
      "highlight": "The label of the one bar to draw in the accent color, copied exactly."
    },
    example: {
      "type": "chart",
      "heading": "Build time",
      "unit": "s",
      "bars": [
        { "label": "Before", "value": 48 },
        { "label": "After", "value": 3 }
      ],
      "highlight": "After"
    },
  },
  css: `
.sf-chart{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;gap:calc(var(--sf-unit)*4)}
.sf-chart__heading{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
.sf-chart__rows{flex:1;min-height:0;overflow:hidden;list-style:none;display:flex;flex-direction:column;justify-content:center;gap:0.62em;font-size:calc(var(--sf-unit)*9);color:var(--sf-text)}
.sf-chart__row{display:grid;grid-template-columns:minmax(0,26%) minmax(0,1fr) minmax(3.2em,auto);align-items:center;column-gap:0.5em}
.sf-chart__label{font:600 0.62em/1.15 var(--sf-font-sans);letter-spacing:-0.02em;color:var(--sf-muted);overflow-wrap:anywhere}
.sf-chart__track{display:block;height:0.66em;border-bottom:1px solid var(--sf-line)}
.sf-chart__fill{display:block;height:100%;background:var(--sf-text);transform-origin:left center}
.sf-chart__value{font:800 1em/1 var(--sf-font-sans);letter-spacing:-0.045em;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sf-chart__row--lit .sf-chart__fill{background:var(--sf-accent)}
.sf-chart__row--lit .sf-chart__label{color:var(--sf-text)}
.sf-chart__row--lit .sf-chart__value{color:var(--sf-accent)}
@media (max-aspect-ratio:1/1){.sf-chart__row{grid-template-columns:minmax(0,1fr) auto;row-gap:0.18em}.sf-chart__label{grid-column:1/-1}}
`,
};
