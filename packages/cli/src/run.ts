import { readFile } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import {
  type CheckResult,
  type Composition,
  type InspectReport,
  applyLayout,
  checkWithAssets,
} from "@scenefile/engine";
import {
  EnvironmentError,
  inspectComposition,
  MAX_WORKERS,
  QUALITIES,
  type Quality,
  type RenderOptions,
  type RenderReport,
  renderVideo,
} from "@scenefile/render";
import { type Diagnostic, error, parseScenefileText } from "@scenefile/schema";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  /** Test seam. Defaults to the real renderer. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
  /** Test seam. Defaults to measuring the layout in Chromium. */
  inspect?: (composition: Composition) => Promise<InspectReport>;
}

type ExitCode = 0 | 1 | 2;

const USAGE = `Usage:
  scenefile check <file> [--json]
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--workers <n>] [--json]

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

  const checked = await checkWithAssets(parsed.value, { baseDir: dirname(resolvePath(path)) });
  const result = { ...checked, diagnostics: [...parsed.diagnostics, ...checked.diagnostics] };
  if (!result.ok || !result.composition) return result;
  return applyLayout(result, await (io.inspect ?? inspectComposition)(result.composition));
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const lines = diagnostics.flatMap((d) => [
    `${d.severity}  ${d.code}${d.path ? `  ${d.path}` : ""}`,
    `  ${d.message}`,
    `  fix: ${d.fix}`,
  ]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  lines.push(`${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return lines.join("\n");
}

function report(result: CheckResult, json: boolean, io: Io, extra: Record<string, unknown> = {}): void {
  if (json) {
    const { ok, diagnostics, scenefile, storyboard } = result;
    io.out(JSON.stringify({ ok, diagnostics, scenefile, storyboard, ...extra }, null, 2));
    return;
  }
  if (result.storyboard) io.out(result.storyboard);
  io.out(result.diagnostics.length > 0 ? formatDiagnostics(result.diagnostics) : "No problems found.");
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

    if (values.help) {
      io.out(USAGE);
      return 0;
    }

    const [command, file] = positionals;
    if (command !== "check" && command !== "render") throw new UsageError("Expected a command: check or render.");
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
      workers = Number(values.workers);
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
          `${rendered.durationSeconds.toFixed(2)}s${rendered.audio ? ", with music" : ""}, in ${(rendered.elapsedMs / 1000).toFixed(1)}s ` +
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
    },
  });
}
