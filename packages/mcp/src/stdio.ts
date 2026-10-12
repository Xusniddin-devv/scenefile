import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ServerOptions, createServer } from "./server";

/**
 * Runs the server over standard input and output until the client disconnects.
 * Standard output carries the protocol and nothing else; anything meant for a
 * person must go to standard error.
 */
export async function serveStdio(options: ServerOptions): Promise<void> {
  const server = createServer(options);
  await server.connect(new StdioServerTransport());
}
