// A small PDF reader for tests (export.15): enough of the file structure to check what toPdf writes. Not a parser
// for PDFs in general: it expects the uncompressed layout toPdf produces.

export type ReadPdf = {
  header: string;
  objects: Map<number, string>; // object number → its text between "obj" and "endobj"
  offsetsOk: boolean; // every xref entry points at "n 0 obj"
  startxrefOk: boolean;
  pages: { mediaBox: number[]; content: string }[];
};

export function readPdf(bytes: Uint8Array): ReadPdf {
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const header = text.slice(0, text.indexOf("\n"));
  const objects = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(m[1]), m[2] ?? "");

  const startxref = Number(/startxref\n(\d+)\n%%EOF\s*$/.exec(text)?.[1] ?? NaN);
  const startxrefOk = text.slice(startxref, startxref + 4) === "xref";
  const xref = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text);
  const entries = (xref?.[2] ?? "").trim().split("\n").slice(1); // entry 0 is the free head
  const offsetsOk = entries.length === objects.size && entries.every((line, i) => text.startsWith(`${i + 1} 0 obj`, Number(line.slice(0, 10))));

  const pages: ReadPdf["pages"] = [];
  for (const body of objects.values()) {
    if (!/\/Type \/Page\b/.test(body)) continue;
    const mediaBox = (/\/MediaBox \[([^\]]*)\]/.exec(body)?.[1] ?? "").trim().split(/\s+/).map(Number);
    const ref = Number(/\/Contents (\d+) 0 R/.exec(body)?.[1] ?? NaN);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(objects.get(ref) ?? "")?.[1] ?? "";
    pages.push({ mediaBox, content: stream });
  }
  return { header, objects, offsetsOk, startxrefOk, pages };
}

/** The numbers before each occurrence of an operator in a content stream, e.g. "m" → [[x, y], …]. */
export function operands(content: string, op: string): number[][] {
  const tokens = content.split(/\s+/);
  const out: number[][] = [];
  tokens.forEach((t, i) => {
    if (t !== op) return;
    const nums: number[] = [];
    for (let j = i - 1; j >= 0 && /^-?\d*\.?\d+$/.test(tokens[j] ?? ""); j--) nums.unshift(Number(tokens[j]));
    out.push(nums);
  });
  return out;
}
