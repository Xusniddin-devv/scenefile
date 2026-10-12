import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Speech is made here, in a process of its own. Making a line takes about as
 * long as saying it, and the engine's call does not return until it is done;
 * in the main process that would stop a server answering anything else. A
 * separate process, unlike a thread, can also always be stopped: the engine
 * keeps threads of its own that can hold a thread's owner open at exit.
 */
interface Request {
  id: number;
  folder: string;
  model: string;
  text: string;
  kokoro: boolean;
  speaker: number;
  /** Where to write the samples, as raw 32-bit floats. */
  out: string;
}
interface Engine {
  generate(request: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number };
}

const engines = new Map<string, Engine>();

function engineFor(request: Request): Engine {
  const found = engines.get(request.folder);
  if (found) return found;
  let library: { OfflineTts: new (config: unknown) => Engine };
  try {
    library = createRequire(import.meta.url)("sherpa-onnx-node");
  } catch {
    throw new Error("The speech engine is not installed for this kind of computer. Reinstall scenefile, or remove `say` from the scenes.");
  }
  const { folder } = request;
  const files = { tokens: join(folder, "tokens.txt"), dataDir: join(folder, "espeak-ng-data") };
  try {
    const engine = new library.OfflineTts({
      model: {
        ...(request.kokoro
          ? { kokoro: { model: join(folder, "model.onnx"), voices: join(folder, "voices.bin"), ...files } }
          : { vits: { model: join(folder, `${request.model}.onnx`), ...files } }),
        numThreads: 2,
        provider: "cpu",
      },
      maxNumSentences: 1,
    });
    engines.set(folder, engine);
    return engine;
  } catch {
    throw new Error(`This voice's files are damaged. Delete the folder ${folder} and install the voice again.`);
  }
}

process.on("message", (request: Request) => {
  try {
    const made = engineFor(request).generate({ text: request.text, sid: request.speaker, speed: 1 });
    const samples = Float32Array.from(made.samples);
    // Too large to pass as a message; the parent reads the file and removes it.
    writeFileSync(request.out, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    process.send?.({ id: request.id, sampleRate: made.sampleRate });
  } catch (cause) {
    process.send?.({ id: request.id, error: cause instanceof Error ? cause.message : String(cause) });
  }
});
