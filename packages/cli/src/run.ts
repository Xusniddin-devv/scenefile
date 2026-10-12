import { readFile } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import { type CheckResult, type Composition, check } from "@scenefile/engine";
import {
  EnvironmentError,
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
}

type ExitCode = 0 | 1 | 2;

const USAGE = `Usage:
  scenefile check <file> [--json]
  scenefile render <file> -o <out.mp4> [--quality draft|standard|high] [--json]

Exit codes: 0 success, 1 the scenefile has errors, 2 usage or environment problem.`;

class UsageError extends Error {}

function isQuality(value: string): value is Quality {
  return (QUALITIES as readonly string[]).includes(value);
}

async function load(path: string): Promise<CheckResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    const diagnostic = error("SCHEMA_FILE", "", `Cannot read "${path}".`, "Check that the path exists and is a file.");
    return { ok: false, diagnostics: [diagnostic], scenefile: null, composition: null, storyboard: "" };
  }
  const parsed = parseScenefileText(text);
  if (parsed.value === undefined) {
    return { ok: false, diagnostics: parsed.diagnostics, scenefile: null, composition: null, storyboard: "" };
  }
  const result = check(parsed.value);
  return { ...result, diagnostics: [...parsed.diagnostics, ...result.diagnostics] };
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
      const result = await load(file);
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

    const result = await load(file);
    if (!result.ok || !result.composition) {
      report(result, values.json, io);
      return 1;
    }
    const rendered = await (io.render ?? renderVideo)(result.composition, {
      output: values.output,
      quality: values.quality,
    });
    report(result, values.json, io, { render: rendered });
    if (!values.json) {
      io.out(
        `Rendered ${rendered.output}: ${rendered.width}x${rendered.height}, ${rendered.fps} fps, ` +
          `${rendered.durationSeconds.toFixed(2)}s, in ${(rendered.elapsedMs / 1000).toFixed(1)}s.`,
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
      help: { type: "boolean", short: "h", default: false },
    },
  });
}
