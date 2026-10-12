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

/**
 * Splits a spoken line into captions and times them across the speech. The
 * voice gives no word timings, so each caption gets time in proportion to its
 * length; over a few words the error is too small to see.
 */
export function captionCues(text: string, startFrame: number, seconds: number, fps: number, most = CAPTION_CHARACTERS): Cue[] {
  // Sentences are kept apart; one too long to show at once is cut into parts of
  // about equal length, so no caption is left holding a single stray word.
  const sentences: string[] = [];
  let sentence = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    sentence = sentence ? `${sentence} ${word}` : word;
    if (/[.!?…]["')\]]?$/.test(word)) {
      sentences.push(sentence);
      sentence = "";
    }
  }
  if (sentence) sentences.push(sentence);

  const groups: string[] = [];
  for (const whole of sentences) {
    const aim = whole.length / Math.ceil(whole.length / most);
    let current = "";
    for (const word of whole.split(" ")) {
      const joined = current ? `${current} ${word}` : word;
      // Break at a comma once most of a part has been said, rather than a word or two later.
      const pause = /[,;:]$/.test(current) && current.length >= aim * 0.7;
      if (current && (joined.length > most || pause || current.length >= aim)) {
        groups.push(current);
        current = word;
      } else {
        current = joined;
      }
    }
    if (current) groups.push(current);
  }

  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const frames = seconds * fps;
  const cues: Cue[] = [];
  let said = 0;
  for (const [index, group] of groups.entries()) {
    const from = startFrame + Math.round((said / total) * frames);
    said += group.length;
    const last = index === groups.length - 1;
    const to = last ? startFrame + Math.ceil(frames) + Math.round(LINGER_SECONDS * fps) : startFrame + Math.round((said / total) * frames);
    cues.push({ from, to, text: group });
  }
  return cues;
}
