import { type Diagnostic, type Scenefile, error, hasErrors, normalize } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { type AssetSources, type LoadedAssets, assetRefs, loadAssets, loadAudio } from "./assets";
import { type Composition, compile } from "./compile";
import { glyphDiagnostics } from "./fonts";
import { type InspectReport, verifyLayout } from "./layout";
import { type ResolvedVideo, resolve } from "./resolve";

export interface CheckResult {
  /** True when there are no errors. Warnings do not block rendering. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The scenefile with defaults filled and repairs applied; null when it failed validation. */
  scenefile: Scenefile | null;
  video: ResolvedVideo | null;
  composition: Composition | null;
  storyboard: string;
}

/**
 * A plain-text description of the video, so a model without vision can review
 * it. With a layout report, each scene also lists its text sizes and line counts.
 */
export function storyboard(video: ResolvedVideo, report?: InspectReport, music = false): string {
  const seconds = (frames: number): string => `${(frames / video.fps).toFixed(2)}s`;
  const typeWidth = Math.max(...video.scenes.map((scene) => scene.type.length));
  const lines = [
    `${video.width}x${video.height}, ${video.fps} fps, ${seconds(video.totalFrames)}, ${video.scenes.length} scenes${music ? ", music" : ""}`,
  ];
  for (const scene of video.scenes) {
    const range = `${seconds(scene.startFrame)}-${seconds(scene.startFrame + scene.durationFrames)}`;
    lines.push(
      `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}${
        scene.transition === "none"
          ? ""
          : `  (enters by ${scene.transition}${scene.overlapFrames > 0 ? ` over ${seconds(scene.overlapFrames)}` : ""})`
      }`,
    );
    const prefix = `scenes[${scene.index}].`;
    const slots = (report?.slots ?? []).filter((slot) => slot.path.startsWith(prefix));
    const images = (report?.images ?? []).filter((image) => image.path.startsWith(prefix));
    const labels = (report?.labels ?? []).filter((label) => label.path.startsWith(prefix));
    const fieldWidth = Math.max(0, ...[...slots, ...images, ...labels].map((entry) => entry.path.length - prefix.length));
    for (const slot of slots) {
      const field = slot.path.slice(prefix.length).padEnd(fieldWidth);
      const count = slot.maxLines === null ? "" : `, ${slot.lines} ${slot.lines === 1 ? "line" : "lines"}`;
      lines.push(`     ${field}  ${Math.round(slot.sizePx)}px${count}`);
    }
    for (const image of images) {
      const field = image.path.slice(prefix.length).padEnd(fieldWidth);
      lines.push(
        `     ${field}  ${image.naturalWidth}x${image.naturalHeight} image, shown at ${image.shownWidth}x${image.shownHeight}`,
      );
    }
    for (const label of labels) {
      const field = label.path.slice(prefix.length).padEnd(fieldWidth);
      lines.push(
        `     ${field}  label ${Math.round(label.width)}x${Math.round(label.height)} at ${Math.round(label.x)},${Math.round(label.y)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Everything that can be checked without a browser: validate, resolve, compile.
 * Images must be loaded first and passed in; without them, a scenefile that
 * uses images fails with ASSET_NOT_FOUND. `checkWithAssets` does both.
 */
export function check(input: unknown, loaded?: LoadedAssets): CheckResult {
  const normalized = normalize(input);
  if (!normalized.scenefile) {
    return {
      ok: false,
      diagnostics: normalized.diagnostics,
      scenefile: null,
      video: null,
      composition: null,
      storyboard: "",
    };
  }

  const assetDiagnostics = [...(loaded?.diagnostics ?? [])];
  for (const ref of assetRefs(normalized.scenefile)) {
    const reported = assetDiagnostics.some((diagnostic) => diagnostic.path === ref.path);
    if (!reported && !loaded?.assets.has(ref.src)) {
      assetDiagnostics.push(
        error(
          "ASSET_NOT_FOUND",
          ref.path,
          `The image "${ref.src}" has not been loaded.`,
          "Check the scenefile with the scenefile command, which loads its images.",
        ),
      );
    }
  }

  const wantedMusic = normalized.scenefile.audio;
  if (wantedMusic && !loaded?.audio && !assetDiagnostics.some((diagnostic) => diagnostic.path === "audio.src")) {
    assetDiagnostics.push(
      error(
        "ASSET_NOT_FOUND",
        "audio.src",
        `The music "${wantedMusic.src}" has not been loaded.`,
        "Check the scenefile with the scenefile command, which loads its files.",
      ),
    );
  }

  const resolved = resolve(normalized.scenefile, loaded?.assets);
  const diagnostics = [
    ...normalized.diagnostics,
    ...assetDiagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
  ];
  if (hasErrors(diagnostics)) {
    return {
      ok: false,
      diagnostics,
      scenefile: normalized.scenefile,
      video: resolved.video,
      composition: null,
      storyboard: "",
    };
  }

  const music = loaded?.audio ?? undefined;
  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    video: resolved.video,
    composition: { ...compile(resolved.video), ...(music ? { audio: music } : {}) },
    storyboard: storyboard(resolved.video, undefined, Boolean(music)),
  };
}

/** `check`, after loading the images the scenefile uses. */
export async function checkWithAssets(input: unknown, sources: AssetSources): Promise<CheckResult> {
  const { scenefile } = normalize(input);
  if (!scenefile) return check(input);
  const images = await loadAssets(assetRefs(scenefile), sources);
  const music = await loadAudio(scenefile, sources);
  return check(input, { ...images, audio: music.audio, diagnostics: [...images.diagnostics, ...music.diagnostics] });
}

/**
 * Adds what the browser measured to a passing check: layout diagnostics, and
 * text sizes in the storyboard. A result that already failed is returned as is.
 */
export function applyLayout(result: CheckResult, report: InspectReport): CheckResult {
  if (!result.ok || !result.video) return result;
  const diagnostics = [...result.diagnostics, ...verifyLayout(report)];
  const ok = !hasErrors(diagnostics);
  return {
    ...result,
    ok,
    diagnostics,
    composition: ok ? result.composition : null,
    storyboard: storyboard(result.video, report, Boolean(result.composition?.audio)),
  };
}
