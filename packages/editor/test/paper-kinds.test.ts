import { describe, expect, it } from "vitest";
import { OPENING_KINDS, OPENING_KIND_IDS, geometryOf, type OpeningKind } from "@fm/domain";
import { openingPrimitives, openingsDetailed, styleLook } from "../src/view/openings-layer";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { view3dItems } from "../src/view3d/items";
import type { WallItem } from "../src/view3d/types";
import { wallDoc, withCommands } from "./builders";

// Every kind on paper (openkinds, AC-12) and in sections: a sheet's scale picks the level of detail
// (`openingsDetailed`, smalls.10), and the level the frames, for each kind whose row is `framed`. A 10 m wall along
// x from the origin holds one opening from x 2.

const OFFSET = 2;

function placed(kind: OpeningKind, glazed = false) {
  const width = OPENING_KINDS[kind].width.default;
  const base = wallDoc({ x: 0, y: 0 }, { x: 10, y: 0 });
  const wall = Object.keys(base.walls)[0] ?? "";
  const doc = withCommands(base, { type: "addOpening", opId: "o", wall, kind, offset: OFFSET, width, glazed });
  const o = doc.openings["o/d0"];
  const g = o ? geometryOf(doc, o) : null;
  if (!o || !g) throw new Error(`no ${kind}`);
  return { doc, o, g, width };
}

/** The filled blocks standing at a jamb: polygons with a corner at the span's end and less than the span long. */
function jambBlocks(ps: readonly Primitive[], width: number): number {
  const at = (x: number) => (p: { x: number }) => Math.abs(p.x - x) < 1e-6;
  return ps.filter((p) => p.kind === "polygon").filter((p) => {
    const xs = p.points.map((q) => q.x);
    const long = Math.max(...xs) - Math.min(...xs);
    return long < width - 1e-6 && (p.points.some(at(OFFSET)) || p.points.some(at(OFFSET + width)));
  }).length;
}

const onPaper = (kind: OpeningKind, scale: number): Primitive[] => {
  const { o, g } = placed(kind);
  return openingPrimitives(o, g, styleLook(PRESENTATION_STYLE), true, openingsDetailed(PRESENTATION_STYLE, 1000 / scale));
};

describe("every kind on paper (AC-12)", () => {
  // The sliding door's plan symbol has drawn no frames since smalls, and today's kinds draw as before (AC-13): openkinds.29.
  it.each(OPENING_KIND_IDS.filter((k) => k !== "sliding"))("%s: frames at 1:50 when its row is framed, none at 1:100", (kind) => {
    const { width } = placed(kind);
    expect(jambBlocks(onPaper(kind, 50), width) > 0).toBe(OPENING_KINDS[kind].framed);
    expect(jambBlocks(onPaper(kind, 100), width)).toBe(0);
  });

  it("the open passage and the curtain are the two without frames", () => {
    expect(OPENING_KIND_IDS.filter((k) => !OPENING_KINDS[k].framed)).toEqual(["passage", "curtain"]);
  });

  it("an open passage on paper: two dashed lines across its span and no leaf or arc, at both scales", () => {
    for (const scale of [50, 100]) {
      const ps = onPaper("passage", scale);
      expect(ps.filter((p) => p.kind === "segment" && p.dash !== undefined)).toHaveLength(2);
      expect(ps.filter((p) => p.kind === "arc")).toEqual([]);
    }
  });
});

describe("sections read each kind as glass or an open doorway (openkinds spec, Paper)", () => {
  const glassOf = (kind: OpeningKind, glazed = false): boolean | undefined => {
    const { doc } = placed(kind, glazed);
    const wall = view3dItems(doc, "s0", null, new Set(), false).find((i): i is WallItem => i.item === "wall");
    return wall?.openings[0]?.glass;
  };

  it("glass: the windows, the sliding glass door and a glazed door; not: a plain door, the passage, the curtain", () => {
    for (const kind of ["window", "casement", "twoLeaf", "slidingGlass"] as const) expect(glassOf(kind), kind).toBe(true);
    expect(glassOf("swing", true)).toBe(true);
    for (const kind of ["swing", "pocket", "folding", "passage", "curtain"] as const) expect(glassOf(kind), kind).toBe(false);
  });
});
