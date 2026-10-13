import { z } from "zod";
import { durationSchema, saySchema, transitionSchema } from "../common";

export const clipSchema = z
  .strictObject({
    type: z.literal("clip"),
    /** A video file beside the scenefile. */
    src: z.string().min(1).max(2000),
    /** Seconds into the file at which to start. */
    from: z.number().min(0).max(86_400).optional(),
    /** Seconds into the file at which to stop. */
    to: z.number().positive().max(86_400).optional(),
    /** "contain" shows the whole picture inside the frame's margins; "cover" fills the frame, cropping what does not fit. */
    fit: z.enum(["contain", "cover"]).default("contain"),
    /** How loud the clip's own sound is: 0 is silent, 1 as recorded. */
    volume: z.number().min(0).max(1).default(1),
    caption: z.string().min(1).max(80).optional(),
    /** Show what is said in the clip as captions, heard from its sound. */
    captions: z
      .union([z.boolean(), z.string().regex(/^[a-z]{2}$/)], { error: 'Must be true, false, or the two-letter code of the language spoken, such as "en" or "ru".' })
      .default(false),
    duration: durationSchema.default("auto"),
    /** How this scene arrives from the one before it. */
    transition: transitionSchema.default("auto"),
    /** Words for the narrator to speak during this scene. */
    say: saySchema.optional(),
  })
  .refine((scene) => scene.from === undefined || scene.to === undefined || scene.to > scene.from, {
    path: ["to"],
    message: '"to" must be later than "from": both are seconds into the file.',
  });

export type ClipProps = z.infer<typeof clipSchema>;
