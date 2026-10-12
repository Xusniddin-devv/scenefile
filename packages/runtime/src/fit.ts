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

/**
 * True when any text of a scene, other than the scene counter itself, starts
 * above the bottom of the counter's hairline. Scenes anchor their content to
 * the bottom of the frame, so too much of it climbs into the counter.
 */
export function isCrowded(scene: HTMLElement): boolean {
  const chrome = scene.querySelector(".sf-chrome");
  if (!chrome) return false;
  const limit = chrome.getBoundingClientRect().bottom - 1;
  const range = document.createRange();
  const walker = document.createTreeWalker(scene, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (chrome.contains(node) || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    // A text rectangle starts at the font's ascender line, well above where
    // capital letters begin. Compare against where ink can actually be.
    const fontSize = Number.parseFloat(getComputedStyle(node.parentElement ?? scene).fontSize);
    const inkOffset = fontSize * ASCENDER_GAP;
    for (const rect of range.getClientRects()) if (rect.height > 0 && rect.top + inkOffset < limit) return true;
  }
  return false;
}

/** Where a fixed-size label ended up. Mirrors `LabelReport` in @scenefile/engine. */
export interface LabelReport {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors `ConflictReport` in @scenefile/engine. */
export interface ConflictReport {
  path: string;
  with: string;
}

function textRects(el: Element): DOMRect[] {
  const rects: DOMRect[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push(rect);
  }
  return rects;
}

/** True when two boxes share more than a pixel-wide sliver. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
}

/**
 * Fixed-size labels are placed where the scenefile says, so they can land on
 * top of each other, on other text, on the scene counter, or off the frame.
 * Nothing shrinks them; this finds where they ended up and what they hit.
 */
export function inspectLabels(
  scene: HTMLElement,
  frame: { width: number; height: number },
): { labels: LabelReport[]; conflicts: ConflictReport[] } {
  const found = Array.from(scene.querySelectorAll<HTMLElement>("[data-sf-fixed][data-sf-path]"), (el) => ({
    el,
    path: el.dataset.sfPath ?? "",
    rect: el.getBoundingClientRect(),
  }));
  const fitted = Array.from(scene.querySelectorAll<HTMLElement>("[data-sf-fit]"), (el) => ({
    el,
    path: el.dataset.sfPath ?? "",
    rects: textRects(el),
  }));
  const counter = scene.querySelector(".sf-chrome")?.getBoundingClientRect().bottom ?? 0;
  const conflicts: ConflictReport[] = [];

  found.forEach((label, i) => {
    const { rect } = label;
    if (rect.left < -0.5 || rect.top < -0.5 || rect.right > frame.width + 0.5 || rect.bottom > frame.height + 0.5) {
      conflicts.push({ path: label.path, with: "frame" });
    } else if (rect.top < counter - 0.5) {
      conflicts.push({ path: label.path, with: "counter" });
    }
    for (const earlier of found.slice(0, i)) {
      if (overlaps(rect, earlier.rect)) conflicts.push({ path: label.path, with: earlier.path });
    }
    for (const slot of fitted) {
      if (slot.el.contains(label.el) || label.el.contains(slot.el)) continue;
      if (slot.rects.some((text) => overlaps(rect, text))) conflicts.push({ path: label.path, with: slot.path });
    }
  });

  return {
    labels: found.map(({ path, rect }) => ({ path, x: rect.left, y: rect.top, width: rect.width, height: rect.height })),
    conflicts,
  };
}

/**
 * When a scene is crowded, makes its largest line-fitted text one step smaller,
 * and repeats until the scene fits or nothing can shrink further. Fitting text
 * to its own line limit does not account for how tall the scene's stack of
 * texts becomes; this does.
 */
export function relieveCrowding(
  scene: HTMLElement,
  unitPx: number,
  frame: { width: number; height: number },
  reports: SlotReport[],
): void {
  const slots = Array.from(scene.querySelectorAll<HTMLElement>("[data-sf-fit]:not([data-sf-box])"), (el) => {
    const [min = 1, , step = 1] = (el.dataset.sfFit ?? "").split(",").map(Number);
    return { el, min, step, report: reports.find((report) => report.path === el.dataset.sfPath) };
  });
  // Bounded: every pass shrinks one slot by one step, and each slot has a floor.
  for (let pass = 0; pass < 200 && isCrowded(scene); pass++) {
    let largest: (typeof slots)[number] | undefined;
    let largestSize = 0;
    for (const slot of slots) {
      const size = Math.round((Number.parseFloat(slot.el.style.fontSize) / unitPx) * 100) / 100;
      if (size - slot.step >= slot.min - 1e-9 && size > largestSize) {
        largest = slot;
        largestSize = size;
      }
    }
    if (!largest) break;
    const next = Math.round((largestSize - largest.step) * 100) / 100;
    largest.el.style.fontSize = `${next * unitPx}px`;
    if (largest.report) {
      const maxLines = largest.el.dataset.sfLines ? Number(largest.el.dataset.sfLines) : null;
      largest.report.sizePx = next * unitPx;
      largest.report.lines = measure(largest.el, maxLines, false).lines;
    }
  }
  // Shrinking one text moves the others; where each one ended up is measured last.
  for (const slot of slots) if (slot.report) slot.report.outside = isOutside(slot.el, unitPx, frame);
}

/** Nothing may come closer to the edge of the frame than this, in units. */
const SAFE_MARGIN_UNITS = 4;
/**
 * Share of the font size between the top of a text rectangle and the top of
 * capital letters. Deliberately on the low side of real fonts (Onest is about
 * 0.27), so real collisions are still caught.
 */
const ASCENDER_GAP = 0.15;

function measure(el: HTMLElement, maxLines: number | null, boxed: boolean): { lines: number; fits: boolean } {
  const style = getComputedStyle(el);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const lines = Math.max(1, Math.round((el.clientHeight - padding) / lineHeight));
  const tooWide = el.scrollWidth > el.clientWidth + 1;
  const tooTall = boxed && el.scrollHeight > el.clientHeight + 1;
  return { lines, fits: !tooWide && !tooTall && (maxLines === null || lines <= maxLines) };
}

function isOutside(el: HTMLElement, unitPx: number, frame: { width: number; height: number }): boolean {
  const rect = el.getBoundingClientRect();
  const margin = SAFE_MARGIN_UNITS * unitPx - 1;
  return (
    rect.left < margin ||
    rect.top < margin ||
    rect.right > frame.width - margin ||
    rect.bottom > frame.height - margin
  );
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

    // While a smaller size might still fit, text must not be broken to make it
    // fit: a heading may not break inside a word, and scenes use the
    // `sf-fitting` class to forbid wrapping they would otherwise allow.
    el.classList.add("sf-fitting");
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
    let fits = result.fits;
    el.classList.remove("sf-fitting");
    if (!boxed) {
      // A heading that only fits by breaking a word is drawn broken, as damage
      // control, but is still reported as not fitting.
      el.style.overflowWrap = fits ? "" : "anywhere";
      if (!fits) result = measure(el, maxLines, boxed);
    } else if (!fits) {
      // No size keeps every line unwrapped (one very long command, say). Start
      // again with wrapping allowed and take the largest size whose content
      // fits the area, rather than shrinking everything to the minimum.
      size = max;
      for (;;) {
        el.style.fontSize = `${size * unitPx}px`;
        result = measure(el, maxLines, boxed);
        const next = Math.round((size - step) * 100) / 100;
        if (result.fits || next < min) break;
        size = next;
      }
      fits = result.fits;
    }

    reports.push({
      path: el.dataset.sfPath ?? "",
      sizePx: size * unitPx,
      lines: result.lines,
      maxLines,
      chars: Array.from(el.textContent ?? "").length,
      overflow: !fits,
      outside: isOutside(el, unitPx, frame),
    });
  }
  return reports;
}
