import { z } from "zod";
import { durationSchema, saySchema, transitionSchema } from "../common";

export const statementSchema = z
  .strictObject({
    type: z.literal("statement"),
    text: z.string().min(1).max(140),
    /** A part of the text to draw in the accent color. */
    highlight: z.string().min(1).max(140).optional(),
    duration: durationSchema.default("auto"),
    /** How this scene arrives from the one before it. */
    transition: transitionSchema.default("auto"),
    /** Words for the narrator to speak during this scene. */
    say: saySchema.optional(),
  })
  .refine((scene) => scene.highlight === undefined || scene.text.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "text", written exactly as it appears there.',
  });

export type StatementProps = z.infer<typeof statementSchema>;
