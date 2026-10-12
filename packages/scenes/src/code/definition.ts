import { escapeHtml } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { highlightLines } from "./highlight";
import { type CodeProps, codeSchema } from "./schema";
import { codeHoldSeconds, codeSettledSeconds } from "./timing";

function sourceLines(source: string): string[] {
  return source.split(/\r\n?|\n/);
}

export const codeDefinition: SceneDefinition<CodeProps> = {
  type: "code",
  fields: Object.keys(codeSchema.shape),
  enterSeconds: 0.3,
  exitSeconds: 0.4,
  minHoldSeconds: 2,
  revealSeconds: (props) => codeSettledSeconds(sourceLines(props.source).length, new Set(props.highlight ?? []).size),
  holdSeconds: (props) =>
    codeHoldSeconds(sourceLines(props.source).length, new Set(props.highlight ?? []).size, props.caption),
  summary(props) {
    const lines = sourceLines(props.source);
    const first = lines.find((line) => line.trim() !== "")?.trim() ?? "";
    return `${props.lang}, ${lines.length} ${lines.length === 1 ? "line" : "lines"}: ${first.slice(0, 48)}`;
  },
  texts(props) {
    const texts: SceneText[] = [{ path: "source", text: props.source, font: "mono" }];
    if (props.caption) texts.push({ path: "caption", text: props.caption, font: "sans" });
    return texts;
  },
  compile(props, ctx) {
    const marked = new Set(props.highlight ?? []);
    const rows = highlightLines(props.source, props.lang)
      .map((tokens, i) => {
        const code = tokens
          .map((token) =>
            token.kind === "plain"
              ? escapeHtml(token.text)
              : `<span class="sf-t-${token.kind}">${escapeHtml(token.text)}</span>`,
          )
          .join("");
        // A blank line still needs content, or it would have no height.
        return `<div class="sf-code__line${marked.has(i + 1) ? " is-marked" : ""}" data-sf-line="${i}"><span class="sf-code__n">${i + 1}</span><span class="sf-code__src">${code || " "}</span></div>`;
      })
      .join("");
    const caption = props.caption
      ? `<p class="sf-code__caption" data-sf-enter="0" data-sf-fit="3.4,4.6,0.2" data-sf-lines="2" data-sf-path="${ctx.path}.caption">${escapeHtml(props.caption)}</p>`
      : "";
    return `<div class="sf-code"><div class="sf-code__block" data-sf-fit="3.4,5,0.2" data-sf-box data-sf-path="${ctx.path}.source">${rows}</div>${caption}</div>`;
  },
  doc: {
    purpose: "Source code with line numbers; chosen lines can be marked so they stand out.",
    fields: {
      "lang": "The language: \"typescript\", \"python\", \"bash\", \"json\", \"go\", \"rust\" and others, or \"text\".",
      "source": "The code. Required, at most 12 lines; keep each line under 60 characters. Use \\n between lines.",
      "highlight": "Line numbers, counted from 1, to mark: [2, 3].",
      "caption": "A line under the code, up to 80 characters."
    },
    example: {
      "type": "code",
      "lang": "bash",
      "source": "npm install -g shipit\nshipit deploy",
      "highlight": [
        2
      ],
      "caption": "Two lines from install to live."
    },
  },
  css: `
.sf-code{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*19);bottom:calc(var(--sf-unit)*8);display:flex;flex-direction:column;gap:calc(var(--sf-unit)*3)}
.sf-code__block{flex:1;min-height:0;overflow:hidden;font:400 calc(var(--sf-unit)*5)/1.7 var(--sf-font-mono);font-variant-ligatures:none;tab-size:2;color:var(--sf-text)}
.sf-code__line{display:flex;white-space:pre-wrap;overflow-wrap:anywhere;border-left:calc(var(--sf-unit)*0.4) solid transparent;padding-left:calc(var(--sf-unit)*1.6)}
.sf-fitting .sf-code__line{white-space:pre}
.sf-code__line.is-marked{border-left-color:var(--sf-accent)}
.sf-code__n{flex:none;width:2ch;margin-right:3ch;text-align:right;color:var(--sf-muted);opacity:.5}
.sf-code__line.is-marked .sf-code__n{color:var(--sf-accent);opacity:1}
.sf-code__src{min-width:0}
.sf-t-comment{color:var(--sf-muted);opacity:.7}
.sf-t-keyword{color:var(--sf-muted)}
.sf-t-string,.sf-t-number{color:var(--sf-accent)}
.sf-code__caption{font:500 calc(var(--sf-unit)*4.6)/1.25 var(--sf-font-sans);color:var(--sf-muted)}
`,
};
