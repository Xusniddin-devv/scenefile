import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = new URL("../../../packages/cli/dist/main.js", import.meta.url).pathname;
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY to run this trial.");
const MAX_CALLS = 36, MAX_ROUNDS = 3, MAX_TOKENS = 4000;
let calls = 0, spent = 0;

const guide = (await run("node", [CLI, "guide"])).stdout;
const system = `You write scenefiles for the scenefile video tool. Reply with the scenefile as one JSON object and nothing else: no explanation, no code fence.\n\n${guide}`;
const briefs = {
  launch: "Make a launch video of about 30 seconds for pgsnap, a command line tool. It takes a snapshot of a Postgres database with one command (pgsnap save) and restores it with another (pgsnap restore). It is installed with npm install -g pgsnap. Use only text, code and terminal scenes: you have no image files.",
  bilingual: "Make a vertical video for phones, in Russian, announcing Bilim, an app that helps students prepare for the TOPIK Korean language exam with daily ten-minute practice. End with one closing line in Uzbek (Latin script). You have no image files.",
  compare: "Make a short video for developers explaining an API change: before, creating a user took three requests (create account, set profile, send invite); now it is one request, POST /v2/users. Show the old way against the new way, and show the new request as code. You have no image files.",
};
const models = ["deepseek/deepseek-v4-flash-0731", "minimax/minimax-m3", "qwen/qwen3.7-flash", "z-ai/glm-5.3-flash"];

async function ask(model, messages) {
  if (calls >= MAX_CALLS) throw new Error("call budget used up");
  calls += 1;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "scenefile live test" },
    body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, temperature: 0.4, usage: { include: true } }),
  });
  const body = await res.json();
  if (!res.ok || !body.choices) return { error: JSON.stringify(body.error ?? body).slice(0, 300) };
  spent += body.usage?.cost ?? 0;
  return { text: body.choices[0].message.content ?? "", usage: body.usage, finish: body.choices[0].finish_reason };
}

const results = [];
for (const model of models) for (const [name, brief] of Object.entries(briefs)) {
  const dir = `runs/${model.replace(/[/:]/g, "_")}/${name}`; mkdirSync(dir, { recursive: true });
  const messages = [{ role: "system", content: system }, { role: "user", content: brief }];
  const record = { model, brief: name, rounds: [], passed: false, error: null, tokens: 0 };
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await ask(model, messages).catch((e) => ({ error: String(e.message) }));
    if (reply.error) { record.error = reply.error; break; }
    record.tokens += reply.usage?.total_tokens ?? 0;
    const file = `${dir}/round${round}.json`; writeFileSync(file, reply.text);
    let exit = 0, out = "";
    try { out = (await run("node", [CLI, "check", file])).stdout; } catch (e) { exit = e.code; out = (e.stdout ?? "") + (e.stderr ?? ""); }
    const codes = [...out.matchAll(/^(error|warning)\s+(\S+)(?:\s+(\S+))?$/gm)].map((m) => `${m[1] === "error" ? "E" : "w"}:${m[2]}@${m[3] ?? ""}`);
    writeFileSync(`${dir}/round${round}.check.txt`, out);
    record.rounds.push({ exit, codes, finish: reply.finish, chars: reply.text.length });
    if (exit === 0) { record.passed = true; record.final = file; break; }
    const problems = out.slice(out.search(/^(error|warning)\s/m));
    messages.push({ role: "assistant", content: reply.text }, { role: "user", content: `The check reported:\n\n${problems}\n\nApply each fix and reply with the full corrected scenefile as JSON only.` });
  }
  results.push(record);
  console.log(`${model.padEnd(34)} ${name.padEnd(10)} ${record.error ? "API ERROR " + record.error : record.rounds.map((r, i) => `r${i + 1}:${r.exit === 0 ? "PASS" : "fail[" + r.codes.filter((c) => c.startsWith("E")).join(",") + "]"}${r.codes.filter((c) => c.startsWith("w")).length ? "+" + r.codes.filter((c) => c.startsWith("w")).length + "w" : ""}`).join("  ")}`);
}
writeFileSync("results.json", JSON.stringify({ calls, spentUsd: spent, results }, null, 2));
console.log(`\ncalls: ${calls} of ${MAX_CALLS}; cost reported by OpenRouter: $${spent.toFixed(4)}`);
