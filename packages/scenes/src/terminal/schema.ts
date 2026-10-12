import { z } from "zod";
import { durationSchema } from "../common";

const stepSchema = z.strictObject({
  run: z.string().min(1).max(120),
  output: z.string().min(1).max(400).optional(),
});

export const terminalSchema = z.strictObject({
  type: z.literal("terminal"),
  steps: z.array(stepSchema).min(1).max(6),
  duration: durationSchema.default("auto"),
});

export type TerminalProps = z.infer<typeof terminalSchema>;
