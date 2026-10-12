import { access, readFile } from "node:fs/promises";
import { dirname, extname, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type AssetSources,
  type CheckResult,
  type Composition,
  type InspectReport,
  authoringGuide,
  formatDiagnostics,
  sceneGuide,
} from "@scenefile/engine";
import {
  EnvironmentError,
  MAX_WORKERS,
  QUALITIES,
  type RenderOptions,
  type RenderReport,
  prepareScenefile,
  renderVideo,
} from "@scenefile/render";
import { type Diagnostic, nearest, parseScenefileText } from "@scenefile/schema";
import { SCENE_TYPES, isSceneType } from "@scenefile/scenes";
import { z } from "zod";
import { existingInside, resolveRoot, sameFile, writableInside } from "./paths";

export interface ServerOptions {
  /** The folder the server works in. Nothing outside it is read or written. */
  root: string;
  /** Whether scenefiles may name images by https address. Off unless asked for. */
  allowRemoteImages?: boolean;
  /** Replaces the renderer. For tests. */
  render?: (composition: Composition, options: RenderOptions) => Promise<RenderReport>;
  /** Replaces measuring the layout in Chromium. For tests. */
  inspect?: (composition: Composition) => Promise<InspectReport>;
  /** Replaces asking ffprobe whether music has a sound track. For tests. */
  hasSound?: (file: string) => Promise<boolean>;
  /** Replaces name lookup and https requests for image downloads. For tests. */
  network?: Pick<AssetSources, "lookup" | "request">;
}

type Reply = { content: { type: "text"; text: string }[]; isError: boolean };

const say = (text: string): Reply => ({ content: [{ type: "text", text }], isError: false });
const refuse = (text: string): Reply => ({ content: [{ type: "text", text }], isError: true });

interface Job {
  id: string;
  /** Where the video goes, relative to the root. */
  output: string;
  state: "waiting" | "rendering" | "finished" | "failed" | "cancelled";
  /** Stops the render when aborted. */
  stop: AbortController;
  done: number;
  total: number;
  report?: RenderReport;
  failure?: string;
}

/** How many finished jobs are remembered. */
const MAX_JOBS = 50;
/** How many renders may wait behind the one that is running. Each holds a whole video's images in memory. */
const MAX_WAITING = 5;
/** A render that runs longer than this is stopped: something has hung. */
const MAX_RENDER_MS = 30 * 60 * 1000;

const TOOLS_NOTE = [
  "## Tools",
  "- `check`: checks a scenefile and returns its problems, each with a fix, and a text storyboard of the video.",
  "- `render`: starts rendering a scenefile to an .mp4 and returns a job id at once.",
  "- `job`: reports a render's progress, and the finished file.",
  "- `scene_docs`: one scene type in full.",
].join("\n");

const SOURCE = {
  scenefile: z
    .unknown()
    .optional()
    .describe("The scenefile itself: a JSON object, or JSON text. Give this or `path`, not both."),
  path: z
    .string()
    .optional()
    .describe("Path of a scenefile, relative to the folder the server works in. Give this or `scenefile`, not both."),
};

/**
 * A Model Context Protocol server for scenefile. Five tools: read the guide,
 * read one scene's documentation, check a scenefile, start a render, and
 * follow a render. Every path it is given is confined to `root`.
 */
