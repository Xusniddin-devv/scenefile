import { escapeHtml } from "../text";
import type { SceneDefinition } from "../types";
import { type TerminalProps, terminalSchema } from "./schema";
import { TAIL_SECONDS, terminalSchedule } from "./timing";

export const terminalDefinition: SceneDefinition<TerminalProps> = {
  type: "terminal",
  fields: Object.keys(terminalSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  holdSeconds(props) {
    const last = terminalSchedule(props.steps).at(-1);
    return (last ? last.end : 0) + TAIL_SECONDS;
  },
  summary(props) {
    const first = props.steps[0];
    const more = props.steps.length - 1;
    return `$ ${first ? first.run : ""}${more > 0 ? ` (+${more} more)` : ""}`;
  },
  compile(props) {
    const steps = props.steps
      .map((step) => {
        const output = step.output
          ? `<pre class="sf-terminal__out" data-sf-out>${escapeHtml(step.output)}</pre>`
          : "";
        return `<div class="sf-terminal__step"><div class="sf-terminal__cmd"><span class="sf-terminal__prompt">$</span><span data-sf-type="${escapeHtml(step.run)}"></span><span class="sf-terminal__caret"></span></div>${output}</div>`;
      })
      .join("");
    return `<div class="sf-terminal"><div class="sf-terminal__window" data-sf-enter="0"><div class="sf-terminal__bar"><i></i><i></i><i></i></div><div class="sf-terminal__body">${steps}</div></div></div>`;
  },
  css: `
.sf-terminal{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:calc(var(--sf-unit)*10)}
.sf-terminal__window{width:100%;max-width:calc(var(--sf-unit)*150);background:var(--sf-surface);border:1px solid var(--sf-line);border-radius:calc(var(--sf-unit)*1.2);overflow:hidden}
.sf-terminal__bar{display:flex;gap:calc(var(--sf-unit)*0.8);padding:calc(var(--sf-unit)*1.6) calc(var(--sf-unit)*2);border-bottom:1px solid var(--sf-line)}
.sf-terminal__bar i{width:calc(var(--sf-unit)*1.2);height:calc(var(--sf-unit)*1.2);border-radius:50%;background:var(--sf-line)}
.sf-terminal__body{display:flex;flex-direction:column;gap:calc(var(--sf-unit)*1.6);padding:calc(var(--sf-unit)*3.5);font:400 calc(var(--sf-unit)*4)/1.45 var(--sf-font-mono);color:var(--sf-text)}
.sf-terminal__cmd{white-space:pre-wrap;overflow-wrap:anywhere}
.sf-terminal__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-terminal__caret{display:inline-block;width:0.6em;height:1.1em;margin-left:2px;vertical-align:text-bottom;background:var(--sf-accent)}
.sf-terminal__out{font:inherit;color:var(--sf-muted);white-space:pre-wrap;overflow-wrap:anywhere}
`,
};
