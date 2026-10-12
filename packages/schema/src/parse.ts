import { type Diagnostic, error, warning } from "./diagnostics";

const JSON_FIX =
  "Output one JSON object only: double-quoted keys and strings, no comments, no trailing commas, no text around it.";

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * Turns file contents into a JSON value. Models often wrap JSON in a Markdown
 * code fence with prose around it; that is unwrapped and reported, not rejected.
 */
export function parseScenefileText(text: string): { value: unknown; diagnostics: Diagnostic[] } {
  const direct = tryParse(text);
  if (direct.ok) return { value: direct.value, diagnostics: [] };

  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/i.exec(text);
  if (fenced?.[1] !== undefined) {
    const inner = tryParse(fenced[1]);
    if (inner.ok) {
      return {
        value: inner.value,
        diagnostics: [
          warning("AUTOFIXED", "", "Removed a Markdown code fence and the text around the JSON.", JSON_FIX),
        ],
      };
    }
  }

  const message = text.trim() === "" ? "The scenefile is empty." : `The scenefile is not valid JSON: ${direct.reason}`;
  return { value: undefined, diagnostics: [error("SCHEMA_JSON", "", message, JSON_FIX)] };
}
