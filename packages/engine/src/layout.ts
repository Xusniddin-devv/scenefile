import { type Diagnostic, error } from "@scenefile/schema";

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
}

export interface InspectReport {
  slots: SlotReport[];
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
          "Use fewer or shorter items, or split them across two scenes.",
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
  return diagnostics;
}
