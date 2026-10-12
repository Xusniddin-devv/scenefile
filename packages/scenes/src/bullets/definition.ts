import { sceneChrome } from "../chrome";
import { escapeHtml, readingSeconds } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type BulletsProps, bulletsSchema } from "./schema";
import { bulletsHoldSeconds } from "./timing";

export const bulletsDefinition: SceneDefinition<BulletsProps> = {
  type: "bullets",
  fields: Object.keys(bulletsSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  holdSeconds: (props) => bulletsHoldSeconds(props.items) + readingSeconds(props.heading ?? ""),
  summary: (props) => `${props.heading ?? props.items[0] ?? ""} (${props.items.length} items)`,
  texts(props) {
    const texts: SceneText[] = props.heading ? [{ path: "heading", text: props.heading, font: "sans" }] : [];
    props.items.forEach((item, i) => texts.push({ path: `items[${i}]`, text: item, font: "sans" }));
    return texts;
  },
  compile(props, ctx) {
    const heading = props.heading
      ? `<p class="sf-bullets__heading" data-sf-enter="0" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.heading">${escapeHtml(props.heading)}</p>`
      : "";
    const items = props.items
      .map(
        (item, i) =>
          `<li class="sf-bullets__item" data-sf-item="${i}"><i>${String(i + 1).padStart(2, "0")}</i><span>${escapeHtml(item)}</span></li>`,
      )
      .join("");
    return `${sceneChrome(ctx)}<div class="sf-bullets">${heading}<ol class="sf-bullets__list" data-sf-enter="1" data-sf-fit="4,9.6,0.4" data-sf-box data-sf-path="${ctx.path}.items">${items}</ol></div>`;
  },
  css: `
.sf-bullets{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;gap:calc(var(--sf-unit)*3)}
.sf-bullets__heading{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
.sf-bullets__list{flex:1;min-height:0;overflow:hidden;list-style:none;display:flex;flex-direction:column;font-size:calc(var(--sf-unit)*9.6);color:var(--sf-text)}
.sf-bullets__item{display:flex;align-items:baseline;padding:0.42em 0;border-top:1px solid var(--sf-line)}
.sf-bullets__item i{flex:none;width:6em;font:500 0.3em/1 var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-accent)}
.sf-bullets__item span{min-width:0;font:800 1em/1.05 var(--sf-font-sans);letter-spacing:-0.045em;text-wrap:balance}
`,
};
