import { containSize, imageHtml } from "../image";
import { escapeHtml, readingSeconds } from "../text";
import type { CompileContext, SceneDefinition, SceneText } from "../types";
import { type ScreenshotProps, screenshotSchema } from "./schema";
import { pinsRevealSeconds } from "./timing";

/** Layout, in units. The image gets whatever the frame leaves after these. */
const TOP = 17;
const BOTTOM = 8;
const SIDE = 9;
const BAR = 5;
const CAPTION = 9;
/** Callout labels, in units: text size, padding inside the box, and distance from the dot. */
const LABEL_SIZE = 3.4;
const LABEL_PADDING = 3;
const LABEL_GAP = 2.6;
/** Labels stay this far from the frame's edge. */
const SAFE = 4;
/** Average width of a character as a share of the text size; on the generous side, so labels are not placed too tight. */
const CHARACTER_WIDTH = 0.6;

/**
 * Which side of its dot a label goes, and how wide it may be before wrapping.
 * A label may extend past a narrow image, but not past the frame: the side
 * with room is chosen, and the width is capped to the room there is.
 */
function labelStyle(x: number, label: string, imageWidth: number, ctx: CompileContext): string {
  const { width, unit } = ctx.frame;
  const dot = SIDE * unit + x * imageWidth;
  const needed = (Array.from(label).length * CHARACTER_WIDTH * LABEL_SIZE + LABEL_PADDING) * unit;
  const roomRight = width - SAFE * unit - dot - LABEL_GAP * unit;
  const roomLeft = dot - LABEL_GAP * unit - SAFE * unit;
  const onRight = needed <= roomRight || roomRight >= roomLeft;
  const room = Math.max(8 * unit, Math.floor(onRight ? roomRight : roomLeft));
  return `${onRight ? "left" : "right"}:${Math.round(LABEL_GAP * unit)}px;max-width:${room}px`;
}

/** A fraction as a CSS percentage, without floating-point noise (0.3 is "30%", not "30.000000000000004%"). */
function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`;
}

export const screenshotDefinition: SceneDefinition<ScreenshotProps> = {
  type: "screenshot",
  fields: Object.keys(screenshotSchema.shape),
  enterSeconds: 0.6,
  exitSeconds: 0.4,
  minHoldSeconds: 3,
  revealSeconds: (props) => pinsRevealSeconds(props.callouts?.length ?? 0),
  holdSeconds(props) {
    const labels = (props.callouts ?? []).map((callout) => callout.label).join(" ");
    return pinsRevealSeconds(props.callouts?.length ?? 0) + readingSeconds(`${labels} ${props.caption ?? ""}`) + 1.5;
  },
  summary: (props) => `image ${props.src}${props.caption ? `: ${props.caption}` : ""}`,
  texts(props) {
    const texts: SceneText[] = [];
    if (props.url) texts.push({ path: "url", text: props.url, font: "mono" });
    if (props.caption) texts.push({ path: "caption", text: props.caption, font: "sans" });
    (props.callouts ?? []).forEach((callout, i) => texts.push({ path: `callouts[${i}].label`, text: callout.label, font: "sans" }));
    return texts;
  },
  assets: (props) => [{ path: "src", src: props.src }],
  compile(props, ctx) {
    const { width, height, unit } = ctx.frame;
    const asset = ctx.asset(props.src);
    const box = {
      width: width - 2 * SIDE * unit,
      height: height - (TOP + BOTTOM + (props.url ? BAR : 0) + (props.caption ? CAPTION : 0)) * unit,
    };
    // 16:9 stands in for an image that is not available, so the layout still holds.
    const size = containSize(asset ?? { width: 16, height: 9 }, box);
    const pins = (props.callouts ?? [])
      .map(
        (callout, i) =>
          `<span class="sf-shot__pin" data-sf-pin="${i}" style="left:${percent(callout.x)};top:${percent(callout.y)}"><b data-sf-fixed data-sf-path="${ctx.path}.callouts[${i}].label" style="${labelStyle(callout.x, callout.label, size.width, ctx)}">${escapeHtml(callout.label)}</b></span>`,
      )
      .join("");
    const bar = props.url ? `<div class="sf-shot__bar" data-sf-fixed data-sf-path="${ctx.path}.url">${escapeHtml(props.url)}</div>` : "";
    const caption = props.caption
      ? `<p class="sf-shot__caption" data-sf-enter="1" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.caption">${escapeHtml(props.caption)}</p>`
      : "";
    return `<div class="sf-shot"><figure class="sf-shot__frame" data-sf-enter="0" style="width:${size.width}px">${bar}<div class="sf-shot__stage"><div class="sf-shot__view" style="width:${size.width}px;height:${size.height}px"><div class="sf-shot__layer">${imageHtml(asset, `${ctx.path}.src`, size, "sf-shot__img")}</div></div><div class="sf-shot__pins">${pins}</div></div></figure>${caption}</div>`;
  },
  doc: {
    purpose: "An image, such as a screenshot, with an optional address bar, caption and up to three callouts.",
    fields: {
      "src": "The image: a PNG, JPEG or WebP file in the scenefile's folder. Required.",
      "url": "An address to show above the image, up to 80 characters.",
      "caption": "A line under the image, up to 80 characters.",
      "callouts": "Up to 3 pointers: { \"x\": 0.5, \"y\": 0.5, \"label\": \"up to 40 characters\" }. x and y are fractions of the image, from its left and top."
    },
    example: {
      "type": "screenshot",
      "src": "dashboard.png",
      "caption": "Every deploy, in one place."
    },
  },
  css: `
.sf-shot{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*17);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;justify-content:space-between}
.sf-shot__frame{box-sizing:content-box;border:1px solid var(--sf-line);margin:-1px}
.sf-shot__bar{height:calc(var(--sf-unit)*5);padding:0 calc(var(--sf-unit)*2);border-bottom:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*2.4)/calc(var(--sf-unit)*5) var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sf-shot__stage{position:relative}
.sf-shot__view{position:relative;overflow:hidden;background:var(--sf-surface)}
.sf-shot__layer,.sf-shot__pins{position:absolute;inset:0}
.sf-shot__img,.sf-shot__missing{display:block}
.sf-shot__pin{position:absolute;width:0;height:0}
.sf-shot__pin::before{content:"";position:absolute;left:calc(var(--sf-unit)*-1);top:calc(var(--sf-unit)*-1);width:calc(var(--sf-unit)*2);height:calc(var(--sf-unit)*2);border-radius:50%;background:var(--sf-accent);box-shadow:0 0 0 calc(var(--sf-unit)*0.5) var(--sf-bg)}
.sf-shot__pin b{position:absolute;top:calc(var(--sf-unit)*-2.6);width:max-content;padding:0 calc(var(--sf-unit)*1.4);background:var(--sf-bg);border:1px solid var(--sf-line);font:600 calc(var(--sf-unit)*3.4)/calc(var(--sf-unit)*5.2) var(--sf-font-sans);color:var(--sf-text);overflow-wrap:anywhere}
.sf-shot__caption{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
`,
};
