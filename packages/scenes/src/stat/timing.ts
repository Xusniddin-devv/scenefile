export const COUNT_SECONDS = 0.9;

/** Characters used to group thousands: comma, dot, apostrophe, and the spaces used for it. */
const GROUP = "[ ,.'\\u00A0\\u202F]";
/** A number with grouped thousands, optionally followed by a decimal part: 1,200 · 1 200 · 1.200,50 */
const GROUPED = new RegExp(`^(\\d{1,3})(?:(${GROUP})\\d{3})(?:\\2\\d{3})*(?:([.,])(\\d+))?$`);
/** A number without grouping, optionally with a decimal part written with a dot or a comma: 94 · 3.20 · 3,5 */
const PLAIN = /^(\d+)(?:([.,])(\d+))?$/;
/** The first run of digits and separators in a value, with what comes before and after it. */
const NUMBER = new RegExp(`^(\\D*?)(\\d(?:[\\d${GROUP.slice(1, -1)}]*\\d)?)(.*)$`, "s");

interface Figure {
  prefix: string;
  suffix: string;
  target: number;
  decimals: number;
  /** Character between thousands, or "" when the number is not grouped. */
  group: string;
  /** Character before the decimal part. */
  decimalMark: string;
}

/**
 * Works out which part of a value is a quantity that can count up. Returns
 * null when counting would mislead: no number, more than one number ("24/7",
 * "3 of 5"), a rank ("#1"), a year, or a number with leading zeros.
 */
function parse(value: string): Figure | null {
  const match = NUMBER.exec(value);
  if (!match) return null;
  const [, prefix = "", body = "", suffix = ""] = match;
  if (/\d/.test(suffix) || /[#№]\s*$/.test(prefix) || /^0\d/.test(body)) return null;

  const grouped = GROUPED.exec(body);
  const plain = grouped ? null : PLAIN.exec(body);
  if (grouped) {
    const [, , group = "", decimalMark = "", fraction = ""] = grouped;
    if (decimalMark === group) return null;
    const whole = body.slice(0, body.length - (fraction ? fraction.length + 1 : 0)).split(group).join("");
    return { prefix, suffix, target: Number(`${whole}.${fraction || "0"}`), decimals: fraction.length, group, decimalMark };
  }
  if (!plain) return null;
  const [, whole = "", decimalMark = "", fraction = ""] = plain;
  const target = Number(`${whole}.${fraction || "0"}`);
  const isYear = !fraction && whole.length === 4 && target >= 1900 && target <= 2100;
  if (isYear) return null;
  return { prefix, suffix, target, decimals: fraction.length, group: "", decimalMark };
}

/**
 * The text of a stat partway through counting up. `progress` runs from 0 to 1.
 * The number keeps its own notation (decimal places, decimal comma, thousands
 * separators). At 1 the result is the value exactly as given, and a value that
 * is not a single quantity is shown as given throughout.
 */
export function statText(value: string, progress: number): string {
  const figure = progress >= 1 ? null : parse(value);
  if (!figure) return value;
  const fixed = (figure.target * Math.max(0, progress)).toFixed(figure.decimals);
  const [whole = "0", fraction] = fixed.split(".");
  const grouped = figure.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, figure.group) : whole;
  // "-0%" reads as a mistake; a quantity that has not left zero carries no sign yet.
  const prefix = Number(fixed) === 0 ? figure.prefix.replace(/[-−]\s*$/, "") : figure.prefix;
  return `${prefix}${grouped}${fraction === undefined ? "" : `${figure.decimalMark}${fraction}`}${figure.suffix}`;
}
