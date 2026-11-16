import { describe, expect, it } from "vitest";
import { emptyDocument, footprints, rectangleRoom, stairEdges, type Document, type StairEdge } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { catchEdge } from "../src/tools/stair-gesture";
import { withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Pointing at an edge catches it (edge-catch.02, .12, .16; AC-01 to AC-04), on the user's layout: the cabin with a Loft
// at x 1.1–3.9, y 0.9–2.9 and a notch in its south-west corner, x 1.1–1.75, y 0.9–2.06. An Alternating tread (0.60
// wide, run 1.12) should hang south off the notch's north side (0.65 long); the east side (1.16) is met first from the
// room, and its band covers the whole notch.
//
//        loft
//   ┌─────────────────
//   ├══N═══┐            N: y 2.06, x 1.10–1.75
//   │ ·    ║E           E: x 1.75, y 0.90–2.06
//   │notch ║═══S═══     S: the loft's south side, y 0.9, x 1.75–3.9
//   └──────┘

const LOFT = "loft/k0";
const TREAD = { state: "s0", kind: "alternatingTread", surface: null };
const NEAR_N = { x: 1.42, y: 1.95 }; // 0.11 under the north side, 0.33 from the east side

function notchDoc(): Document {
  return withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "cabin"), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 1.9 }, w: 2.8, d: 2.0, top: 2.15 },
    { type: "addDeckHole", opId: "notch", deck: LOFT, at: { x: 1.425, y: 1.48 }, w: 0.65, d: 1.16 });
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const isNorth = (e: StairEdge | null): boolean => e !== null && near(e.a.y, 2.06) && near(e.b.y, 2.06);
const isEast = (e: StairEdge | null): boolean => e !== null && near(e.a.x, 1.75) && near(e.b.x, 1.75);
const edge = (doc: Document, pick: (e: StairEdge) => boolean): StairEdge => {
  const found = stairEdges(doc, null, 0.6).find(pick);
  if (!found) throw new Error("no such edge");
  return found;
};

/** The points of a walk in many small moves (lesson: a realistic path, not a jump), through each of `via`. */
function path(via: readonly Point[], steps = 40): Point[] {
  const out: Point[] = [];
  via.slice(1).forEach((to, i) => {
    const from = via[i] ?? to;
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) out.push({ x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps });
  });
  return out;
}
/** The edge held at the end of a walk through the shell's Object tool. */
function walk(shell: FakeShell, via: readonly Point[]): StairEdge | null {
  for (const p of path(via)) shell.moveTo(p);
  const tool = shell.state.tool;
  return tool.name === "object" ? (tool.state.stair?.edge ?? null) : null;
}
function treadShell(): FakeShell {
  const shell = FakeShell.withDocument(notchDoc());
  shell.ui({ type: "setSnapStep", step: 0.1 });
  shell.ui({ type: "pickKind", kind: "alternatingTread" });
  return shell;
}

describe("pointing at an edge catches it (AC-01 to AC-04)", () => {
  it("from below, the notch's north side catches near it (AC-01)", () => {
    expect(isNorth(walk(treadShell(), [{ x: 1.42, y: 0.3 }, NEAR_N]))).toBe(true);
  });

  it("from the left (AC-01)", () => {
    expect(isNorth(walk(treadShell(), [{ x: 0.4, y: 1.6 }, NEAR_N]))).toBe(true);
  });

  it("from the right along the loft's south side (AC-01)", () => {
    expect(isNorth(walk(treadShell(), [{ x: 2.6, y: 0.6 }, { x: 1.42, y: 0.6 }, NEAR_N]))).toBe(true);
  });

  it("a click there places the tread off the north side, reaching the Loft (AC-01)", () => {
    const shell = treadShell();
    walk(shell, [{ x: 1.42, y: 0.3 }, NEAR_N]);
    shell.click(NEAR_N);
    const doc = shell.doc();
    const placed = Object.values(doc.placements).filter((p) => doc.objects[p.object]?.kind === "alternatingTread");
    const quad = footprints(doc).get(placed[0]?.id ?? "") ?? [];
    const r = (v: number): number => Math.round(v * 1000) / 1000;
    const box = [Math.min(...quad.map((q) => r(q.x))), Math.max(...quad.map((q) => r(q.x))), Math.min(...quad.map((q) => r(q.y))), Math.max(...quad.map((q) => r(q.y)))];
    expect(box).toEqual([1.1, 1.7, 0.943, 2.06]);
    expect(doc.objects[placed[0]?.object ?? ""]?.reaches).toBe(LOFT);
    expect(shell.view().toast).toBeNull();
  });

  it("walking on to the east side catches it (AC-02)", () => {
    expect(isEast(walk(treadShell(), [{ x: 1.42, y: 0.3 }, NEAR_N, { x: 1.6, y: 1.5 }]))).toBe(true);
  });

  it("near the inside corner the nearer side catches, whatever is held (AC-03)", () => {
    const doc = notchDoc();
    const north = edge(doc, (e) => isNorth(e));
    const east = edge(doc, (e) => isEast(e));
    expect(isEast(catchEdge(doc, TREAD, { x: 1.65, y: 1.9 }, north))).toBe(true); // 0.10 from east, 0.16 from north
    expect(isNorth(catchEdge(doc, TREAD, { x: 1.55, y: 1.98 }, east))).toBe(true); // 0.08 from north, 0.20 from east
  });

  it("a tie keeps the held edge", () => {
    const doc = notchDoc();
    const tie = { x: 1.6, y: 1.91 }; // 0.15 from both sides
    expect(isNorth(catchEdge(doc, TREAD, tie, edge(doc, (e) => isNorth(e))))).toBe(true);
    expect(isEast(catchEdge(doc, TREAD, tie, edge(doc, (e) => isEast(e))))).toBe(true);
  });

  it("farther than 0.30 m from every edge the hold still holds (AC-04)", () => {
    const doc = notchDoc();
    // 0.33 from the east side and 0.56 from the north side, in both their bands: the held east side stays.
    expect(isEast(catchEdge(doc, TREAD, { x: 1.42, y: 1.5 }, edge(doc, (e) => isEast(e))))).toBe(true);
    expect(isNorth(catchEdge(doc, TREAD, { x: 1.42, y: 1.5 }, edge(doc, (e) => isNorth(e))))).toBe(true);
  });
});
