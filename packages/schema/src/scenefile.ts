import { sceneSchema, transitionSchema } from "@scenefile/scenes";
import { z } from "zod";

export const FORMATS = ["landscape-1080p", "portrait-1080p", "square-1080p"] as const;
export const THEMES = ["signal", "midnight", "paper", "cobalt", "solar"] as const;
/** Narrator voices: language, then the voice's name. Where each comes from is in the voice catalog. */
export const VOICES = ["en-joe", "en-kristin", "en-bryce", "ru-denis", "ru-dmitri"] as const;

export const scenefileSchema = z.strictObject({
  version: z.literal(1),
  format: z.enum(FORMATS).default("landscape-1080p"),
  fps: z.literal([30, 60]).default(30),
  theme: z.enum(THEMES).default("signal"),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a six-digit hex color like #FF5722.")
    .optional(),
  /** Music to play under the whole video: a file beside the scenefile. */
  audio: z
    .strictObject({
      src: z.string().min(1).max(2000),
      /** From 0 (silent) to 1 (as loud as the file). */
      volume: z.number().min(0).max(1).default(0.4),
    })
    .optional(),
  /** Who reads the scenes' `say` text aloud. */
  voice: z
    .strictObject({
      name: z.enum(VOICES).default("en-kristin"),
      /** Show the words at the foot of the frame as they are spoken. */
      captions: z.boolean().default(false),
    })
    .optional(),
  /** How scenes give way to one another, unless a scene says otherwise. */
  transition: transitionSchema.default("auto"),
  scenes: z.array(sceneSchema).min(1).max(60),
});

export type Scenefile = z.infer<typeof scenefileSchema>;
export type Format = (typeof FORMATS)[number];
export type ThemeName = (typeof THEMES)[number];
export type VoiceName = (typeof VOICES)[number];

export const TOP_LEVEL_FIELDS: readonly string[] = Object.keys(scenefileSchema.shape);

/**
 * The scenefile as a JSON Schema, for tools that can enforce one on a model's
 * output. It describes what may be written; rules that span fields (a
 * highlight must appear in its text) are checked by `normalize`, not here.
 */
export function scenefileJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(scenefileSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
