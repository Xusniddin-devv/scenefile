import { brotliDecompressSync } from "node:zlib";

/** WOFF2's built-in table tags are numbered; `cmap` is number 0. */
const CMAP_TAG = 0;
const CUSTOM_TAG = 63;
const GLYF_TAG = 10;
const LOCA_TAG = 11;

/**
 * Lists the code points a WOFF2 font file has glyphs for, by reading its
 * character map. This is the only reliable answer to "can this font draw this
 * character": the ranges a font package declares describe which characters a
 * subset is *for*, not which ones the font's designer actually drew.
 */
export function woff2CodePoints(file: Buffer): Set<number> {
  const tableCount = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let position = 48;

  const readBase128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file.readUInt8(position++);
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value >>> 0;
  };

  // The directory gives each table's length in the decompressed stream, in order.
  const lengths: { isCmap: boolean; length: number }[] = [];
  for (let i = 0; i < tableCount; i++) {
    const flags = file.readUInt8(position++);
    const tag = flags & 0x3f;
    const transform = flags >> 6;
    if (tag === CUSTOM_TAG) position += 4;
    let length = readBase128();
    const outlines = tag === GLYF_TAG || tag === LOCA_TAG;
    if ((outlines && transform === 0) || (!outlines && transform !== 0)) length = readBase128();
    lengths.push({ isCmap: tag === CMAP_TAG, length });
  }

  const data = brotliDecompressSync(file.subarray(position, position + compressedSize));
  let offset = 0;
  let cmap: Buffer | undefined;
  for (const table of lengths) {
    if (table.isCmap) cmap = data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  if (!cmap) throw new Error("font file has no character map");

  const codePoints = new Set<number>();
  const subtableCount = cmap.readUInt16BE(2);
  for (let i = 0; i < subtableCount; i++) {
    const start = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(start);
    if (format === 12) {
      const groups = cmap.readUInt32BE(start + 12);
      for (let g = 0; g < groups; g++) {
        const first = cmap.readUInt32BE(start + 16 + g * 12);
        const last = cmap.readUInt32BE(start + 20 + g * 12);
        const glyph = cmap.readUInt32BE(start + 24 + g * 12);
        for (let cp = first; cp <= last; cp++) if (glyph + (cp - first) !== 0) codePoints.add(cp);
      }
    } else if (format === 4) {
      const segments = cmap.readUInt16BE(start + 6) / 2;
      const ends = start + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const last = cmap.readUInt16BE(ends + s * 2);
        const first = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
        for (let cp = first; cp <= last && cp < 0xffff; cp++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
          else {
            glyph = cmap.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (cp - first) * 2);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) codePoints.add(cp);
        }
      }
    }
  }
  return codePoints;
}
