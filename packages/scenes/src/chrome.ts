function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The counter and hairline at the top of the frame. There is one for the whole
 * video, above the scenes, so it stays still while scenes change beneath it;
 * the runtime updates the number.
 */
export function sceneChrome(total: number): string {
  return `<div class="sf-chrome"><span class="sf-chrome__index"><b>01</b> / ${twoDigits(total)}</span></div>`;
}

/** Styles shared by all scenes. Included once per composition. */
export const SHARED_CSS = `
.sf-chrome{z-index:3;position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*5.5);padding-bottom:calc(var(--sf-unit)*2.4);border-bottom:1px solid var(--sf-line);font:500 calc(var(--sf-unit)*2.4)/1 var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-muted)}
.sf-chrome__index b{font-weight:500;color:var(--sf-accent)}
`;
