import { z } from "zod";
import { durationSchema } from "../common";

export const titleSchema = z.strictObject({
  type: z.literal("title"),
  heading: z.string().min(1).max(80),
  sub: z.string().min(1).max(140).optional(),
  duration: durationSchema.default("auto"),
});

export type TitleProps = z.infer<typeof titleSchema>;
