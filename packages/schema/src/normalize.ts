import { SCENE_TYPES, getScene, isSceneType } from "@scenefile/scenes";
import { type Diagnostic, error, hasErrors, warning } from "./diagnostics";
import { nearest } from "./distance";
import { type Scenefile, TOP_LEVEL_FIELDS, scenefileSchema } from "./scenefile";

type Json = Record<string, unknown>;

/** Names models commonly use for a field, mapped to the real one. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  subtitle: "sub",
  subheading: "sub",
  title: "heading",
  headline: "heading",
  commands: "steps",
  points: "items",
  bullets: "items",
  list: "items",
  code: "source",
  snippet: "source",
  language: "lang",
  number: "value",
  figure: "value",
  description: "note",
  quote: "text",
  name: "author",
  cmd: "command",
  install: "command",
  link: "url",
  website: "url",
  time: "duration",
  length: "duration",
  seconds: "duration",
};

const DURATION_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?\s*$/i;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}

/** Escape sequences terminals use for color and cursor movement. */
const ANSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
/** Characters with no visible form. Tab, newline and carriage return are kept. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Removes color codes and control characters from every string, in place.
 * Models paste colored command output as it came; drawn literally it shows as
 * stray brackets and digits.
 */
function cleanStrings(holder: Record<string, unknown> | unknown[], path: string, diagnostics: Diagnostic[]): void {
  const entries: [string | number, unknown][] = Array.isArray(holder)
    ? holder.map((value, index): [number, unknown] => [index, value])
    : Object.entries(holder);
  for (const [key, value] of entries) {
    const at = typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    if (typeof value === "string") {
      const withoutColor = value.replace(ANSI_SEQUENCE, "");
      const cleaned = withoutColor.replace(CONTROL_CHARACTER, "");
      if (cleaned === value) continue;
      (holder as Record<string | number, unknown>)[key] = cleaned;
      diagnostics.push(
        withoutColor !== value
          ? warning("AUTOFIXED", at, "Removed terminal color codes from this text.", "Paste plain text, without color codes.")
          : warning("AUTOFIXED", at, "Removed control characters that cannot be shown.", "Remove them from the text."),
      );
    } else if (Array.isArray(value) || isObject(value)) {
      cleanStrings(value, at, diagnostics);
    }
  }
}

function quoteList(values: unknown): string {
  return Array.isArray(values) ? values.map((value) => JSON.stringify(value)).join(", ") : "";
}

/**
 * An instruction built from the schema violation itself. The reader may be a
 * model with nothing else to go on, so it must say what to write, not where
 * to look.
 */
function fixForIssue(issue: Readonly<Record<string, unknown>>): string {
  const { code, origin, minimum, maximum } = issue;
  const message = typeof issue.message === "string" ? issue.message : "";
  const unit = origin === "string" ? "characters" : origin === "array" ? "items" : "";
  switch (code) {
    case "unrecognized_keys":
      return `Remove the unsupported field(s): ${quoteList(issue.keys)}.`;
    case "invalid_value":
      return `Use one of: ${quoteList(issue.values)}.`;
    case "invalid_type":
      return message.includes("received undefined")
        ? `This field is required. Add it with a ${String(issue.expected)} value.`
        : `Replace the value with a ${String(issue.expected)}.`;
    case "too_small":
      return unit ? `Use at least ${String(minimum)} ${unit}.` : `Use a value of at least ${String(minimum)}.`;
    case "too_big":
      return unit ? `Use at most ${String(maximum)} ${unit}.` : `Use a value of at most ${String(maximum)}.`;
    default:
      return "Change the value so it meets the requirement stated in the message.";
  }
}

