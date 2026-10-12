import { z } from "zod";
import { durationSchema } from "../common";

export const statSchema = z.strictObject({
  type: z.literal("stat"),
  /** The figure as it should read, with its unit: "94%", "1,200+", "3.2x". */
  value: z.string().min(1).max(12),
  label: z.string().min(1).max(50),
  note: z.string().min(1).max(120).optional(),
  duration: durationSchema.default("auto"),
});

export type StatProps = z.infer<typeof statSchema>;
