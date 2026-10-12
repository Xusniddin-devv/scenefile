import {
  type AssetSources,
  type CheckResult,
  type Composition,
  type InspectReport,
  type Speak,
  applyLayout,
  checkWithAssets,
} from "@scenefile/engine";
import { error } from "@scenefile/schema";
import { inspectComposition } from "./inspect";
import { hasSound, probeClip } from "./probe";

export interface PrepareOptions extends AssetSources {
  /** Replaces measuring the layout in Chromium. For tests. */
  inspect?: (composition: Composition) => Promise<InspectReport>;
  /** Replaces asking ffprobe whether the music has a sound track. For tests. */
  hasSound?: (file: string) => Promise<boolean>;
  /** Makes the narration. Without it, narrated scenes are timed by estimate and rendered silent. */
  speak?: Speak;
}

/**
 * Everything that happens to a parsed scenefile before it is rendered: its
 * files are loaded, it is checked, its music is confirmed to have sound, and
 * its layout is measured in the browser. The command line and the MCP server
 * both go through here, so they cannot disagree about what is valid.
 */
export async function prepareScenefile(input: unknown, options: PrepareOptions): Promise<CheckResult> {
  const { inspect, hasSound: probeSound, ...sources } = options;
  const result = await checkWithAssets(input, { probeClip, ...sources });
  if (!result.ok || !result.composition) return result;

  // The first bytes said it was audio; make sure there is sound ffmpeg can actually read.
  const music = result.composition.audio;
  if (music && !(await (probeSound ?? hasSound)(music.file))) {
    const diagnostic = error(
      "ASSET_UNSUPPORTED",
      "audio.src",
      "This file has no sound that can be read: it is damaged, or it is not really an audio file.",
      "Use a different music file, or convert this one to MP3 or WAV.",
    );
    return { ...result, ok: false, composition: null, diagnostics: [...result.diagnostics, diagnostic] };
  }
  return applyLayout(result, await (inspect ?? inspectComposition)(result.composition));
}
