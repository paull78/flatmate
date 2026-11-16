// A page image as a PDF object (sheetset.21): the JPEG's own bytes, which a reader decodes with /DCTDecode, so nothing
// here decodes a pixel. Strings hold one char per byte, as the writer's do. No `atob`: the core has no DOM.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SIXTHS = new Map(Array.from(BASE64, (ch, i) => [ch, i]));

/** The bytes of base64 text, one char per byte. What isn't in the alphabet is skipped, padding included. */
export function base64Bytes(text: string): string {
  const out: string[] = [];
  let bits = 0;
  let held = 0;
  for (const ch of text) {
    const six = SIXTHS.get(ch);
    if (six === undefined) continue;
    bits = (bits << 6) | six;
    held += 6;
    if (held >= 8) {
      held -= 8;
      out.push(String.fromCharCode((bits >> held) & 0xff));
      bits &= (1 << held) - 1;
    }
  }
  return out.join("");
}

type Frame = { width: number; height: number; components: number; bits: number };

/** The start-of-frame markers, baseline and progressive alike; C4, C8 and CC in their range mean other things. */
const isFrameMarker = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** A JPEG's frame header, or null without one before its first scan. */
function frameOf(bytes: string): Frame | null {
  const at = (i: number): number => bytes.charCodeAt(i);
  const word = (i: number): number => (at(i) << 8) | at(i + 1);
  if (at(0) !== 0xff || at(1) !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (at(i) !== 0xff) return null;
    const marker = at(i + 1);
    if (marker === 0xff) i += 1; // a fill byte
    else if (isFrameMarker(marker)) return { bits: at(i + 4), height: word(i + 5), width: word(i + 7), components: at(i + 9) };
    else if (marker === 0xda || marker === 0xd9) return null;
    else i += 2 + word(i + 2);
  }
  return null;
}

const COLOUR_SPACES = new Map([[1, "/DeviceGray"], [3, "/DeviceRGB"]]);

/** The PDF object for a base64 JPEG, or null when no reader could draw it: the importer's canvas writes one it can (sheetset.21). */
export function jpegObject(jpeg: string): string | null {
  const bytes = base64Bytes(jpeg);
  const frame = frameOf(bytes);
  const space = frame ? COLOUR_SPACES.get(frame.components) : undefined;
  if (!frame || !space || frame.width === 0 || frame.height === 0) return null;
  return `<< /Type /XObject /Subtype /Image /Width ${frame.width} /Height ${frame.height} /ColorSpace ${space} /BitsPerComponent ${frame.bits} /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n${bytes}\nendstream`;
}
