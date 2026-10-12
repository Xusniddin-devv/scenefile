import { z } from "zod";
import { durationSchema, transitionSchema } from "../common";

const calloutSchema = z.strictObject({
  /** Where the callout points: 0 is the image's left edge, 1 its right. */
  x: z.number().min(0).max(1),
  /** 0 is the image's top edge, 1 its bottom. */
  y: z.number().min(0).max(1),
  label: z.string().min(1).max(40),
});

export const screenshotSchema = z.strictObject({
  type: z.literal("screenshot"),
  /** The image: a file beside the scenefile, or an https address. */
  src: z.string().min(1).max(2000),
  /** An address to show above the image, as in a browser. */
  url: z.string().min(1).max(80).optional(),
  caption: z.string().min(1).max(80).optional(),
  callouts: z.array(calloutSchema).min(1).max(3).optional(),
  duration: durationSchema.default("auto"),
  /** How this scene arrives from the one before it. */
  transition: transitionSchema.default("auto"),
});

export type ScreenshotProps = z.infer<typeof screenshotSchema>;
