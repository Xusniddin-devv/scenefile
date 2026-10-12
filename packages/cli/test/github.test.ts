import { check } from "@scenefile/engine";
import { describe, expect, it } from "vitest";
import { type RepoFacts, buildScenefile, fetchRepoFacts, parseRepo, readmeCommands } from "../src/github";

const README = `# pgsnap

[![CI](https://example.com/badge.svg)](https://example.com)

Snapshots for Postgres.

## Install

\`\`\`bash
# with npm
npm install -g pgsnap
\`\`\`

## Usage

\`\`\`sh
$ pgsnap save
$ pgsnap restore nightly-01
cd somewhere
\`\`\`

\`\`\`js
const pgsnap = require("pgsnap");
\`\`\`
`;

const facts: RepoFacts = {
  owner: "acme",
  name: "pgsnap",
  description: "Snapshots for Postgres: save a whole database with one command and bring it back with another.",
  stars: 1234,
  licence: "MIT",
  homepage: "https://pgsnap.example.com",
  url: "https://github.com/acme/pgsnap",
  latestRelease: "v2.1.0",
  languages: { TypeScript: 9000, Shell: 800, Dockerfile: 200 },
  readme: README,
  asOf: "2026-10-13",
};

describe("naming a repository", () => {
  it("accepts an address in the forms people paste", () => {
    for (const input of ["https://github.com/acme/pgsnap", "http://github.com/acme/pgsnap.git", "github.com/acme/pgsnap/tree/main/src", "acme/pgsnap", "git@github.com:acme/pgsnap.git"]) {
      expect(parseRepo(input), input).toEqual({ owner: "acme", repo: "pgsnap" });
    }
  });

  it("refuses anything else, without guessing", () => {
    for (const input of ["https://gitlab.com/acme/pgsnap", "pgsnap", "https://github.com/acme", "acme/pg snap", "acme/../etc", ""]) {
      expect(() => parseRepo(input), input).toThrow(/github\.com\/owner\/name/);
    }
  });
});

describe("finding commands in a README", () => {
  it("picks the install command and what to run after it, and nothing that is not a command", () => {
    expect(readmeCommands(README)).toEqual({ install: "npm install -g pgsnap", usage: ["pgsnap save", "pgsnap restore nightly-01"] });
  });

  it("finds nothing in a README without shell commands, rather than inventing one", () => {
    expect(readmeCommands("# x\n\nJust words.\n\n```js\nconsole.log(1)\n```")).toEqual({ install: null, usage: [] });
    expect(readmeCommands("```bash\ncurl https://x.sh | sh\nrm -rf /\n```")).toEqual({ install: null, usage: [] });
  });

  it("leaves out commands too long to show", () => {
    const long = `docker run ${"-e A=1 ".repeat(30)}img`;
    expect(readmeCommands(`\`\`\`bash\n${long}\npip install pgsnap\n\`\`\``).install).toBe("pip install pgsnap");
  });
});

