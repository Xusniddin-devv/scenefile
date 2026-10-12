import { sceneChrome } from "../chrome";
import { escapeHtml } from "../text";
import type { SceneDefinition, SceneText } from "../types";
import { type TerminalProps, terminalSchema } from "./schema";
import { TAIL_SECONDS, terminalSchedule } from "./timing";

export const terminalDefinition: SceneDefinition<TerminalProps> = {
  type: "terminal",
  fields: Object.keys(terminalSchema.shape),
  enterSeconds: 0.5,
  exitSeconds: 0.4,
  minHoldSeconds: 1.5,
  revealSeconds: (props) => terminalSchedule(props.steps).at(-1)?.outputAt ?? 0,
  holdSeconds(props) {
    const last = terminalSchedule(props.steps).at(-1);
    return (last ? last.end : 0) + TAIL_SECONDS;
  },
  summary(props) {
    const first = props.steps[0];
    const more = props.steps.length - 1;
    return `$ ${first ? first.run : ""}${more > 0 ? ` (+${more} more)` : ""}`;
  },
  texts(props) {
    return props.steps.flatMap((step, i): SceneText[] => {
      const texts: SceneText[] = [{ path: `steps[${i}].run`, text: step.run, font: "mono" }];
      if (step.output) texts.push({ path: `steps[${i}].output`, text: step.output, font: "mono" });
      return texts;
    });
  },
  compile(props, ctx) {
    const steps = props.steps
      .map((step) => {
        const output = step.output
          ? `<pre class="sf-terminal__out" data-sf-out>${escapeHtml(step.output)}</pre>`
          : "";
        return `<div class="sf-terminal__step"><div class="sf-terminal__cmd"><span class="sf-terminal__prompt">$</span><span data-sf-type="${escapeHtml(step.run)}"></span><span class="sf-terminal__caret"></span></div>${output}</div>`;
      })
      .join("");
    return `${sceneChrome(ctx)}<div class="sf-terminal"><div class="sf-terminal__body" data-sf-enter="0" data-sf-fit="3.4,6,0.2" data-sf-box data-sf-path="${ctx.path}.steps">${steps}</div></div>`;
  },
  css: `
.sf-terminal{position:absolute;left:calc(var(--sf-unit)*9);right:calc(var(--sf-unit)*9);top:calc(var(--sf-unit)*21);bottom:calc(var(--sf-unit)*9)}
.sf-terminal__body{display:flex;flex-direction:column;gap:0.7em;height:100%;overflow:hidden;font:400 calc(var(--sf-unit)*6)/1.5 var(--sf-font-mono);font-variant-ligatures:none;color:var(--sf-text)}
.sf-fitting .sf-terminal__cmd,.sf-fitting .sf-terminal__out{white-space:pre}
.sf-terminal__cmd{white-space:pre-wrap;overflow-wrap:anywhere}
.sf-terminal__prompt{color:var(--sf-accent);margin-right:1ch}
.sf-terminal__caret{display:inline-block;width:0.6em;height:1.1em;margin:0 -0.7em 0 0.1em;vertical-align:text-bottom;background:var(--sf-accent)}
.sf-terminal__out{font:inherit;color:var(--sf-muted);white-space:pre-wrap;overflow-wrap:anywhere}
`,
};
