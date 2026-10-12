const WORDS_PER_SECOND = 3;

/** Seconds a viewer needs to read `text` on screen. */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / WORDS_PER_SECOND;
}

/** Escaped `text`, with the first occurrence of `highlight` wrapped in <em>. */
export function highlightHtml(text: string, highlight: string | undefined): string {
  const at = highlight === undefined ? -1 : text.indexOf(highlight);
  if (highlight === undefined || at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<em>${escapeHtml(highlight)}</em>${escapeHtml(text.slice(at + highlight.length))}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
