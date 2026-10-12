import type { CompileContext } from "../src/types";

/** A 1x1 PNG, reported as 1280x720 so scenes lay it out like a real screenshot. */
export const STUB_ASSET = {
  id: "stub",
  dataUri:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  width: 1280,
  height: 720,
};

/** A compile context for tests: a landscape 1080p frame in which every image exists. */
export function context(index = 0, total = 1): CompileContext {
  return {
    index,
    total,
    path: `scenes[${index}]`,
    frame: { width: 1920, height: 1080, unit: 10.8 },
    asset: () => STUB_ASSET,
    clip: () => ({ width: 1280, height: 720 }),
  };
}
