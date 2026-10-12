import { type Diagnostic, error, warning } from "@scenefile/schema";

/** What the browser reports for one fitted piece of text. */
export interface SlotReport {
  /** Scenefile path of the text, e.g. `scenes[0].heading`. */
  path: string;
  /** Final font size. */
  sizePx: number;
  lines: number;
  /** Line limit, or null when the text must fit a fixed-height area instead. */
  maxLines: number | null;
  /** Characters of text in the slot. */
  chars: number;
  /** True when the text does not fit even at its smallest size. */
  overflow: boolean;
  /** True when the text reaches into the frame's safe margin. */
  outside: boolean;
  /** True when lines that should have stayed whole (code, commands) had to be wrapped to fit. */
  wrapped?: boolean;
}

/** What the browser reports for one image. */
export interface ImageReport {
  /** Scenefile path of the field naming the image, e.g. `scenes[2].src`. */
  path: string;
  naturalWidth: number;
  naturalHeight: number;
  /** The size the image is laid out at, in frame pixels. */
  shownWidth: number;
  shownHeight: number;
}

/** An image may be enlarged this much before it is called soft. */
const MAX_UPSCALE = 1.25;

/** Where a fixed-size label (a callout, a side label) ended up, in frame pixels. */
export interface LabelReport {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A label that is not where it can be read. `with` is "frame", "counter", or the path of what it overlaps. */
export interface ConflictReport {
  path: string;
  with: string;
}

/** An image shown smaller than this on either side, in pixels, is a sliver rather than a picture. */
const MIN_SHOWN_SIDE = 54;

export interface InspectReport {
  slots: SlotReport[];
  images?: ImageReport[];
  /** Paths of images the browser could not decode. */
  broken?: string[];
  labels?: LabelReport[];
  conflicts?: ConflictReport[];
  /** Indexes of scenes whose content reaches up into the scene counter at the top of the frame. */
  crowded?: number[];
}

/** Share of the computed character budget to recommend, leaving room for wide letters. */
const BUDGET_SPARE = 0.9;

/** Turns browser measurements into diagnostics a model can act on without seeing the frame. */
export function verifyLayout(report: InspectReport): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const slot of report.slots) {
    if (slot.overflow && slot.maxLines !== null && slot.lines <= slot.maxLines) {
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          "A word in this text is too long to fit on one line, even at its smallest size, so it was broken.",
          "Use shorter words, or add spaces or hyphens where the text may break.",
        ),
      );
    } else if (slot.overflow && slot.maxLines !== null) {
      const perLine = slot.chars / Math.max(slot.lines, 1);
      const budget = Math.max(1, Math.floor(perLine * slot.maxLines * BUDGET_SPARE));
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          `This text needs ${slot.lines} lines at its smallest size; only ${slot.maxLines} fit.`,
          `Shorten it to about ${budget} characters (it has ${slot.chars}).`,
        ),
      );
    } else if (slot.overflow) {
      diagnostics.push(
        error(
          "TEXT_OVERFLOW",
          slot.path,
          "This content is taller than the scene, even at its smallest size.",
          "Use fewer or shorter lines or items, or split them across two scenes.",
        ),
      );
    } else if (slot.wrapped) {
      diagnostics.push(
        warning(
          "TEXT_WRAPPED",
          slot.path,
          "Some lines here are too long for the frame and continue on the next line.",
          "Make the longest lines shorter: about 60 characters fit across a wide frame, about 30 across a tall one.",
        ),
      );
    } else if (slot.outside) {
      diagnostics.push(
        error(
          "SAFE_AREA",
          slot.path,
          "This text reaches the edge of the frame, where players and phones may crop it.",
          "Shorten it.",
        ),
      );
    }
  }
  for (const path of report.broken ?? []) {
    diagnostics.push(
      error(
        "ASSET_UNSUPPORTED",
        path,
        "The browser could not decode this image; the file is damaged or incomplete.",
        "Export the image again as PNG or JPEG, or download it again.",
      ),
    );
  }
  for (const conflict of report.conflicts ?? []) {
    const move = "Move the callout (change its x or y), or shorten the label.";
    if (conflict.with === "frame") {
      diagnostics.push(error("SAFE_AREA", conflict.path, "This label runs off the frame.", move));
    } else if (conflict.with === "counter") {
      diagnostics.push(
        error("LABEL_OVERLAP", conflict.path, "This label covers the scene counter at the top of the frame.", move),
      );
    } else {
      diagnostics.push(error("LABEL_OVERLAP", conflict.path, `This label overlaps ${conflict.with}.`, move));
    }
  }
  for (const image of report.images ?? []) {
    if (report.broken?.includes(image.path)) continue;
    if (image.shownWidth < MIN_SHOWN_SIDE || image.shownHeight < MIN_SHOWN_SIDE) {
      diagnostics.push(
        warning(
          "IMAGE_TINY",
          image.path,
          `This image is shown only ${image.shownWidth}x${image.shownHeight} pixels: its shape does not suit this frame.`,
          "Crop the image closer to the shape of the frame.",
        ),
      );
    }
    if (image.shownWidth > image.naturalWidth * MAX_UPSCALE) {
      diagnostics.push(
        warning(
          "ASSET_LOW_RES",
          image.path,
          `This image is ${image.naturalWidth}x${image.naturalHeight} pixels but is shown at ${image.shownWidth}x${image.shownHeight}, so it will look soft.`,
          `Use an image at least ${image.shownWidth} pixels wide.`,
        ),
      );
    }
  }
  for (const index of report.crowded ?? []) {
    const path = `scenes[${index}]`;
    // One error per scene is enough; an overflow in it already says to shorten.
    if (diagnostics.some((d) => d.path === path || d.path.startsWith(`${path}.`))) continue;
    diagnostics.push(
      error(
        "SAFE_AREA",
        path,
        "This scene has more content than fits: it runs into the top of the frame.",
        "Shorten the text in this scene, or move part of it to another scene.",
      ),
    );
  }
  return diagnostics;
}
