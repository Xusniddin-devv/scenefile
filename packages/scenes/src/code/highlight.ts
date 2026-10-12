import { type HighlighterCore, createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import csharp from "shiki/langs/csharp.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import dockerfile from "shiki/langs/dockerfile.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import kotlin from "shiki/langs/kotlin.mjs";
import markdown from "shiki/langs/markdown.mjs";
import php from "shiki/langs/php.mjs";
import python from "shiki/langs/python.mjs";
import ruby from "shiki/langs/ruby.mjs";
import rust from "shiki/langs/rust.mjs";
import sql from "shiki/langs/sql.mjs";
import swift from "shiki/langs/swift.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import type { CodeLang } from "./langs";

export type TokenKind = "plain" | "comment" | "string" | "keyword" | "number" | "function";

export interface CodeToken {
  text: string;
  kind: TokenKind;
}

/**
 * The highlighter is given a theme whose "colors" are markers, one per kind
 * of token. Scenes color code with theme variables, so all that is needed from
 * the highlighter is which kind each token is.
 */
const MARKERS: Readonly<Record<string, TokenKind>> = {
  "#000001": "comment",
  "#000002": "string",
  "#000003": "keyword",
  "#000004": "number",
  "#000005": "function",
};

const THEME_NAME = "scenefile-markers";

let highlighter: HighlighterCore | undefined;

function getHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    engine: createJavaScriptRegexEngine(),
    langs: [
      bash, c, cpp, csharp, css, diff, dockerfile, go, html, java, javascript, json, jsx, kotlin,
      markdown, php, python, ruby, rust, sql, swift, toml, tsx, typescript, yaml,
    ],
    themes: [
      {
        name: THEME_NAME,
        type: "dark",
        colors: { "editor.foreground": "#000000", "editor.background": "#ffffff" },
        tokenColors: [
          { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#000001" } },
          { scope: ["string", "punctuation.definition.string"], settings: { foreground: "#000002" } },
          // Object keys in JSON are strings to the grammar, but read as plain names.
          { scope: ["support.type.property-name"], settings: { foreground: "#000000" } },
          { scope: ["keyword", "storage", "storage.type", "storage.modifier"], settings: { foreground: "#000003" } },
          { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#000004" } },
          { scope: ["entity.name.function", "support.function"], settings: { foreground: "#000005" } },
        ],
      },
    ],
  });
  return highlighter;
}

/** Splits source into lines of tokens, each tagged with what kind of token it is. */
export function highlightLines(source: string, lang: CodeLang): CodeToken[][] {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (lang === "text") return normalized.split("\n").map((line) => [{ text: line, kind: "plain" }]);
  return getHighlighter()
    // The highlighter normally gives up on a line after half a second and
    // returns the rest uncolored. On a busy machine that changes the picture,
    // so the limit is off; the schema caps source length instead.
    .codeToTokensBase(normalized, { lang, theme: THEME_NAME, tokenizeTimeLimit: 0 })
    .map((line) =>
      line.map((token) => ({ text: token.content, kind: MARKERS[(token.color ?? "").toLowerCase()] ?? "plain" })),
    );
}