describe("building the video from the facts", () => {
  it("makes a scenefile that passes the full check and says only what the repository says", () => {
    const scenefile = buildScenefile(facts, {});
    const result = check(scenefile);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const types = (scenefile.scenes as { type: string }[]).map((scene) => scene.type);
    expect(types).toEqual(["title", "terminal", "chart", "stat", "bullets", "outro"]);
    const text = JSON.stringify(scenefile);
    expect(text).toContain("npm install -g pgsnap");
    expect(text).toContain("1,234");
    expect(text).toContain("2026-10-13");
    expect(text).toContain("github.com/acme/pgsnap");
    expect(text).toContain("v2.1.0");
    // The language chart adds up to the whole.
    const chart = (scenefile.scenes as { type: string; bars?: { label: string; value: number }[] }[]).find((scene) => scene.type === "chart");
    expect(chart?.bars?.map((bar) => bar.label)).toEqual(["TypeScript", "Shell", "Dockerfile"]);
    expect(chart?.bars?.reduce((sum, bar) => sum + bar.value, 0)).toBeCloseTo(100, 0);
  });

  it("leaves out what it does not know instead of filling the gap", () => {
    const bare: RepoFacts = { ...facts, description: null, stars: 0, licence: null, homepage: null, latestRelease: null, languages: { Go: 10 }, readme: "# x" };
    const scenefile = buildScenefile(bare, {});
    expect((scenefile.scenes as { type: string }[]).map((scene) => scene.type)).toEqual(["title", "outro"]);
    expect(check(scenefile).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("does not make a scene of a handful of stars", () => {
    const types = (stars: number) => (buildScenefile({ ...facts, stars }, {}).scenes as { type: string }[]).map((scene) => scene.type);
    expect(types(9)).not.toContain("stat");
    expect(types(10)).toContain("stat");
  });

  it("stays valid with very long names and descriptions, and can add narration and a theme", () => {
    const long: RepoFacts = { ...facts, name: "a-very-long-repository-name-".repeat(5), description: "word ".repeat(120) };
    const scenefile = buildScenefile(long, { theme: "ink", narrate: true, screenshot: "home.png" });
    expect(scenefile.theme).toBe("ink");
    expect(scenefile.voice).toEqual({ name: "en-emma", captions: true });
    const scenes = scenefile.scenes as { type: string; say?: string; src?: string }[];
    expect(scenes.every((scene) => typeof scene.say === "string")).toBe(true);
    expect(scenes.find((scene) => scene.type === "screenshot")?.src).toBe("home.png");
    const asset = { id: "a", src: "home.png", width: 2560, height: 1600, dataUri: "data:image/png;base64,AA==" };
    const result = check(scenefile, { assets: new Map([["home.png", asset as never]]), diagnostics: [] });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("asking GitHub", () => {
  const routes: Record<string, [number, unknown]> = {
    "/repos/acme/pgsnap": [200, { name: "pgsnap", owner: { login: "acme" }, description: "Snapshots.", stargazers_count: 7, license: { spdx_id: "MIT" }, homepage: "", html_url: "https://github.com/acme/pgsnap" }],
    "/repos/acme/pgsnap/languages": [200, { Go: 5 }],
    "/repos/acme/pgsnap/releases/latest": [404, { message: "Not Found" }],
    "/repos/acme/pgsnap/readme": [200, "# pgsnap"],
  };
  const fake = (seen: string[] = [], overrides: Record<string, [number, unknown]> = {}) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      seen.push(`${path} ${new Headers(init?.headers).get("authorization") ?? "-"}`);
      const [status, body] = { ...routes, ...overrides }[path] ?? [404, {}];
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as typeof fetch;

  it("reads the public facts, and treats a missing release or homepage as unknown", async () => {
    const seen: string[] = [];
    const got = await fetchRepoFacts({ owner: "acme", repo: "pgsnap" }, { fetch: fake(seen), today: "2026-10-13" });
    expect(got).toMatchObject({ owner: "acme", name: "pgsnap", stars: 7, licence: "MIT", homepage: null, latestRelease: null, languages: { Go: 5 }, readme: "# pgsnap", asOf: "2026-10-13" });
    expect(seen.every((line) => line.endsWith(" -"))).toBe(true);
  });

  it("uses a token only when one is given, and never sends it anywhere but GitHub", async () => {
    const seen: string[] = [];
    await fetchRepoFacts({ owner: "acme", repo: "pgsnap" }, { fetch: fake(seen), token: "ghp_secret" });
    expect(seen.every((line) => line.endsWith(" Bearer ghp_secret"))).toBe(true);
  });

  it("explains a repository that does not exist, and a rate limit", async () => {
    await expect(fetchRepoFacts({ owner: "acme", repo: "nope" }, { fetch: fake() })).rejects.toThrow(/no public repository/i);
    const limited = fake([], { "/repos/acme/pgsnap": [403, { message: "API rate limit exceeded" }] });
    await expect(fetchRepoFacts({ owner: "acme", repo: "pgsnap" }, { fetch: limited })).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
