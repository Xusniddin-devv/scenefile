import { z } from "zod";
import { durationSchema } from "../common";

export const quoteSchema = z
  .strictObject({
    type: z.literal("quote"),
    text: z.string().min(1).max(220),
    author: z.string().min(1).max(60).optional(),
    /** The author's job title or company. */
    role: z.string().min(1).max(60).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.role === undefined || scene.author !== undefined, {
    path: ["role"],
    message: '"role" describes the author, so it needs "author" as well.',
  });

export type QuoteProps = z.infer<typeof quoteSchema>;
