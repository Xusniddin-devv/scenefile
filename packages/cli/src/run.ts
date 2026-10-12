import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import {
  type CheckResult,
  type Composition,
  type InspectReport,
  authoringGuide,
  exampleScenefile,
  formatDiagnostics,
  sceneGuide,
  type Speak,
} from "@scenefile/engine";
import {
  EnvironmentError,
  MAX_WORKERS,
  prepareScenefile,
  QUALITIES,
  type Quality,
  type RenderOptions,
  type RenderReport,
  renderVideo,
  VOICE_CATALOG,
  createSpeaker,
  installVoice,
  isVoice,
  voiceHome,
  voiceInstalled,
  type Finding,
  diagnose,
} from "@scenefile/render";
import { type Diagnostic, error, nearest, parseScenefileText, scenefileJsonSchema } from "@scenefile/schema";
import { SCENE_TYPES, getScene, isSceneType } from "@scenefile/scenes";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** Test seam. Defaults to the real renderer. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
  /** Test seam. Defaults to measuring the layout in Chromium. */
  inspect?: (composition: Composition) => Promise<InspectReport>;
  /** Test seam. Defaults to asking ffprobe whether a file has a sound track. */
  hasSound?: (file: string) => Promise<boolean>;
  /** Test seam. Defaults to the speech engine on this machine, downloading a voice the first time it is used. */
  speak?: Speak;
  /** Test seam. Defaults to looking at this machine. */
  diagnose?: () => Promise<Finding[]>;
}

type ExitCode = 0 | 1 | 2;

const USAGE = `Usage:
  scenefile check <file> [--json]
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--workers <n>] [--json]
  scenefile guide                  how to write a scenefile
  scenefile scenes [type]          the scene types, or one in full
  scenefile schema                 the scenefile as a JSON Schema
  scenefile init [folder]          write an example scenefile.json
  scenefile doctor                 check that this machine has what is needed
  scenefile voices                 the narrator voices
  scenefile voices install <name>  download a voice (about 67 MB, once)
  scenefile mcp [--root <folder>] [--allow-remote-images]
                                   serve these as tools to an MCP client

  scenefile --version

Exit codes: 0 success, 1 the scenefile has errors, 2 usage or environment problem.`;

class UsageError extends Error {}

function isQuality(value: string): value is Quality {
  return (QUALITIES as readonly string[]).includes(value);
}

function failed(diagnostics: Diagnostic[]): CheckResult {
  return { ok: false, diagnostics, scenefile: null, video: null, composition: null, storyboard: "" };
}

/** Reads, validates, and measures a scenefile: everything short of rendering it. */
async function load(path: string, io: Io): Promise<CheckResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return failed([error("SCHEMA_FILE", "", `Cannot read "${path}".`, "Check that the path exists and is a file.")]);
  }
  const parsed = parseScenefileText(text);
  if (parsed.value === undefined) return failed(parsed.diagnostics);

  const prepared = await prepareScenefile(parsed.value, {
    baseDir: dirname(resolvePath(path)),
    ...(io.inspect ? { inspect: io.inspect } : {}),
    ...(io.hasSound ? { hasSound: io.hasSound } : {}),
    speak:
      io.speak ??
      createSpeaker({
        download: true,
        onDownload: (name, info) =>
          io.err(`Downloading the voice "${name}" (${Math.round(info.bytes / 1e6)} MB). This happens once.`),
      }),
  });
  return { ...prepared, diagnostics: [...parsed.diagnostics, ...prepared.diagnostics] };
}

function report(result: CheckResult, json: boolean, io: Io, extra: Record<string, unknown> = {}): void {
  if (json) {
    const { ok, diagnostics, scenefile, storyboard } = result;
    io.out(JSON.stringify({ ok, diagnostics, scenefile, storyboard, ...extra }, null, 2));
    return;
  }
  if (result.storyboard) io.out(result.storyboard);
  io.out(formatDiagnostics(result.diagnostics));
}

