import { z } from "zod";
import { bulletsDefinition } from "./bullets/definition";
import { bulletsSchema } from "./bullets/schema";
import { codeDefinition } from "./code/definition";
import { codeSchema } from "./code/schema";
import { outroDefinition } from "./outro/definition";
import { outroSchema } from "./outro/schema";
import { quoteDefinition } from "./quote/definition";
import { quoteSchema } from "./quote/schema";
import { statDefinition } from "./stat/definition";
import { statSchema } from "./stat/schema";
import { statementDefinition } from "./statement/definition";
import { statementSchema } from "./statement/schema";
import { terminalDefinition } from "./terminal/definition";
import { terminalSchema } from "./terminal/schema";
import { titleDefinition } from "./title/definition";
import { titleSchema } from "./title/schema";
import type { SceneDefinition } from "./types";

export const sceneSchema = z.discriminatedUnion("type", [
  titleSchema,
  statementSchema,
  quoteSchema,
  bulletsSchema,
  statSchema,
  codeSchema,
  outroSchema,
  terminalSchema,
]);
export type Scene = z.infer<typeof sceneSchema>;
export type SceneType = Scene["type"];

/**
 * The one place a definition's prop type is widened. It is sound because
 * `getScene` is only ever called with the `type` of the scene whose props are
 * then passed back in.
 */
function widen<P extends Scene>(definition: SceneDefinition<P>): SceneDefinition<Scene> {
  return definition as unknown as SceneDefinition<Scene>;
}

const registry: Record<SceneType, SceneDefinition<Scene>> = {
  title: widen(titleDefinition),
  statement: widen(statementDefinition),
  quote: widen(quoteDefinition),
  bullets: widen(bulletsDefinition),
  stat: widen(statDefinition),
  code: widen(codeDefinition),
  outro: widen(outroDefinition),
  terminal: widen(terminalDefinition),
};

export const SCENE_TYPES = Object.keys(registry) as SceneType[];

export function isSceneType(value: string): value is SceneType {
  return Object.hasOwn(registry, value);
}

export function getScene(type: SceneType): SceneDefinition<Scene> {
  return registry[type];
}

export { SHARED_CSS, sceneChrome } from "./chrome";
export { CODE_LANGS, type CodeLang, MAX_CODE_LINES } from "./code/langs";
export { durationSchema, type Duration } from "./common";
export { escapeHtml, highlightHtml, readingSeconds } from "./text";
export type {
  CompileContext,
  MountContext,
  SceneAsset,
  SceneDefinition,
  SceneHandle,
  SceneMount,
  SceneText,
} from "./types";
