import { z } from "zod";
import { terminalDefinition } from "./terminal/definition";
import { terminalSchema } from "./terminal/schema";
import { titleDefinition } from "./title/definition";
import { titleSchema } from "./title/schema";
import type { SceneDefinition } from "./types";

export const sceneSchema = z.discriminatedUnion("type", [titleSchema, terminalSchema]);
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
export { durationSchema, type Duration } from "./common";
export { escapeHtml, readingSeconds } from "./text";
export type {
  CompileContext,
  MountContext,
  SceneDefinition,
  SceneHandle,
  SceneMount,
  SceneText,
} from "./types";
