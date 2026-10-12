import { z } from "zod";
import { durationSchema, saySchema, transitionSchema } from "../common";

const stepSchema = z.strictObject({
  run: z.string().min(1).max(120),
  output: z.string().min(1).max(400).optional(),
});

export const terminalSchema = z.strictObject({
  type: z.literal("terminal"),
  steps: z.array(stepSchema).min(1).max(6),
  duration: durationSchema.default("auto"),
  /** How this scene arrives from the one before it. */
  transition: transitionSchema.default("auto"),
  /** Words for the narrator to speak during this scene. */
  say: saySchema.optional(),
});

export type TerminalProps = z.infer<typeof terminalSchema>;
