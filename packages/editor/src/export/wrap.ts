import type { FontStyle } from "../view/scene-types";
import { helveticaWidth } from "./helvetica";

// Text wrapped to a width on the sheet (sheet.05, .14): greedy at spaces, inside a word only when the word alone is
// wider than the line, line breaks kept. Past `maxLines` the last kept line ends with "…". Measured in Helvetica.

const ELLIPSIS = "…";

export function wrapText(text: string, size: number, width: number, maxLines: number, style?: FontStyle): string[] {
  if (text === "" || maxLines <= 0) return [];
  const fits = (s: string): boolean => helveticaWidth(s, size, style) <= width + 1e-9;
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      // A word wider than the line breaks inside itself.
      let rest = word;
      while (!fits(rest)) {
        let n = rest.length - 1;
        while (n > 1 && !fits(rest.slice(0, n))) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last !== "" && !fits(last + ELLIPSIS)) last = last.slice(0, -1);
  kept[maxLines - 1] = last.trimEnd() + ELLIPSIS;
  return kept;
}
