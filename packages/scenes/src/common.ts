import { z } from "zod";

export const durationSchema = z.union([z.literal("auto"), z.number().positive().max(120)], {
  error: 'Must be "auto" or a number of seconds, more than 0 and at most 120.',
});
export type Duration = z.infer<typeof durationSchema>;
