import { type Diagnostic, type Scenefile, hasErrors, normalize } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { type Composition, compile } from "./compile";
import { glyphDiagnostics } from "./fonts";
import { type ResolvedVideo, resolve } from "./resolve";

export interface CheckResult {
  /** True when there are no errors. Warnings do not block rendering. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The scenefile with defaults filled and repairs applied; null when it failed validation. */
  scenefile: Scenefile | null;
  composition: Composition | null;
  storyboard: string;
}

/** A plain-text description of the video, so a model without vision can review it. */
export function storyboard(video: ResolvedVideo): string {
  const seconds = (frames: number): string => `${(frames / video.fps).toFixed(2)}s`;
  const typeWidth = Math.max(...video.scenes.map((scene) => scene.type.length));
  const header = `${video.width}x${video.height}, ${video.fps} fps, ${seconds(video.totalFrames)}, ${video.scenes.length} scenes`;
  const lines = video.scenes.map((scene) => {
    const range = `${seconds(scene.startFrame)}-${seconds(scene.startFrame + scene.durationFrames)}`;
    return `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}`;
  });
  return [header, ...lines].join("\n");
}

/** The whole pre-render pipeline: validate, resolve, compile. Pure. */
export function check(input: unknown): CheckResult {
  const normalized = normalize(input);
  if (!normalized.scenefile) {
    return { ok: false, diagnostics: normalized.diagnostics, scenefile: null, composition: null, storyboard: "" };
  }

  const resolved = resolve(normalized.scenefile);
  const diagnostics = [
    ...normalized.diagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics, scenefile: normalized.scenefile, composition: null, storyboard: "" };
  }

  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    composition: compile(resolved.video),
    storyboard: storyboard(resolved.video),
  };
}