/** Renames aliases and case variants; reports and removes fields that match nothing. */
function fixKeys(obj: Json, known: readonly string[], path: string, diagnostics: Diagnostic[]): void {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue;
    const at = path ? `${path}.${key}` : key;
    const alias = FIELD_ALIASES[key.toLowerCase()];
    const target =
      alias !== undefined && known.includes(alias)
        ? alias
        : known.find((name) => name.toLowerCase() === key.toLowerCase());

    if (target !== undefined && !(target in obj)) {
      obj[target] = obj[key];
      delete obj[key];
      diagnostics.push(warning("AUTOFIXED", at, `Renamed "${key}" to "${target}".`, `Use "${target}".`));
      continue;
    }

    const guess = nearest(key, known);
    delete obj[key];
    diagnostics.push(
      error(
        "SCHEMA_UNKNOWN_FIELD",
        at,
        guess ? `Unknown field "${key}". Did you mean "${guess}"?` : `Unknown field "${key}".`,
        `Allowed fields here: ${known.join(", ")}.`,
      ),
    );
  }
}

function coerceDuration(scene: Json, path: string, diagnostics: Diagnostic[]): void {
  const raw = scene.duration;
  if (typeof raw !== "string" || raw === "auto") return;
  const at = `${path}.duration`;
  if (raw.trim().toLowerCase() === "auto") {
    scene.duration = "auto";
    diagnostics.push(warning("AUTOFIXED", at, `Read "${raw}" as "auto".`, 'Write "auto" in lower case.'));
    return;
  }
  const match = DURATION_PATTERN.exec(raw);
  if (match?.[1] === undefined) return;
  const seconds = Number(match[1]);
  scene.duration = seconds;
  diagnostics.push(
    warning("AUTOFIXED", at, `Read "${raw}" as ${seconds} seconds.`, `Write a number: "duration": ${seconds}.`),
  );
}

/** Returns true when the scene cannot be validated further (its type is unusable). */
function normalizeScene(scene: unknown, path: string, diagnostics: Diagnostic[]): boolean {
  if (!isObject(scene)) return false;
  const allowed = `"type" must be one of: ${SCENE_TYPES.join(", ")}.`;
  const rawType = scene.type;

  if (typeof rawType !== "string") {
    diagnostics.push(error("SCHEMA_UNKNOWN_SCENE", `${path}.type`, 'This scene has no "type".', allowed));
    return true;
  }

  const type = rawType.trim().toLowerCase();
  if (!isSceneType(type)) {
    const guess = nearest(type, SCENE_TYPES);
    diagnostics.push(
      error(
        "SCHEMA_UNKNOWN_SCENE",
        `${path}.type`,
        guess ? `Unknown scene type "${rawType}". Did you mean "${guess}"?` : `Unknown scene type "${rawType}".`,
        allowed,
      ),
    );
    return true;
  }

  if (type !== rawType) {
    scene.type = type;
    diagnostics.push(warning("AUTOFIXED", `${path}.type`, `Read "${rawType}" as "${type}".`, `Write "${type}".`));
  }
  fixKeys(scene, getScene(type).fields, path, diagnostics);
  coerceDuration(scene, path, diagnostics);
  return false;
}

/**
 * Validates a parsed scenefile, repairing the small mistakes models make and
 * reporting each repair. Returns the normalized scenefile only when no errors
 * remain.
 */
export function normalize(input: unknown): { scenefile: Scenefile | null; diagnostics: Diagnostic[] } {
  if (!isObject(input)) {
    return {
      scenefile: null,
      diagnostics: [
        error(
          "SCHEMA_ROOT",
          "",
          "A scenefile must be a JSON object.",
          'Start with {"version": 1, "scenes": [ ... ]}.',
        ),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const draft = structuredClone(input);
  cleanStrings(draft, "", diagnostics);
  fixKeys(draft, TOP_LEVEL_FIELDS, "", diagnostics);

  // Scenes whose type is unusable are already reported; hide the schema's echo of them.
  const blocked: string[] = [];
  if (Array.isArray(draft.scenes)) {
    draft.scenes.forEach((scene: unknown, index: number) => {
      const path = `scenes[${index}]`;
      if (normalizeScene(scene, path, diagnostics)) blocked.push(path);
    });
  }

  const parsed = scenefileSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = formatPath(issue.path);
      if (blocked.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))) continue;
      diagnostics.push(
        error("SCHEMA_INVALID", path, issue.message, fixForIssue(issue as unknown as Record<string, unknown>)),
      );
    }
  }

  return {
    scenefile: parsed.success && !hasErrors(diagnostics) ? parsed.data : null,
    diagnostics,
  };
}
