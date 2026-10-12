/** One caption: the words, and the frames of the video it is on screen for. */
export interface Cue {
  from: number;
  to: number;
  text: string;
}

/** The most characters shown at once: about one line on a wide frame, two on a tall one. */
export const CAPTION_CHARACTERS = 48;
/** Seconds the last caption of a line stays after the voice stops. */
const LINGER_SECONDS = 0.2;

/** Words that end in a period without ending a sentence. */
const ABBREVIATION = /^(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|no|st|[a-z]|v?\d+(?:\.\d+)*)\.$/i;
/** A phrase shorter than this is not left on its own if it can join a neighbour. */
const SHORT = 8;

/** How long a phrase takes to say, in letters' worth: figures and signs take longer to say than to write. */
function spokenLength(text: string): number {
  let length = 0;
  for (const char of text) length += /\d/.test(char) ? 5 : char === "%" ? 7 : /[$€£₽]/u.test(char) ? 6 : 1;
  return length;
}

/** Cuts one sentence into parts of about equal length, none longer than `most` unless a single word is. */
function balanced(sentence: string, most: number): string[] {
  const words = sentence.split(" ");
  const parts: string[] = [];
  let current = "";
  let aim = 0;
  const plan = (from: number): void => {
    const rest = words.slice(from).join(" ").length;
    aim = rest / Math.max(1, Math.ceil(rest / most));
  };
  plan(0);
  for (const [index, word] of words.entries()) {
    const joined = current ? `${current} ${word}` : word;
    // A comma is a good place to stop once most of a part has been said.
    const pause = /[,;:]$/.test(current) && current.length >= aim * 0.6;
    // Otherwise stop where the part is nearest its intended length.
    const nearer = Math.abs(current.length - aim) <= Math.abs(joined.length - aim);
    if (current && (joined.length > most || pause || (joined.length > aim && nearer))) {
      parts.push(current);
      current = word;
      plan(index);
    } else {
      current = joined;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Splits a spoken line into captions and times them across the speech. The
 * voice gives no word timings, so each caption gets time in proportion to how
 * long it takes to say; over a few words the error is too small to see.
 */
export function captionCues(text: string, startFrame: number, seconds: number, fps: number, most = CAPTION_CHARACTERS): Cue[] {
  const sentences: string[] = [];
  let sentence = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    sentence = sentence ? `${sentence} ${word}` : word;
    if (/[.!?…]["')\]]?$/.test(word) && !ABBREVIATION.test(word)) {
      sentences.push(sentence);
      sentence = "";
    }
  }
  if (sentence) sentences.push(sentence);

  // Short sentences share a caption; a long one is cut into balanced parts.
  const groups: string[] = [];
  for (const whole of sentences) {
    const before = groups.at(-1);
    if (before !== undefined && `${before} ${whole}`.length <= most) groups[groups.length - 1] = `${before} ${whole}`;
    else groups.push(...balanced(whole, most));
  }
  // Nothing short is left alone if the caption before it has room.
  for (let i = groups.length - 1; i > 0; i--) {
    const joined = `${groups[i - 1]} ${groups[i]}`;
    if ((groups[i]?.length ?? 0) < SHORT && joined.length <= most) groups.splice(i - 1, 2, joined);
  }

  const total = groups.reduce((sum, group) => sum + spokenLength(group), 0);
  const frames = seconds * fps;
  const cues: Cue[] = [];
  let said = 0;
  for (const [index, group] of groups.entries()) {
    const from = startFrame + Math.round((said / total) * frames);
    said += spokenLength(group);
    const last = index === groups.length - 1;
    const to = last ? startFrame + Math.ceil(frames) + Math.round(LINGER_SECONDS * fps) : startFrame + Math.round((said / total) * frames);
    cues.push({ from, to, text: group });
  }
  return cues;
}
