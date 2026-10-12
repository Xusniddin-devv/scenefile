import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ServerOptions, createServer } from "./server";

/**
 * Runs the server over standard input and output until the client disconnects
 * or the process is told to stop. Standard output carries the protocol and
 * nothing else; anything meant for a person must go to standard error.
 *
 * When the client goes away the process exits at once rather than finishing
 * renders nobody will collect. Exiting runs the renderer's own clean-up, which
 * removes any half-made video.
 */
export async function serveStdio(options: ServerOptions): Promise<void> {
  const server = createServer(options);
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  // The browser library installs its own handlers for these, which close the
  // browser but leave the process running; ours make the process stop.
  const signals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
  for (const [signal, number] of Object.entries(signals)) {
    process.on(signal, () => process.exit(128 + number));
  }
  await server.connect(new StdioServerTransport());
}
