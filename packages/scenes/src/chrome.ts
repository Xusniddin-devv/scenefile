import type { CompileContext } from "./types";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** The counter and hairline every scene carries at the top of the frame. */
export function sceneChrome(ctx: CompileContext): string {
  return `<div class="sf-chrome"><span class="sf-chrome__index"><b>${twoDigits(ctx.index + 1)}</b> / ${twoDigits(ctx.total)}</span></div>`;
}

/** Styles shared by all scenes. Included once per composition. */
export const SHARED_CSS = `
.sf-chrome{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*5.5);padding-bottom:calc(var(--sf-unit)*2.4);border-bottom:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*2.4)/1 var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted)}
.sf-chrome__index b{font-weight:500;color:var(--sf-accent)}
`;
