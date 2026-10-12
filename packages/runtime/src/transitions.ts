function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A number as CSS text, with rounding fixed so a frame always produces the same string. */
function css(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Styles the outgoing and incoming scenes for one frame of a transition.
 * `progress` runs from just above 0 to just below 1. The incoming scene is
 * drawn above the outgoing one and is opaque, so fading it in is a dissolve.
 * Everything set here is cleared by the runtime before the next frame is drawn.
 */
export function applyTransition(
  kind: string,
  from: HTMLElement,
  to: HTMLElement,
  progress: number,
  stage: { wipe: HTMLElement | null; width: number },
): void {
  const p = easeInOutCubic(progress);
  to.style.zIndex = "1";
  switch (kind) {
    case "push":
      from.style.transform = `translateX(${css(-100 * p)}%)`;
      to.style.transform = `translateX(${css(100 * (1 - p))}%)`;
      break;
    case "wipe":
      // The new scene is uncovered from the left, behind a lime edge.
      to.style.clipPath = `inset(0 ${css(100 * (1 - p))}% 0 0)`;
      if (stage.wipe) {
        stage.wipe.hidden = false;
        stage.wipe.style.left = `${css(stage.width * p)}px`;
        // The edge starts and ends at the frame's own edge, where it would read
        // as a lime border if it simply sat there; it fades in and out instead.
        stage.wipe.style.opacity = css(Math.min(1, Math.min(progress, 1 - progress) * 6));
      }
      break;
    case "zoom":
      from.style.transform = `scale(${css(1 + 0.08 * p)})`;
      to.style.transform = `scale(${css(0.94 + 0.06 * p)})`;
      to.style.opacity = css(p);
      break;
    case "crossfade":
      to.style.opacity = css(p);
      break;
    default:
      break;
  }
}
