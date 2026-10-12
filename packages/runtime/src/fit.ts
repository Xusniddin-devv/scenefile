/** What happened to one fitted piece of text. Mirrors `SlotReport` in @scenefile/engine. */
export interface SlotReport {
  path: string;
  sizePx: number;
  lines: number;
  maxLines: number | null;
  chars: number;
  overflow: boolean;
  outside: boolean;
}

/** Nothing may come closer to the edge of the frame than this, in units. */
const SAFE_MARGIN_UNITS = 4;

function measure(el: HTMLElement, maxLines: number | null, boxed: boolean): { lines: number; fits: boolean } {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const lines = Math.max(1, Math.round((el.clientHeight - padding) / lineHeight));
  const tooWide = el.scrollWidth > el.clientWidth + 1;
  const tooTall = boxed && el.scrollHeight > el.clientHeight + 1;
  return { lines, fits: !tooWide && !tooTall && (maxLines === null || lines <= maxLines) };
}

/**
 * Sizes every `[data-sf-fit]` element under `root`: the largest size on its
 * scale at which the text fits. Shrinking is preferred to breaking a word;
 * only at the smallest size may a word break, and if the text still does not
 * fit, that is reported rather than hidden.
 */
export function fitSlots(root: HTMLElement, unitPx: number, frame: { width: number; height: number }): SlotReport[] {
  const reports: SlotReport[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-sf-fit]")) {
    const [min = 1, max = 1, step = 1] = (el.dataset.sfFit ?? "").split(",").map(Number);
    const maxLines = el.dataset.sfLines ? Number(el.dataset.sfLines) : null;
    const boxed = "sfBox" in el.dataset;

    // Block-level text must not break words while a smaller size might still fit them.
    if (!boxed) el.style.overflowWrap = "normal";
    let size = max;
    let result = { lines: 1, fits: false };
    for (;;) {
      el.style.fontSize = `${size * unitPx}px`;
      result = measure(el, maxLines, boxed);
      const next = Math.round((size - step) * 100) / 100;
      if (result.fits || next < min) break;
      size = next;
    }
    // Whether it fits is decided before any word is broken. Breaking is damage
    // control for the picture; the text is still reported as not fitting.
    const fits = result.fits;
    if (!boxed) {
      el.style.overflowWrap = fits ? "" : "anywhere";
      if (!fits) result = measure(el, maxLines, boxed);
    }

    const rect = el.getBoundingClientRect();
    const margin = SAFE_MARGIN_UNITS * unitPx - 1;
    reports.push({
      path: el.dataset.sfPath ?? "",
      sizePx: size * unitPx,
      lines: result.lines,
      maxLines,
      chars: Array.from(el.textContent ?? "").length,
      overflow: !fits,
      outside:
        rect.left < margin ||
        rect.top < margin ||
        rect.right > frame.width - margin ||
        rect.bottom > frame.height - margin,
    });
  }
  return reports;
}
