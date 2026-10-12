import { containSize, imageHtml } from "../image";
import { escapeHtml, readingSeconds } from "../text";
import type { CompileContext, SceneDefinition, SceneText } from "../types";
import { type CompareProps, type CompareSide, compareSchema } from "./schema";
import { AFTER_DELAY_SECONDS, SIDE_FADE_SECONDS } from "./timing";

/** Layout, in units. Must agree with the CSS below. */
const TOP = 19;
const BOTTOM = 9;
const SIDE = 9;
const GAP = 6;
const LABEL = 7;

const SIDES = [
  { key: "before", fallback: "Before" },
  { key: "after", fallback: "After" },
] as const;

/** The space one side's image may fill: half the width side by side, half the height when stacked. */
function imageBox(ctx: CompileContext): { width: number; height: number } {
  const { width, height, unit } = ctx.frame;
  // Must agree with the CSS, which stacks the sides when the frame is square or taller.
  const stacked = height >= width;
  const innerWidth = width - 2 * SIDE * unit;
  const innerHeight = height - (TOP + BOTTOM) * unit;
  return stacked
    ? { width: innerWidth, height: (innerHeight - GAP * unit) / 2 - LABEL * unit }
    : { width: (innerWidth - GAP * unit) / 2, height: innerHeight - LABEL * unit };
}

function sideHtml(side: CompareSide, key: "before" | "after", fallback: string, index: number, ctx: CompileContext): string {
  const label = `<p class="sf-compare__label" data-sf-fixed data-sf-path="${ctx.path}.${key}.label">${escapeHtml(side.label ?? fallback)}</p>`;
  if (side.src !== undefined) {
    const asset = ctx.asset(side.src);
    const size = containSize(asset ?? { width: 16, height: 9 }, imageBox(ctx));
    const image = imageHtml(asset, `${ctx.path}.${key}.src`, size, "sf-compare__img");
    return `<section class="sf-compare__side is-${key}" data-sf-side="${index}">${label}<div class="sf-compare__body">${image}</div></section>`;
  }
  // The body, not the paragraph, is the slot: the text must fit the height its
  // side has, which is half the frame when the sides are stacked.
  return `<section class="sf-compare__side is-${key}" data-sf-side="${index}">${label}<div class="sf-compare__body" data-sf-fit="4.6,9,0.4" data-sf-box data-sf-path="${ctx.path}.${key}.text"><p class="sf-compare__text">${escapeHtml(side.text ?? "")}</p></div></section>`;
}

export const compareDefinition: SceneDefinition<CompareProps> = {
  type: "compare",
  fields: Object.keys(compareSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 3,
  revealSeconds: () => AFTER_DELAY_SECONDS + SIDE_FADE_SECONDS,
  holdSeconds(props) {
    const words = readingSeconds(`${props.before.text ?? ""} ${props.after.text ?? ""}`);
    const looking = [props.before, props.after].filter((side) => side.src !== undefined).length * 1.5;
    return AFTER_DELAY_SECONDS + SIDE_FADE_SECONDS + words + looking + 0.5;
  },
  summary(props) {
    const describe = (side: CompareSide): string => side.text ?? `image ${side.src ?? ""}`;
    return `${describe(props.before)} / ${describe(props.after)}`;
  },
  texts(props) {
    return SIDES.flatMap(({ key }): SceneText[] => {
      const side = props[key];
      const texts: SceneText[] = [];
      if (side.label) texts.push({ path: `${key}.label`, text: side.label, font: "mono" });
      if (side.text) texts.push({ path: `${key}.text`, text: side.text, font: "sans" });
      return texts;
    });
  },
  assets(props) {
    return SIDES.flatMap(({ key }) => {
      const src = props[key].src;
      return src === undefined ? [] : [{ path: `${key}.src`, src }];
    });
  },
  compile(props, ctx) {
    const sides = SIDES.map(({ key, fallback }, index) => sideHtml(props[key], key, fallback, index, ctx)).join("");
    return `<div class="sf-compare">${sides}</div>`;
  },
  doc: {
    purpose: "Before and after, side by side.",
    fields: {
      "before": "The old way: { \"label\": \"up to 24 characters, optional\", \"text\": \"up to 160 characters\" } or { \"src\": \"image file\" }. Required.",
      "after": "The new way, in the same form. Required."
    },
    example: {
      "type": "compare",
      "before": {
        "label": "By hand",
        "text": "Draw and time every frame."
      },
      "after": {
        "label": "With a scenefile",
        "text": "List the scenes."
      }
    },
  },
  css: `
.sf-compare{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*9);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:calc(var(--sf-unit)*6)}
.sf-compare__side{min-width:0;min-height:0;display:flex;flex-direction:column}
.sf-compare__label{flex:none;height:calc(var(--sf-unit)*7);font:500 calc(var(--sf-unit)*3.4)/calc(var(--sf-unit)*4) var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-compare__side.is-after .sf-compare__label{color:var(--sf-accent)}
.sf-compare__body{flex:1;min-height:0;overflow:hidden;display:flex;align-items:flex-start;border-top:1px solid var(--sf-line);font-size:calc(var(--sf-unit)*9)}
.sf-compare__text{padding-top:calc(var(--sf-unit)*3);font:800 1em/1.05 var(--sf-font-display);letter-spacing:-0.04em;color:var(--sf-text);text-wrap:balance}
.sf-compare__side.is-before .sf-compare__text{color:var(--sf-muted)}
.sf-compare__img,.sf-compare .sf-shot__missing{display:block;margin-top:-1px;background:var(--sf-surface)}
@media (max-aspect-ratio:1/1){.sf-compare{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,1fr);row-gap:calc(var(--sf-unit)*6)}}
`,
};
