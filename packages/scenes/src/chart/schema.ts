import { z } from "zod";
import { durationSchema, saySchema, transitionSchema } from "../common";

export const chartSchema = z
  .strictObject({
    type: z.literal("chart"),
    heading: z.string().min(1).max(60).optional(),
    bars: z
      .array(z.strictObject({ label: z.string().min(1).max(28), value: z.number().min(0).max(1e12) }))
      .min(2)
      .max(6),
    /** Written after every value: "ms", "%", "x". */
    unit: z.string().min(1).max(6).optional(),
    /** The label of the bar to draw in the accent color. */
    highlight: z.string().min(1).max(28).optional(),
    duration: durationSchema.default("auto"),
    /** How this scene arrives from the one before it. */
    transition: transitionSchema.default("auto"),
    /** Words for the narrator to speak during this scene. */
    say: saySchema.optional(),
  })
  .refine((scene) => scene.highlight === undefined || scene.bars.some((bar) => bar.label === scene.highlight), {
    path: ["highlight"],
    message: '"highlight" must be the "label" of one of the bars, written exactly as it appears there.',
  })
  .refine((scene) => scene.bars.some((bar) => bar.value > 0), {
    path: ["bars"],
    message: "At least one bar must have a value above 0, or there is nothing to draw.",
  });

export type ChartProps = z.infer<typeof chartSchema>;
