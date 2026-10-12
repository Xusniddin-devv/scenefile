function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The candidate closest to `word`, or undefined when none is plausibly a typo of it. */
export function nearest(word: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(2, Math.floor(word.length / 3));
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
