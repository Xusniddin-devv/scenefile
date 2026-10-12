#!/usr/bin/env node
import { run } from "./run";

run(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    console.error("scenefile hit an internal error. This is a bug in scenefile, not in your scenefile:");
    console.error(cause);
    process.exitCode = 70;
  },
);
