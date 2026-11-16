// Windows-1252 (WinAnsiEncoding), the encoding of PDF's built-in Helvetica (export.16): Latin-1 plus the 0x80–0x9F
// extras. Any other character prints as "?". The editor owns it: it decides what text a sheet holds and warns in the
// export panel; @fm/export encodes with it (export.26).

const EXTRAS: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const QUESTION = 0x3f;

function byteOf(code: number): number | null {
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return EXTRAS[code] ?? null;
}

/** One byte per character (code point), "?" where Windows-1252 has none. */
export function toWinAnsi(text: string): number[] {
  return Array.from(text, (ch) => byteOf(ch.codePointAt(0) ?? QUESTION) ?? QUESTION);
}

/** Whether any character of the text would print as "?" in the PDF. */
export function unsupportedChars(text: string): boolean {
  return Array.from(text).some((ch) => byteOf(ch.codePointAt(0) ?? QUESTION) === null);
}
