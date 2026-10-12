import { z } from "zod";
import { durationSchema, transitionSchema } from "../common";

export const bulletsSchema = z.strictObject({
  type: z.literal("bullets"),
  heading: z.string().min(1).max(60).optional(),
  items: z.array(z.string().min(1).max(70)).min(2).max(5),
  duration: durationSchema.default("auto"),
  /** How this scene arrives from the one before it. */
  transition: transitionSchema.default("auto"),
});

export type BulletsProps = z.infer<typeof bulletsSchema>;
