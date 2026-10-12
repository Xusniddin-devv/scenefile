import { z } from "zod";

export const durationSchema = z.union([z.literal("auto"), z.number().positive().max(120)], {
  error: 'Must be "auto" or a number of seconds, more than 0 and at most 120.',
});
export type Duration = z.infer<typeof durationSchema>;

/** Words for the narrator to speak while the scene is on screen. */
export const saySchema = z.string().min(1).max(500);

/** The ways one scene can give way to the next. */
export const TRANSITIONS = ["cut", "fade", "crossfade", "push", "wipe", "zoom"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

/** How a scene arrives. "auto" lets the engine choose from the kinds of scene involved. */
export const transitionSchema = z.enum(["auto", ...TRANSITIONS]);
