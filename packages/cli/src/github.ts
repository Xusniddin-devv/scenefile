/**
 * A video about a GitHub repository, made from what the repository itself
 * says: its public facts and the commands in its README. No model writes
 * anything, so nothing here can be invented; what is not known is left out.
 */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoFacts {
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  /** The licence's short name, such as "MIT"; null when GitHub cannot tell. */
  licence: string | null;
  homepage: string | null;
  url: string;
  latestRelease: string | null;
  /** Bytes of code by language, as GitHub counts them. */
  languages: Record<string, number>;
  readme: string;
  /** The day these facts were read, as YYYY-MM-DD. */
  asOf: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Reads a repository from an address, a clone address or "owner/name". */
export function parseRepo(input: string): RepoRef {
  const text = input.trim();
  const match =
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(text) ??
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/.exec(text) ??
    /^([^/\s:]+)\/([^/\s]+)$/.exec(text);
  const [, owner = "", repo = ""] = match ?? [];
  if (!OWNER.test(owner) || !NAME.test(repo) || repo === "." || repo === "..") {
    throw new Error(`"${input}" is not a GitHub repository. Give one as github.com/owner/name.`);
  }
  return { owner, repo };
}

const SHELLS = new Set(["bash", "sh", "shell", "zsh", "console", "terminal", "shell-session", "shellsession"]);
const INSTALL =
  /^(?:npm (?:i|install|create)|npx|pnpm (?:add|dlx|create|install)|yarn (?:add|dlx|create|global add)|bun (?:add|x|install)|pip3? install|pipx install|uv (?:pip install|tool install|add)|cargo (?:install|add)|go (?:install|get)|brew install|gem install|composer require|docker (?:run|pull)|dotnet (?:add|tool install)|deno (?:install|add))\b/;
/** Commands that set a machine up rather than show the tool, and ones not to repeat in a video. */
const NOT_USAGE = /^(?:cd|git|export|set|mkdir|echo|source|sudo|rm|mv|cp|curl|wget|chmod|cat|ls|touch|make|cmake)\b/;
const MAX_COMMAND = 60;
/** Fewer stars than this are not shown. */
const MIN_STARS = 10;

/**
 * The install command and up to two commands that follow it, from the shell
 * examples in a README. Anything piped into a shell, run as root, or too long
 * to show is passed over; if no install command is found, nothing is returned.
 */
export function readmeCommands(readme: string): { install: string | null; usage: string[] } {
  const lines: string[] = [];
  for (const block of readme.matchAll(/^```([^\n`]*)\n([\s\S]*?)^```/gm)) {
    const language = (block[1] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    const unlabelled = language === "";
    if (!unlabelled && !SHELLS.has(language)) continue;
    for (const raw of (block[2] ?? "").split("\n")) {
      const prompted = /^\s*[$>]\s+/.test(raw);
      // Without a language, only lines written with a prompt are taken to be commands.
      if (unlabelled && !prompted) continue;
      const line = raw.replace(/^\s*[$>]\s+/, "").trim();
      if (!line || line.startsWith("#") || line.length > MAX_COMMAND) continue;
      if (/\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(line) || /[\u0000-\u001f]/.test(line)) continue;
      lines.push(line);
    }
  }
  const at = lines.findIndex((line) => INSTALL.test(line));
  if (at < 0) return { install: null, usage: [] };
  const usage = lines
    .slice(at + 1)
    .filter((line) => !INSTALL.test(line) && !NOT_USAGE.test(line) && /^[A-Za-z0-9@._/-]+(?:\s|$)/.test(line))
    .slice(0, 2);
  return { install: lines[at] ?? null, usage };
}

/** Text cut to a length at a word, with dots to show it goes on. */
function clip(text: string, most: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= most) return flat;
  const cut = flat.slice(0, most - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > most * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}...`;
}

/** True when a text is mostly in Latin letters, which is what the English voice can read. */
function latin(text: string): boolean {
  const own = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && own / letters > 0.8;
}

export interface BuildOptions {
  theme?: string;
  /** Add an English narration and captions, in sentences built from the same facts. */
  narrate?: boolean;
  /** A picture of the project's home page, already saved beside the scenefile. */
  screenshot?: string;
}

/** The scenefile for a repository. Every scene is optional except the first and last. */
export function buildScenefile(facts: RepoFacts, options: BuildOptions): Record<string, unknown> {
  const name = clip(facts.name, 40);
  const description = facts.description ? clip(facts.description, 140) : null;
  const { install, usage } = readmeCommands(facts.readme);
  const address = clip(`github.com/${facts.owner}/${facts.name}`, 80);
  const say = (text: string): { say?: string } => (options.narrate ? { say: clip(text, 500) } : {});
  const scenes: Record<string, unknown>[] = [];

  scenes.push({
    type: "title",
    heading: name,
    ...(description ? { sub: description } : {}),
    ...say(`This is ${name}.${description && latin(description) ? ` ${description}` : ""}`),
  });

  if (options.screenshot) {
    let host = address;
    try {
      host = clip(new URL(facts.homepage ?? facts.url).host, 80);
    } catch {
      // Keep the repository's address.
    }
    scenes.push({ type: "screenshot", src: options.screenshot, url: host, ...say("This is its home page.") });
  }

  if (install) {
    scenes.push({
      type: "terminal",
      steps: [install, ...usage].map((run) => ({ run })),
      ...say(usage.length > 0 ? "Install it with one command, then run it." : "Install it with one command."),
    });
  }

  const total = Object.values(facts.languages).reduce((sum, bytes) => sum + bytes, 0);
  const ranked = Object.entries(facts.languages).sort((a, b) => b[1] - a[1]);
  if (ranked.length >= 2 && total > 0) {
    const share = (bytes: number): number => Math.round((bytes / total) * 1000) / 10;
    const shown = ranked.slice(0, 5).map(([label, bytes]) => ({ label: clip(label, 28), value: share(bytes) }));
    const rest = ranked.slice(5).reduce((sum, [, bytes]) => sum + bytes, 0);
    const bars = rest > 0 && share(rest) >= 0.1 ? [...shown.slice(0, 5), { label: "Other", value: share(rest) }] : shown;
    scenes.push({
      type: "chart",
      heading: "Languages, by share of the code",
      unit: "%",
      bars,
      highlight: bars[0]?.label,
      ...say(`It is written mostly in ${ranked[0]?.[0] ?? "one language"}.`),
    });
  }

  // A handful of stars says nothing yet; the scene is kept for when the number means something.
  if (facts.stars >= MIN_STARS) {
    const stars = facts.stars.toLocaleString("en-US");
    scenes.push({
      type: "stat",
      value: stars,
      label: facts.stars === 1 ? "star on GitHub" : "stars on GitHub",
      note: `As of ${facts.asOf}.`,
      ...say(`It has ${stars} ${facts.stars === 1 ? "star" : "stars"} on GitHub.`),
    });
  }

  const glance = [
    facts.licence && facts.licence !== "NOASSERTION" ? `${clip(facts.licence, 40)} licence` : null,
    facts.latestRelease ? `Latest release ${clip(facts.latestRelease, 40)}` : null,
    ranked[0] ? `Mostly ${clip(ranked[0][0], 40)}` : null,
  ].filter((item): item is string => item !== null);
  if (glance.length >= 2) {
    scenes.push({ type: "bullets", heading: "At a glance", items: glance, ...say("Here it is at a glance.") });
  }

  scenes.push({
    type: "outro",
    heading: "Find it on GitHub.",
    highlight: "GitHub.",
    ...(install && install.length <= 80 ? { command: install } : {}),
    url: address,
    ...say("You can find it on GitHub."),
  });

  return {
    version: 1,
    ...(options.theme ? { theme: options.theme } : {}),
    ...(options.narrate ? { voice: { name: "en-kristin", captions: true } } : {}),
    scenes,
  };
}

export interface FetchOptions {
  fetch?: typeof fetch;
  /** A GitHub token, for a higher request limit. Sent to api.github.com only. */
  token?: string;
  today?: string;
}

const API = "https://api.github.com";
const MAX_README = 200_000;

/** Reads a public repository's facts from GitHub. Four requests. */
export async function fetchRepoFacts(ref: RepoRef, options: FetchOptions = {}): Promise<RepoFacts> {
  const ask = (path: string, accept = "application/vnd.github+json"): Promise<Response> =>
    (options.fetch ?? fetch)(`${API}${path}`, {
      headers: {
        accept,
        "user-agent": "scenefile",
        "x-github-api-version": "2022-11-28",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const main = await ask(base);
  if (main.status === 404) throw new Error(`There is no public repository github.com/${ref.owner}/${ref.repo}.`);
  if (main.status === 403 || main.status === 429) {
    throw new Error("GitHub's limit on requests was reached. Try again in an hour, or set GITHUB_TOKEN to a token of yours for a higher limit.");
  }
  if (!main.ok) throw new Error(`GitHub answered ${main.status} for github.com/${ref.owner}/${ref.repo}.`);
  const repo = (await main.json()) as {
    name?: string;
    owner?: { login?: string };
    description?: string | null;
    stargazers_count?: number;
    license?: { spdx_id?: string | null } | null;
    homepage?: string | null;
    html_url?: string;
  };

  const [languages, release, readme] = await Promise.all([
    ask(`${base}/languages`).then((response) => (response.ok ? (response.json() as Promise<Record<string, number>>) : {})),
    ask(`${base}/releases/latest`).then(async (response) =>
      response.ok ? (((await response.json()) as { tag_name?: string }).tag_name ?? null) : null,
    ),
    ask(`${base}/readme`, "application/vnd.github.raw").then((response) => (response.ok ? response.text() : "")),
  ]);

  let homepage: string | null = null;
  try {
    const parsed = new URL(repo.homepage ?? "");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") homepage = parsed.href;
  } catch {
    // No home page, or not an address.
  }
  return {
    owner: repo.owner?.login ?? ref.owner,
    name: repo.name ?? ref.repo,
    description: repo.description?.trim() || null,
    stars: repo.stargazers_count ?? 0,
    licence: repo.license?.spdx_id ?? null,
    homepage,
    url: repo.html_url ?? `https://github.com/${ref.owner}/${ref.repo}`,
    latestRelease: release,
    languages,
    readme: readme.slice(0, MAX_README),
    asOf: options.today ?? new Date().toISOString().slice(0, 10),
  };
}
