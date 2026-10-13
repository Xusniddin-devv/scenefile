import { readFileSync, writeFileSync } from "node:fs";
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

interface HearRequest {
  id: number;
  hear: true;
  /** Raw sound to listen to: 16 kHz, one channel, 32-bit floats. */
  sound: string;
  model: string;
  vad: string;
  language: string;
}
interface Recognizer {
  createStream(): { acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): { text: string };
}
interface Vad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(): { start: number; samples: Float32Array };
  pop(): void;
  flush(): void;
}

const listeners = new Map<string, Recognizer>();
const RATE = 16000;
const WINDOW = 512;
/** Samples of sound given to the model before and after each stretch the detector found. */
const LEAD = RATE * 0.3;
const TRAIL = RATE * 0.15;

/** Finds the stretches of speech, then asks the model what is said in each. */
function hear(request: HearRequest): { start: number; end: number; text: string }[] {
  const library = createRequire(import.meta.url)("sherpa-onnx-node") as {
    OfflineRecognizer: new (config: unknown) => Recognizer;
    Vad: new (config: unknown, bufferSeconds: number) => Vad;
  };
  const key = `${request.model}|${request.language}`;
  let recognizer = listeners.get(key);
  if (!recognizer) {
    recognizer = new library.OfflineRecognizer({
      featConfig: { sampleRate: RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: join(request.model, "base-encoder.int8.onnx"),
          decoder: join(request.model, "base-decoder.int8.onnx"),
          language: request.language,
          task: "transcribe",
        },
        tokens: join(request.model, "base-tokens.txt"),
        numThreads: 2,
        provider: "cpu",
      },
    });
    listeners.set(key, recognizer);
  }
  // Speech is cut where the speaker pauses, and never left longer than the model can take in at once.
  const vad = new library.Vad(
    { sileroVad: { model: request.vad, threshold: 0.4, minSpeechDuration: 0.25, minSilenceDuration: 0.35, maxSpeechDuration: 20, windowSize: WINDOW }, sampleRate: RATE, numThreads: 1, provider: "cpu" },
    60,
  );
  const raw = readFileSync(request.sound);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const heard: { start: number; end: number; text: string }[] = [];
  const drain = (): void => {
    while (!vad.isEmpty()) {
      const speech = vad.front();
      vad.pop();
      // The detector starts a moment after the voice does and stops as it trails off, which can cost a
      // first or last word. The model is given a little more on each side, from the sound itself.
      const from = Math.max(0, speech.start - LEAD);
      const to = Math.min(samples.length, speech.start + speech.samples.length + TRAIL);
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples: samples.subarray(from, to), sampleRate: RATE });
      recognizer.decode(stream);
      // Timed by where the detector heard speech, not by the extra sound the model was given.
      heard.push({ start: speech.start / RATE, end: (speech.start + speech.samples.length) / RATE, text: recognizer.getResult(stream).text });
    }
  };
  for (let at = 0; at + WINDOW <= samples.length; at += WINDOW) {
    vad.acceptWaveform(samples.subarray(at, at + WINDOW));
    drain();
  }
  vad.flush();
  drain();
  return heard;
}

// If the process that asked is gone, there is nobody to answer.
process.on("disconnect", () => process.exit(0));

process.on("message", (request: Request | HearRequest) => {
  if ("hear" in request) {
    try {
      process.send?.({ id: request.id, heard: hear(request) });
    } catch (cause) {
      process.send?.({ id: request.id, error: cause instanceof Error ? cause.message : String(cause) });
    }
    return;
  }
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