export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  try {
    let parsed: ReturnType<typeof parse>;
    try {
      parsed = parse(argv);
    } catch (cause) {
      throw new UsageError(cause instanceof Error ? cause.message : String(cause));
    }
    const { values, positionals } = parsed;

    if (values.version) {
      io.out((createRequire(import.meta.url)("../package.json") as { version: string }).version);
      return 0;
    }
    if (values.help) {
      io.out(USAGE);
      return 0;
    }

    const [command, file] = positionals;
    if (command === "guide") {
      io.out(authoringGuide());
      return 0;
    }
    if (command === "schema") {
      io.out(JSON.stringify(scenefileJsonSchema(), null, 2));
      return 0;
    }
    if (command === "scenes") {
      if (!file) {
        const width = Math.max(...SCENE_TYPES.map((type) => type.length));
        io.out(SCENE_TYPES.map((type) => `${type.padEnd(width)}  ${getScene(type).doc.purpose}`).join("\n"));
        return 0;
      }
      const name = file.trim().toLowerCase();
      if (!isSceneType(name)) {
        const guess = nearest(name, SCENE_TYPES);
        throw new UsageError(
          `There is no scene type "${file}".${guess ? ` Did you mean "${guess}"?` : ""} The types are: ${SCENE_TYPES.join(", ")}.`,
        );
      }
      io.out(sceneGuide(name));
      return 0;
    }
    if (command === "init") {
      const folder = resolvePath(file ?? ".");
      const target = join(folder, "scenefile.json");
      try {
        await mkdir(folder, { recursive: true });
      } catch {
        io.err(`"${folder}" is a file, not a folder, or cannot be created. Give a folder to put scenefile.json in.`);
        return 1;
      }
      try {
        // "wx": fail rather than replace a file that is already there.
        await writeFile(target, `${JSON.stringify(exampleScenefile(), null, 2)}\n`, { flag: "wx" });
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        io.err(code === "EEXIST" ? `${target} already exists; it was left as it is.` : `Cannot write ${target}: ${code ?? "unknown error"}.`);
        return 1;
      }
      io.out(`Wrote ${target}\nNext: scenefile check ${target}\nThen: scenefile render ${target} -o video.mp4`);
      return 0;
    }
    if (command === "doctor") {
      const findings = await (io.diagnose ?? diagnose)();
      const width = Math.max(...findings.map((finding) => finding.name.length));
      for (const finding of findings) {
        const state = finding.ok ? "ok" : finding.required ? "missing" : "optional";
        io.out(`${state.padEnd(8)} ${finding.name.padEnd(width)}  ${finding.detail}`);
        if (!finding.ok && finding.fix) io.out(`${" ".repeat(9)}${finding.fix}`);
      }
      const ready = findings.every((finding) => finding.ok || !finding.required);
      if (ready) io.out("Ready to make videos.");
      return ready ? 0 : 2;
    }
    if (command === "voices") {
      const voicesDir = join(voiceHome(), "voices");
      if (!file) {
        io.out(
          Object.entries(VOICE_CATALOG)
            .map(([name, info]) => `${name.padEnd(11)} ${info.language}, ${info.describes}; ${info.basis}${isVoice(name) && voiceInstalled(voicesDir, name) ? "  (installed)" : ""}`)
            .join("\n"),
        );
        return 0;
      }
      const name = positionals[2] ?? "";
      if (file !== "install" || !isVoice(name)) {
        throw new UsageError(`Use "scenefile voices" or "scenefile voices install <name>". The voices are: ${Object.keys(VOICE_CATALOG).join(", ")}.`);
      }
      try {
        await installVoice(name, { voicesDir });
      } catch (cause) {
        io.err(cause instanceof Error ? cause.message : String(cause));
        return 2;
      }
      io.out(`The voice "${name}" is installed.`);
      return 0;
    }
    if (command !== "check" && command !== "render") {
      throw new UsageError("Expected a command: check, render, guide, scenes, schema, init, doctor, voices or mcp.");
    }
    if (!file) throw new UsageError(`"${command}" needs a scenefile path.`);

    if (command === "check") {
      const result = await load(file, io);
      report(result, values.json, io);
      return result.ok ? 0 : 1;
    }

    if (!values.output) throw new UsageError('"render" needs an output path: -o out.mp4');
    if (extname(values.output).toLowerCase() !== ".mp4") {
      throw new UsageError(`The output must be an .mp4 file; got "${values.output}".`);
    }
    if (resolvePath(values.output) === resolvePath(file)) {
      throw new UsageError("The output path is the same file as the scenefile. Choose a different output.");
    }
    if (!isQuality(values.quality)) {
      throw new UsageError(`Unknown quality "${values.quality}". Use one of: ${QUALITIES.join(", ")}.`);
    }

    let workers: number | undefined;
    if (values.workers !== undefined) {
      workers = /^\d+$/.test(values.workers) ? Number(values.workers) : Number.NaN;
      if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) {
        throw new UsageError(`--workers must be a whole number from 1 to ${MAX_WORKERS}; got "${values.workers}".`);
      }
    }

    const result = await load(file, io);
    if (!result.ok || !result.composition) {
      report(result, values.json, io);
      return 1;
    }
    const rendered = await (io.render ?? renderVideo)(result.composition, {
      output: values.output,
      quality: values.quality,
      ...(workers === undefined ? {} : { workers }),
    });
    report(result, values.json, io, { render: rendered });
    if (!values.json) {
      io.out(
        `Rendered ${rendered.output}: ${rendered.width}x${rendered.height}, ${rendered.fps} fps, ` +
          `${rendered.durationSeconds.toFixed(2)}s${rendered.audio ? ", with sound" : ""}, in ${(rendered.elapsedMs / 1000).toFixed(1)}s ` +
          `with ${rendered.workers} ${rendered.workers === 1 ? "worker" : "workers"}.`,
      );
    }
    return 0;
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.err(`${cause.message}\n\n${USAGE}`);
      return 2;
    }
    if (cause instanceof EnvironmentError) {
      io.err(`${cause.message}\n${cause.remedy}`);
      return 2;
    }
    throw cause;
  }
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      quality: { type: "string", default: "standard" },
      workers: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
}
