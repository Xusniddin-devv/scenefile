import { z } from "zod";
import { durationSchema } from "../common";

export const statementSchema = z
  .strictObject({
    type: z.literal("statement"),
    text: z.string().min(1).max(140),
    /** A part of the text to draw in the accent color. */
    highlight: z.string().min(1).max(140).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.text.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "text", written exactly as it appears there.',
  });

export type StatementProps = z.infer<typeof statementSchema>;
