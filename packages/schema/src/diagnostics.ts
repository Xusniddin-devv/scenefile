export type Severity = "error" | "warning";

/** One problem, written so a language model can act on it without seeing the video. */
export interface Diagnostic {
  code: string;
  severity: Severity;
  /** Location in the scenefile, e.g. `scenes[2].heading`. Empty for the document itself. */
  path: string;
  message: string;
  /** A concrete instruction that resolves the problem. */
  fix: string;
}

export function error(code: string, path: string, message: string, fix: string): Diagnostic {
  return { code, severity: "error", path, message, fix };
}

export function warning(code: string, path: string, message: string, fix: string): Diagnostic {
  return { code, severity: "warning", path, message, fix };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
