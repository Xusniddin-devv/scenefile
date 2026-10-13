import { type Diagnostic, type Scenefile, error, hasErrors, normalize, warning } from "@scenefile/schema";
import { getScene } from "@scenefile/scenes";
import { type AssetSources, type ClipInfo, type LoadedAssets, MAX_CLIP_SIDE, assetRefs, clipRefs, loadAssets, loadAudio, loadClips } from "./assets";
import { type Composition, compile } from "./compile";
import { displayFace, glyphDiagnostics } from "./fonts";
import { FONT_FAMILIES, getTheme } from "./themes";
import { type InspectReport, verifyLayout } from "./layout";
import { type ResolvedVideo, resolve } from "./resolve";
import { DEFAULT_VOICE, MAX_SPEECH_CHARACTERS, type Speak, type Speech } from "./voice";

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
    `${video.width}x${video.height}, ${video.fps} fps, ${seconds(video.totalFrames)}, ${video.scenes.length} ${video.scenes.length === 1 ? "scene" : "scenes"}${music ? ", music" : ""}${video.scenes.some((scene) => scene.speech) ? ", voice" : ""}${video.captions ? ", captions" : ""}`,
  ];
  for (const scene of video.scenes) {
    const range = `${seconds(scene.startFrame)}-${seconds(scene.startFrame + scene.durationFrames)}`;
    lines.push(
      `${scene.index + 1}. ${scene.type.padEnd(typeWidth)}  ${range}  ${getScene(scene.type).summary(scene.props)}${
        scene.clip?.totalSeconds === undefined ? "" : ` of ${scene.clip.totalSeconds.toFixed(2)}s`
      }${
        scene.transition === "none"
          ? ""
          : `  (enters by ${scene.transition}${scene.overlapFrames > 0 ? ` over ${seconds(scene.overlapFrames)}` : ""})`
      }`,
    );
    if (scene.speech) {
      const about = scene.speech.file === undefined ? "about " : "";
      lines.push(`     say  ${about}${scene.speech.seconds.toFixed(1)}s of speech from ${seconds(scene.speech.startFrame)}`);
    }
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

const SCRIPT = { en: /\p{Script=Latin}/gu, ru: /\p{Script=Cyrillic}/gu } as const;
const OTHER = { en: /\p{Script=Cyrillic}/gu, ru: /\p{Script=Latin}/gu } as const;
const SPEAKER = { en: "en-emma", ru: "ru-denis" } as const;

/** Problems with what the narrator is asked to say, found without making any sound. */
function voiceDiagnostics(scenefile: Scenefile): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const voice = scenefile.voice?.name ?? DEFAULT_VOICE;
  const language = voice.slice(0, 2) as keyof typeof SCRIPT;
  let characters = 0;
  for (const [index, scene] of scenefile.scenes.entries()) {
    if (scene.say === undefined) continue;
    characters += scene.say.length;
    const own = scene.say.match(SCRIPT[language])?.length ?? 0;
    const foreign = scene.say.match(OTHER[language])?.length ?? 0;
    const path = `scenes[${index}].say`;
    if (foreign > own) {
      const other = language === "en" ? "ru" : "en";
      diagnostics.push(
        error(
          "VOICE_LANGUAGE",
          path,
          `The voice "${voice}" speaks ${language === "en" ? "English" : "Russian"}, but this line is written in another language; it would come out as noise.`,
          `Set "voice": { "name": "${SPEAKER[other]}" } at the top of the scenefile, or write the line in the voice's language.`,
        ),
      );
    } else if (/https?:\/\/|www\.|\b[\w-]+\.[a-z]{2,}\/\S|\p{Extended_Pictographic}/u.test(scene.say)) {
      diagnostics.push(
        warning(
          "VOICE_UNSPEAKABLE",
          path,
          "This line has a web address or an emoji in it, which a voice reads badly or not at all.",
          'Say it in words ("example dot com"), or leave it to the text on screen.',
        ),
      );
    }
  }
  if (characters > MAX_SPEECH_CHARACTERS) {
    diagnostics.push(
      error(
        "VOICE_TOO_LONG",
        "scenes",
        `There are ${characters} characters of narration; more than ${MAX_SPEECH_CHARACTERS} would run past the ten minutes a video may last.`,
        "Shorten the `say` lines or remove some.",
      ),
    );
  }
  return diagnostics;
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

  const assetDiagnostics = [...(loaded?.diagnostics ?? []), ...voiceDiagnostics(normalized.scenefile)];
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

  for (const ref of clipRefs(normalized.scenefile)) {
    const picture = loaded?.clips?.get(ref.src);
    if (picture && Math.max(picture.width, picture.height) > MAX_CLIP_SIDE) {
      assetDiagnostics.push(
        error("ASSET_TOO_LARGE", ref.path, `"${ref.src}" is ${picture.width}x${picture.height}; a clip may be at most ${MAX_CLIP_SIDE} pixels on a side.`, "Make a smaller copy of the video and use that."),
      );
    }
    const reported = assetDiagnostics.some((diagnostic) => diagnostic.path === ref.path);
    if (!reported && !loaded?.clips?.has(ref.src)) {
      assetDiagnostics.push(
        error("ASSET_NOT_FOUND", ref.path, `The video "${ref.src}" has not been read.`, "Check the scenefile with the scenefile command, which reads its files."),
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

  const resolved = resolve(normalized.scenefile, loaded?.assets, loaded?.speech, loaded?.clips);
  const notes: Diagnostic[] = [];
  const headings = displayFace(resolved.video);
  if (headings.missing.length > 0) {
    const theme = getTheme(resolved.video.theme);
    notes.push(
      warning(
        "FONT_FALLBACK",
        "theme",
        `The "${resolved.video.theme}" theme's heading face, ${FONT_FAMILIES[theme.fontDisplay]}, cannot draw ${headings.missing.slice(0, 8).join(" ")}, so headings are set in ${FONT_FAMILIES[theme.fontSans]} instead.`,
        "Nothing needs fixing. For this text, a theme whose headings use Onest, Geologica or the monospace face keeps its own look.",
      ),
    );
  }
  for (const [index, scene] of normalized.scenefile.scenes.entries()) {
    const footage = scene.type === "clip" ? loaded?.clips?.get(scene.src) : undefined;
    if (scene.type === "clip" && footage) {
      const at = `scenes[${index}]`;
      if (footage.hdr) {
        notes.push(warning("CLIP_HDR", `${at}.src`, "This footage is HDR. It is drawn without being converted, so its colors will look flat and pale.", "Convert it to ordinary (SDR) video first, for example by exporting it from the phone or editor as SDR."));
      }
      if (scene.say !== undefined && footage.audio && scene.volume > 0.3) {
        notes.push(warning("VOICE_OVER_SOUND", `${at}.volume`, "This clip is narrated and also plays its own sound at full level, so the two will be heard on top of each other.", 'Set "volume" to 0 to hear only the narration, or to about 0.2 to keep the clip\'s sound underneath.'));
      }
      if (scene.transition !== "auto" && scene.transition !== "cut") {
        notes.push(warning("FIELD_IGNORED", `${at}.transition`, "Footage is cut to and cut from, so this transition is not used.", 'Remove "transition" from the clip.'));
      }
      const shown = Math.min(scene.to ?? footage.seconds, footage.seconds) - (scene.from ?? 0);
      if (scene.duration !== "auto" && scene.duration > shown + 0.05) {
        notes.push(warning("FIELD_IGNORED", `${at}.duration`, `A clip lasts as long as the footage it shows, ${shown.toFixed(1)}s here; "duration" can only shorten it.`, 'Remove "duration", or show more of the clip with "from" and "to".'));
      }
    }
    if (scene.type === "clip" && scene.fit === "cover" && scene.caption !== undefined) {
      notes.push(warning("FIELD_IGNORED", `scenes[${index}].caption`, "A clip that fills the frame leaves no room for a caption, so it is not shown.", 'Remove "caption", or remove "fit" to show the clip inside the frame with its caption.'));
    }
    if (scene.type !== "screenshot" || scene.device !== "phone") continue;
    const picture = loaded?.assets.get(scene.src);
    if (picture && picture.width / picture.height > 0.75) {
      notes.push(
        warning(
          "IMAGE_NOT_PHONE",
          `scenes[${index}].device`,
          `This picture is ${picture.width}x${picture.height}: wider than a phone's screen, so it will look squashed inside a phone.`,
          'Use a tall picture (capture with the phone device), or remove "device".',
        ),
      );
    }
    if (scene.url !== undefined) {
      notes.push(warning("FIELD_IGNORED", `scenes[${index}].url`, "A phone has no address bar, so this address is not shown.", 'Remove "url", or remove "device" to show a browser bar.'));
    }
  }
  const diagnostics = [
    ...normalized.diagnostics,
    ...assetDiagnostics,
    ...resolved.diagnostics,
    ...glyphDiagnostics(resolved.video),
    ...notes,
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
  const { fps } = resolved.video;
  const narration = resolved.video.scenes.flatMap(({ speech }) =>
    speech?.file === undefined ? [] : [{ file: speech.file, atSeconds: speech.startFrame / fps, seconds: speech.seconds }],
  );
  return {
    ok: true,
    diagnostics,
    scenefile: normalized.scenefile,
    video: resolved.video,
    composition: {
      ...compile(resolved.video),
      ...(music ? { audio: music } : {}),
      ...(narration.length > 0 ? { narration } : {}),
    },
    storyboard: storyboard(resolved.video, undefined, Boolean(music)),
  };
}

/** `check`, after loading the images the scenefile uses. */
export async function checkWithAssets(
  input: unknown,
  sources: AssetSources & {
    /** Makes the narration. Without it, narrated scenes are timed by estimate. */
    speak?: Speak;
    /** Reads a video file's size, length and sound. Without it, clips cannot be used. */
    probeClip?: (file: string) => Promise<ClipInfo | null>;
  },
): Promise<CheckResult> {
  const { scenefile } = normalize(input);
  if (!scenefile) return check(input);
  const images = await loadAssets(assetRefs(scenefile), sources);
  const music = await loadAudio(scenefile, sources);

  const speech = new Map<number, Speech>();
  const spoken: Diagnostic[] = [];
  const footage = await loadClips(clipRefs(scenefile), sources);
  const loaded = {
    ...images,
    audio: music.audio,
    clips: footage.clips,
    diagnostics: [...images.diagnostics, ...music.diagnostics, ...footage.diagnostics],
  };
  // Speech is the slow part. A scenefile with other problems is reported before any is made;
  // only its length is left to judge afterwards, when the real lengths are known.
  const first = check(input, loaded);
  if (first.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.code !== "TOTAL_DURATION")) {
    return first;
  }
  if (sources.speak) {
    for (const [index, scene] of scenefile.scenes.entries()) {
      if (scene.say === undefined) continue;
      try {
        speech.set(index, await sources.speak(scene.say, scenefile.voice?.name ?? DEFAULT_VOICE));
      } catch (cause) {
        spoken.push(
          error(
            "VOICE_FAILED",
            `scenes[${index}].say`,
            cause instanceof Error ? cause.message : String(cause),
            "Fix what the message says and try again, or remove `say` to make the video without narration.",
          ),
        );
        // One failure is enough: the others would only repeat it.
        break;
      }
    }
  }
  return check(input, { ...loaded, speech, diagnostics: [...loaded.diagnostics, ...spoken] });
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
