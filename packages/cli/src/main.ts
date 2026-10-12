#!/usr/bin/env node
import { parseArgs } from "node:util";
import { serveStdio } from "@scenefile/mcp";
import { run } from "./run";

function fail(cause: unknown): void {
  console.error("scenefile hit an internal error. This is a bug in scenefile, not in your scenefile:");
  console.error(cause);
  process.exitCode = 70;
}

const argv = process.argv.slice(2);

if (argv[0] === "mcp") {
  // A server, not a command: it runs until the client disconnects, and its
  // standard output belongs to the protocol.
  try {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { root: { type: "string" }, "allow-remote-images": { type: "boolean", default: false } },
    });
    serveStdio({ root: values.root ?? process.cwd(), allowRemoteImages: values["allow-remote-images"] }).catch(
      (cause: unknown) => {
        // Failing to start is about how the server was started, not a bug: say why, plainly.
        console.error(cause instanceof Error ? cause.message : String(cause));
        process.exitCode = 2;
      },
    );
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    console.error("Usage: scenefile mcp [--root <folder>] [--allow-remote-images]");
    process.exitCode = 2;
  }
} else {
  run(argv, { out: (text) => console.log(text), err: (text) => console.error(text) }).then((code) => {
    process.exitCode = code;
  }, fail);
}