export function createServer(options: ServerOptions): McpServer {
  const root = resolveRoot(options.root);
  const server = new McpServer({ name: "scenefile", version: "0.0.0" });
  const jobs = new Map<string, Job>();
  let nextJob = 1;
  /** Renders run one after another; each waits on this. */
  let line: Promise<void> = Promise.resolve();
  /** Checks run one after another too: each one starts a browser. */
  let checks: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
    const turn = checks.then(work, work);
    checks = turn.catch(() => undefined);
    return turn;
  }
  /** Absolute paths mean nothing to the caller and say more about the machine than it needs to know. */
  const withoutRoot = (text: string): string => text.split(root).join(".");

  /** Turns a tool's `scenefile` or `path` argument into a checked scenefile, or a refusal. */
  async function prepare(args: { scenefile?: unknown; path?: string | undefined }): Promise<
    { result: CheckResult; source: string | null; notes: Diagnostic[] } | Reply
  > {
    const inline = args.scenefile !== undefined && args.scenefile !== null;
    const byPath = args.path !== undefined && args.path !== "";
    if (inline === byPath) {
      return refuse("Give exactly one of `scenefile` (the scenefile itself) and `path` (a file holding it).");
    }

    let value: unknown = args.scenefile;
    let baseDir = root;
    let source: string | null = null;
    let notes: Diagnostic[] = [];
    if (byPath) {
      const located = await existingInside(root, args.path ?? "");
      if (!located.ok) return refuse(located.message);
      source = located.path;
      baseDir = dirname(located.path);
      try {
        value = await readFile(located.path, "utf8");
      } catch {
        return refuse(`"${args.path}" could not be read.`);
      }
    }
    if (typeof value === "string") {
      const parsed = parseScenefileText(value);
      if (parsed.value === undefined) return say(formatDiagnostics(parsed.diagnostics));
      value = parsed.value;
      notes = parsed.diagnostics;
    }

    const result = await oneAtATime(() =>
      prepareScenefile(value, {
        baseDir,
        allowRemote: options.allowRemoteImages === true,
        ...options.network,
        ...(options.inspect ? { inspect: options.inspect } : {}),
        ...(options.hasSound ? { hasSound: options.hasSound } : {}),
      }),
    );
    return { result: { ...result, diagnostics: [...notes, ...result.diagnostics] }, source, notes };
  }

  /** What `check` says: the storyboard, the problems, and the corrected scenefile if anything was repaired. */
  function describe(result: CheckResult): string {
    const parts = [];
    if (result.storyboard) parts.push(result.storyboard);
    parts.push(formatDiagnostics(result.diagnostics));
    // Only when a field was repaired; unwrapping a code fence changes nothing the caller should copy.
    const repaired = result.diagnostics.some((diagnostic) => diagnostic.code === "AUTOFIXED" && diagnostic.path !== "");
    if (repaired && result.scenefile) {
      parts.push(`Corrected scenefile (use this from now on):\n${JSON.stringify(result.scenefile, null, 2)}`);
    }
    return parts.join("\n\n");
  }

  server.registerTool(
    "guide",
    {
      description:
        "How to write a scenefile: the JSON format that describes a video, every scene type with an example, and how to check and render it. Read this first.",
      inputSchema: {},
    },
    async () => say(`${authoringGuide()}\n\n${TOOLS_NOTE}`),
  );

  server.registerTool(
    "scene_docs",
    {
      description: `Everything about one scene type: what it is for, each field with its limits, and an example. Types: ${SCENE_TYPES.join(", ")}.`,
      inputSchema: { type: z.string().describe("The scene type.") },
    },
    async ({ type }) => {
      const name = type.trim().toLowerCase();
      if (isSceneType(name)) return say(sceneGuide(name));
      const guess = nearest(name, SCENE_TYPES);
      return refuse(
        `There is no scene type "${type}".${guess ? ` Did you mean "${guess}"?` : ""} The types are: ${SCENE_TYPES.join(", ")}.`,
      );
    },
  );

  server.registerTool(
    "check",
    {
      description:
        "Checks a scenefile without rendering it. Returns a text storyboard (each scene, when it is on screen, how large its text came out) and every problem with the field it is in and how to fix it. Run this, fix what it reports, and run it again until there are no errors.",
      inputSchema: SOURCE,
    },
    async (args) => {
      const prepared = await prepare(args);
      return "content" in prepared ? prepared : say(describe(prepared.result));
    },
  );

  server.registerTool(
    "render",
    {
      description:
        "Renders a scenefile to an .mp4 file. Checks it first and refuses if it has errors. Returns a job id immediately; rendering takes about as long as the video lasts. Follow it with the `job` tool.",
      inputSchema: {
        ...SOURCE,
        output: z.string().describe('Where to write the video, relative to the folder the server works in. Must end in ".mp4".'),
        quality: z.enum(QUALITIES).optional().describe('"draft" (fast, smaller), "standard" (default) or "high".'),
        workers: z.number().int().min(1).max(MAX_WORKERS).optional().describe("Browsers to render with at once. Leave out for a sensible default."),
        overwrite: z.boolean().optional().describe("Set true to replace a file that already exists at `output`. Without it, an existing file is left alone."),
      },
    },
    async (args) => {
      if (args.output.trim() === "") return refuse('Give an `output` path for the video, ending in ".mp4".');
      if (extname(args.output).toLowerCase() !== ".mp4") {
        return refuse(`The output must be an .mp4 file; got "${args.output}".`);
      }
      const target = await writableInside(root, args.output);
      if (!target.ok) return refuse(target.message);

      const prepared = await prepare(args);
      if ("content" in prepared) return { ...prepared, isError: true };
      const { result, source } = prepared;
      if (!result.ok || !result.composition) return refuse(describe(result));
      if (source !== null && (await sameFile(source, target.path))) {
        return refuse("The output path is the scenefile itself. Choose a different output.");
      }
      const exists = await access(target.path).then(
        () => true,
        () => false,
      );
      if (exists && args.overwrite !== true) {
        return refuse(
          `"${args.output}" already exists and was left alone. Choose another name, or pass \`overwrite: true\` to replace it.`,
        );
      }
      const waiting = [...jobs.values()].filter((job) => job.state === "waiting").length;
      if (waiting >= MAX_WAITING) {
        return refuse(`${waiting} renders are already waiting. Wait for one to finish (see the \`job\` tool), or cancel one.`);
      }

      const composition = result.composition;
      const job: Job = {
        id: `job-${nextJob++}`,
        output: relative(root, target.path),
        state: "waiting",
        stop: new AbortController(),
        done: 0,
        total: composition.manifest.totalFrames,
      };
      jobs.set(job.id, job);
      for (const id of jobs.keys()) {
        if (jobs.size <= MAX_JOBS) break;
        const old = jobs.get(id);
        if (old && (old.state === "finished" || old.state === "failed")) jobs.delete(id);
      }

      line = line.then(async () => {
        // Cancelled while it waited: it never starts.
        if (job.state !== "waiting") return;
        job.state = "rendering";
        let tookTooLong = false;
        const limit = setTimeout(() => {
          tookTooLong = true;
          job.stop.abort();
        }, MAX_RENDER_MS);
        limit.unref();
        try {
          job.report = await (options.render ?? renderVideo)(composition, {
            output: target.path,
            signal: job.stop.signal,
            ...(args.quality ? { quality: args.quality } : {}),
            ...(args.workers ? { workers: args.workers } : {}),
            onProgress: (done) => {
              job.done = done;
            },
          });
          job.state = "finished";
        } catch (cause) {
          if (job.stop.signal.aborted && !tookTooLong) {
            job.state = "cancelled";
            return;
          }
          job.state = "failed";
          job.failure = tookTooLong
            ? "The render ran for half an hour without finishing and was stopped."
            : withoutRoot(
                cause instanceof EnvironmentError
                  ? `${cause.message}\n${cause.remedy}`
                  : `The renderer failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              );
        } finally {
          clearTimeout(limit);
        }
      });

      const seconds = (job.total / composition.manifest.fps).toFixed(1);
      const warnings = result.diagnostics.length > 0 ? `\n\n${formatDiagnostics(result.diagnostics)}` : "";
      return say(
        `Rendering started as ${job.id}: ${job.total} frames, ${seconds}s of video, to ${job.output}${exists ? " (replacing the file that was there)" : ""}. ` +
          `Call the \`job\` tool with id "${job.id}" to see progress and the result.${warnings}`,
      );
    },
  );

  server.registerTool(
    "job",
    {
      description:
        "Reports on a render started with `render`: waiting, how far it has got, finished (with the file), or failed (with why). Can also cancel it.",
      inputSchema: {
        id: z.string().describe('The job id that `render` returned, such as "job-1".'),
        cancel: z.boolean().optional().describe("Set true to stop this render."),
      },
    },
    async ({ id, cancel }) => {
      const job = jobs.get(id.trim());
      if (!job) {
        const known = [...jobs.keys()];
        return refuse(
          `There is no job "${id.slice(0, 40)}".${known.length > 0 ? ` Jobs: ${known.join(", ")}.` : " No render has been started."}`,
        );
      }
      if (cancel === true && job.state === "waiting") {
        job.state = "cancelled";
        return say(`${job.id}: cancelled before it started.`);
      }
      if (cancel === true && job.state === "rendering") {
        job.stop.abort();
        return say(`${job.id}: cancelling. Nothing will be written to ${job.output}.`);
      }
      if (job.state === "cancelled") return say(`${job.id}: cancelled. Nothing was written to ${job.output}.`);
      if (job.state === "waiting") return say(`${job.id}: waiting for an earlier render to finish.`);
      if (job.state === "rendering") {
        const percent = Math.floor((job.done / Math.max(1, job.total)) * 100);
        return say(`${job.id}: rendering, ${job.done} of ${job.total} frames (${percent}%). Ask again shortly.`);
      }
      if (job.state === "failed") return refuse(`${job.id}: failed.\n${job.failure ?? ""}`);
      const made = job.report;
      return say(
        `${job.id}: finished. ${job.output}` +
          (made
            ? `: ${made.width}x${made.height}, ${made.fps} fps, ${made.durationSeconds.toFixed(2)}s${made.audio ? ", with music" : ""}, rendered in ${(made.elapsedMs / 1000).toFixed(1)}s.`
            : "."),
      );
    },
  );

  return server;
}
