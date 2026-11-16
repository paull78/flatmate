import { describe, expect, it } from "vitest";
import { furnitureSymbol, type Primitive } from "@fm/editor";
import { toPdf } from "../src/pdf";
import { toSvg } from "../src/svg";
import { operands, readPdf } from "./pdf-reader";

// The pillow rule through the writers (furnish.06, AC-08): each pillow's four rounded corners come out as four arcs,
// an SVG path with an A command each and, in the PDF, one Bézier each (a quarter turn).

/** The bed symbol moved by (dx, dy) and scaled by k; a bed draws only segments and arcs. */
function moved(ps: readonly Primitive[], dx: number, dy: number, k = 1): Primitive[] {
  const at = (x: number, y: number) => ({ x: (x + dx) * k, y: (y + dy) * k });
  return ps.map((p): Primitive => {
    switch (p.kind) {
      case "segment":
        return { ...p, a: at(p.a.x, p.a.y), b: at(p.b.x, p.b.y) };
      case "arc":
        return { ...p, center: at(p.center.x, p.center.y), radius: p.radius * k };
      default:
        throw new Error(`a bed symbol draws no ${p.kind}`);
    }
  });
}

const bed = (w: number, k = 1) => moved(furnitureSymbol("bed", "standard", w, 2), 1, 2.5, k);
const CASES: [number, number][] = [[1.29, 4], [1.3, 8]];

describe("pillows in the SVG and PDF writers (furnish.06, AC-08)", () => {
  it("toSvg and toPdf write one arc per pillow corner (AC-08)", () => {
    for (const [w, expected] of CASES) {
      const svg = toSvg(bed(w), { min: { x: 0, y: 0 }, max: { x: 2, y: 3 }, zoom: 100 });
      const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].filter((m) => (m[1] ?? "").includes("A"));
      expect(paths, `svg ${w}`).toHaveLength(expected);
      const content = readPdf(toPdf([{ widthMm: 210, heightMm: 297, primitives: bed(w, 100) }])).pages[0]?.content ?? "";
      expect(operands(content, "c"), `pdf ${w}`).toHaveLength(expected);
    }
  });
});
