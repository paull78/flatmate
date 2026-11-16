import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Primitive } from "@fm/editor";
import { SymbolSvg } from "../src/panels/symbol-svg";

// Footprint space (furnitureSymbol): x from −w/2 to w/2, y from −d to 0, world y up.
const W = 2;
const D = 1;
const PRIMITIVES: Primitive[] = [
  { kind: "polygon", points: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: -1, y: -1 }], holes: [], color: "#e0e0de" },
  { kind: "segment", a: { x: -1, y: -0.5 }, b: { x: 1, y: -0.5 }, width: { px: 1 }, color: "#2a2c2f", cap: "butt" },
  { kind: "arc", center: { x: 0, y: -0.5 }, radius: 0.4, from: 0, to: Math.PI, width: { px: 1 }, color: "#2a2c2f" },
  { kind: "disc", center: { x: 0.5, y: -0.25 }, radius: { m: 0.1 }, color: "#2a2c2f" },
];

const numbers = (s: string): number[] => [...s.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => Number(m[0]));

/** The value at `i`, failing the test when it is missing. */
function at<T>(items: readonly T[], i: number): T {
  const v = items.at(i);
  if (v === undefined) throw new Error(`nothing at ${i}`);
  return v;
}

describe("SymbolSvg (ux-polish item 5)", () => {
  it("a polygon, a segment, an arc and a disc become path, line, path and circle elements inside the viewBox", () => {
    const html = renderToStaticMarkup(<SymbolSvg primitives={PRIMITIVES} w={W} d={D} size={{ width: 64, height: 40 }} />);
    expect(html).toMatch(/^<svg[^>]*width="64"[^>]*height="40"/);
    const tags = [...html.matchAll(/<(path|line|circle)\b([^>]*)>/g)];
    expect(tags.map((t) => t[1])).toEqual(["path", "line", "path", "circle"]);

    const box = numbers(/viewBox="([^"]+)"/.exec(html)?.[1] ?? "");
    const [vx, vy, vw, vh] = [at(box, 0), at(box, 1), at(box, 2), at(box, 3)];
    const inside = (x: number, y: number) => x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
    const attr = (attrs: string, name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)?.[1]);
    const path = (attrs: string) => numbers(/\bd="([^"]+)"/.exec(attrs)?.[1] ?? "");

    const attrsOf = (i: number): string => at(tags, i)[2] ?? "";
    const [poly, line, arc, disc] = [attrsOf(0), attrsOf(1), attrsOf(2), attrsOf(3)];
    const polyPts = path(poly);
    expect(polyPts).toHaveLength(8);
    for (let i = 0; i < polyPts.length; i += 2) expect(inside(at(polyPts, i), at(polyPts, i + 1))).toBe(true);
    expect(poly).toContain('fill="#e0e0de"');

    // y flipped to screen: the back edge (world y = 0) is above the front (world y = −1)
    expect(attr(line, "y1")).toBeCloseTo(0.5);
    expect(inside(attr(line, "x1"), attr(line, "y1")) && inside(attr(line, "x2"), attr(line, "y2"))).toBe(true);
    expect(line).toContain('stroke="#2a2c2f"');

    // a half circle counter-clockwise from 0 to π in world space: from (0.4, 0.5) to (−0.4, 0.5) on screen, bulging up
    const arcNums = path(arc);
    expect(at(arcNums, 0)).toBeCloseTo(0.4);
    expect(at(arcNums, 1)).toBeCloseTo(0.5);
    expect(at(arcNums, -2)).toBeCloseTo(-0.4);
    expect(at(arcNums, -1)).toBeCloseTo(0.5);
    expect(at(arcNums, -3)).toBe(0); // sweep flag: right to left through the top (0, 0.1) is counter-clockwise as seen (symbols.16)
    expect(arc).toContain('fill="none"');

    expect(attr(disc, "r")).toBeCloseTo(0.1);
    expect(inside(attr(disc, "cx"), attr(disc, "cy"))).toBe(true);
    expect(attr(disc, "cy")).toBeCloseTo(0.25);
  });
});
