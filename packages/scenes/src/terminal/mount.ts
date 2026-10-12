import { fadeExit, staggerEnter } from "../motion";
import type { SceneMount } from "../types";
import { graphemes, terminalSchedule, typedLength } from "./timing";

export const mountTerminal: SceneMount = (el, ctx) => {
  const steps = Array.from(el.querySelectorAll<HTMLElement>(".sf-terminal__step")).map((stepEl) => {
    const typed = stepEl.querySelector<HTMLElement>("[data-sf-type]");
    const caret = stepEl.querySelector<HTMLElement>(".sf-terminal__caret");
    const out = stepEl.querySelector<HTMLElement>("[data-sf-out]");
    if (!typed || !caret) throw new Error("terminal scene markup is missing its command elements");
    return {
      stepEl,
      typed,
      caret,
      out,
      // Whole graphemes, so slicing never shows part of an emoji.
      chars: graphemes(typed.dataset.sfType ?? ""),
      output: out?.textContent ?? undefined,
    };
  });
  const schedule = terminalSchedule(
    steps.map((step) => ({ run: step.chars.join(""), output: step.output })),
  );

  return {
    seek(frame) {
      staggerEnter(el, ctx, frame);
      fadeExit(el, ctx, frame);
      const seconds = (frame - ctx.enterFrames) / ctx.fps;
      steps.forEach((step, i) => {
        const timing = schedule[i];
        if (!timing) return;
        const next = schedule[i + 1];
        const started = i === 0 || seconds >= timing.typeStart;
        const current = started && (!next || seconds < next.typeStart);
        step.stepEl.style.visibility = started ? "visible" : "hidden";
        step.typed.textContent = step.chars
          .slice(0, typedLength(step.chars.length, timing, seconds))
          .join("");
        step.caret.style.visibility = current ? "visible" : "hidden";
        if (step.out) step.out.style.visibility = seconds >= timing.outputAt ? "visible" : "hidden";
      });
    },
  };
};
