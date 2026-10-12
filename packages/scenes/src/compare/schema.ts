import { z } from "zod";
import { durationSchema, transitionSchema } from "../common";

const sideSchema = z
  .strictObject({
    /** A short name for this side. Defaults to "Before" or "After". */
    label: z.string().min(1).max(24).optional(),
    text: z.string().min(1).max(160).optional(),
    /** An image: a file beside the scenefile, or an https address. */
    src: z.string().min(1).max(2000).optional(),
  })
  .refine((side) => (side.text === undefined) !== (side.src === undefined), {
    message: 'Give this side either "text" or "src": one of them, not both.',
  });

export const compareSchema = z.strictObject({
  type: z.literal("compare"),
  before: sideSchema,
  after: sideSchema,
  duration: durationSchema.default("auto"),
  /** How this scene arrives from the one before it. */
  transition: transitionSchema.default("auto"),
});

export type CompareProps = z.infer<typeof compareSchema>;
export type CompareSide = z.infer<typeof sideSchema>;
