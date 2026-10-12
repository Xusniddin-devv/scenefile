import { z } from "zod";
import { durationSchema } from "../common";
import { CODE_LANGS, LANG_ALIASES, MAX_CODE_LINES } from "./langs";

function lineCount(source: string): number {
  return source.split(/\r\n?|\n/).length;
}

const langSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const name = value.trim().toLowerCase();
  return LANG_ALIASES[name] ?? name;
}, z.enum(CODE_LANGS));

export const codeSchema = z
  .strictObject({
    type: z.literal("code"),
    lang: langSchema.default("text"),
    source: z.string().min(1).max(2000),
    /** Line numbers, from 1, to draw attention to. */
    highlight: z.array(z.number().int().min(1)).min(1).max(MAX_CODE_LINES).optional(),
    caption: z.string().min(1).max(80).optional(),
    duration: durationSchema.default("auto"),
  })
  .refine((scene) => lineCount(scene.source) <= MAX_CODE_LINES, {
    path: ["source"],
    message: `"source" is longer than ${MAX_CODE_LINES} lines, the most one scene can show. Show the part that matters, or split it across scenes.`,
  })
  .refine((scene) => (scene.highlight ?? []).every((line) => line <= lineCount(scene.source)), {
    path: ["highlight"],
    message: '"highlight" names a line number that "source" does not have. Lines are counted from 1.',
  });

export type CodeProps = z.infer<typeof codeSchema>;
