import type { VoiceName } from "@scenefile/schema";

/** One line of narration as a sound file. */
export interface Speech {
  file: string;
  seconds: number;
}

/** Turns a line into speech in the named voice. Rejects with a plain message when it cannot. */
export type Speak = (text: string, voice: VoiceName) => Promise<Speech>;

export const DEFAULT_VOICE: VoiceName = "en-joe";

/** Seconds of screen time before a scene's narration starts: long enough for a transition to finish. */
export const SPEECH_LEAD_SECONDS = 0.5;
/** Seconds of quiet after a line before its scene may leave. */
export const SPEECH_TAIL_SECONDS = 0.35;

/** A guess at how long a line takes to say, for checking before the voice has been made. */
export function estimateSpeechSeconds(text: string): number {
  return Math.max(1, text.length / 13 + 0.5);
}
