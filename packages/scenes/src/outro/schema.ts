import { z } from "zod";
import { durationSchema, transitionSchema } from "../common";

export const outroSchema = z
  .strictObject({
    type: z.literal("outro"),
    heading: z.string().min(1).max(60),
    /** A part of the heading to draw in the accent color. */
    highlight: z.string().min(1).max(60).optional(),
    /** A command for the viewer to run, typed out. */
    command: z.string().min(1).max(80).optional(),
    url: z.string().min(1).max(80).optional(),
    duration: durationSchema.default("auto"),
    /** How this scene arrives from the one before it. */
    transition: transitionSchema.default("auto"),
  })
  .refine((scene) => scene.highlight === undefined || scene.heading.includes(scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be a part of "heading", written exactly as it appears there.',
  });

export type OutroProps = z.infer<typeof outroSchema>;
