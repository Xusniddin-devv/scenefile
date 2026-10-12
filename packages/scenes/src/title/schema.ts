import { z } from "zod";
import { durationSchema, transitionSchema } from "../common";

export const titleSchema = z
  .strictObject({
    type: z.literal("title"),
    heading: z.string().min(1).max(80),
    /** A part of the heading to draw in the accent color. */
    highlight: z.string().min(1).max(80).optional(),
    sub: z.string().min(1).max(140).optional(),
    duration: durationSchema.default("auto"),
    /** How this scene arrives from the one before it. */
    transition: transitionSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.heading.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "heading", written exactly as it appears there.',
  });

export type TitleProps = z.infer<typeof titleSchema>;
