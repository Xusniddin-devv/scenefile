import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { CHROMIUM_REMEDY, FFMPEG_REMEDY } from "./errors";
import { VOICE_CATALOG, isVoice, voiceHome, voiceInstalled } from "./voice";

const run = promisify(execFile);

/** One thing scenefile needs, and whether this machine has it. */
export interface Finding {
  name: string;
  ok: boolean;
  /** False for things only some videos need, such as a narrator's voice. */
  required: boolean;
  detail: string;
  fix?: string;
}

async function tool(name: string): Promise<Finding> {
  try {
    const { stdout } = await run(name, ["-version"]);
    return { name, ok: true, required: true, detail: /version (\S+)/.exec(stdout)?.[1] ?? "found" };
  } catch {
    return { name, ok: false, required: true, detail: "not found", fix: FFMPEG_REMEDY };
  }
}

async function browser(): Promise<Finding> {
  try {
    const launched = await chromium.launch({ headless: true });
    const version = launched.version();
    await launched.close();
    return { name: "Chromium", ok: true, required: true, detail: version };
  } catch {
    return { name: "Chromium", ok: false, required: true, detail: "not installed", fix: CHROMIUM_REMEDY };
  }
}

/** Looks for everything scenefile uses outside its own code. Changes nothing. */
export async function diagnose(): Promise<Finding[]> {
  const major = Number(process.versions.node.split(".")[0]);
  const voicesDir = join(voiceHome(), "voices");
  const voices = Object.keys(VOICE_CATALOG).filter((name) => isVoice(name) && voiceInstalled(voicesDir, name));
  return [
    {
      name: "Node",
      ok: major >= 20,
      required: true,
      detail: process.versions.node,
      ...(major >= 20 ? {} : { fix: "Install Node 20 or newer." }),
    },
    await tool("ffmpeg"),
    await tool("ffprobe"),
    await browser(),
    voices.length > 0
      ? { name: "Voices", ok: true, required: false, detail: voices.join(", ") }
      : {
          name: "Voices",
          ok: false,
          required: false,
          detail: "none installed; needed only for narration",
          fix: "They download on first use, or ahead of time: scenefile voices install en-kristin",
        },
  ];
}
