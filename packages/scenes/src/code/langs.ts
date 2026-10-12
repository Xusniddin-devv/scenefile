/** Languages the code scene can color. "text" means no coloring. */
export const CODE_LANGS = [
  "text", "typescript", "tsx", "javascript", "jsx", "json", "bash", "python", "go", "rust",
  "html", "css", "sql", "yaml", "toml", "diff", "dockerfile", "markdown",
  "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "ruby",
] as const;

export type CodeLang = (typeof CODE_LANGS)[number];

/** A scene shows at most this many lines; more cannot be read at the smallest size. */
export const MAX_CODE_LINES = 16;

/** Names people and models use for the languages above. */
export const LANG_ALIASES: Readonly<Record<string, CodeLang>> = {
  ts: "typescript", js: "javascript", node: "javascript", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  py: "python", golang: "go", rs: "rust", yml: "yaml", docker: "dockerfile", md: "markdown",
  kt: "kotlin", "c++": "cpp", "c#": "csharp", cs: "csharp", rb: "ruby", plaintext: "text", txt: "text", plain: "text",
};
