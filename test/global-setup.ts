import { execSync } from "node:child_process";

/** The render tests load the built browser bundle, and the CLI tests run the built CLI. */
export default function setup(): void {
  execSync("pnpm -r build", { stdio: "inherit" });
}
