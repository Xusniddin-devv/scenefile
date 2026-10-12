import type { Format } from "@scenefile/schema";

export const FORMAT_SIZES: Record<Format, { width: number; height: number }> = {
  "landscape-1080p": { width: 1920, height: 1080 },
  "portrait-1080p": { width: 1080, height: 1920 },
  "square-1080p": { width: 1080, height: 1080 },
};
