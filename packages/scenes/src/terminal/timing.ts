import { readingSeconds } from "../text";

export const CHARS_PER_SECOND = 20;
export const AFTER_TYPE_SECONDS = 0.3;
export const AFTER_OUTPUT_SECONDS = 0.6;
export const TAIL_SECONDS = 0.4;

/** Times in seconds, measured from the start of the scene's hold. */
export interface StepTiming {
  typeStart: number;
  typeEnd: number;
  outputAt: number;
  end: number;
}

/**
 * Shared by the Node side (to size the scene) and the browser side (to draw
 * it), so the two can never disagree about when a step happens.
 */
export function terminalSchedule(
  steps: readonly { run: string; output?: string | undefined }[],
): StepTiming[] {
  let cursor = 0;
  return steps.map((step) => {
    const typeStart = cursor;
    const typeEnd = typeStart + Array.from(step.run).length / CHARS_PER_SECOND;
    const outputAt = typeEnd + AFTER_TYPE_SECONDS;
    const end = step.output
      ? outputAt + AFTER_OUTPUT_SECONDS + readingSeconds(step.output)
      : outputAt;
    cursor = end;
    return { typeStart, typeEnd, outputAt, end };
  });
}

export function typedLength(length: number, timing: StepTiming, seconds: number): number {
  const typed = Math.floor((seconds - timing.typeStart) * CHARS_PER_SECOND);
  return Math.min(length, Math.max(0, typed));
}
