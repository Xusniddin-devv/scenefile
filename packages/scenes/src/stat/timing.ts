export const COUNT_SECONDS = 0.9;

/** Anything before the first digit, the number (with optional thousands commas and decimals), and the rest. */
const NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s;

/**
 * The text of a stat partway through counting up. `progress` runs from 0 to 1.
 * Only the first number in the value moves; its prefix, suffix, decimal places
 * and thousands commas are kept. At 1 the result is the value exactly as given.
 */
export function statText(value: string, progress: number): string {
  const match = NUMBER.exec(value);
  if (progress >= 1 || !match) return value;
  const [, prefix = "", digits = "", suffix = ""] = match;
  const target = Number(digits.replace(/,/g, ""));
  const decimals = (digits.split(".")[1] ?? "").length;
  const [whole = "0", fraction] = (target * Math.max(0, progress)).toFixed(decimals).split(".");
  const grouped = digits.includes(",") ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${prefix}${grouped}${fraction === undefined ? "" : `.${fraction}`}${suffix}`;
}
