import { describe, expect, it } from "vitest";
import { footprintQuad, inConvex, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE, type PlanStyle } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, withCommands } from "./builders";

// A piece's lines stop at every filled piece drawn after it (fixes AC-13). Canvas2D paints a later fill over them, but the
// GPU renderers draw a layer's fills before its lines, so only clipping makes the two agree.

const place = (opId: string, kind: string, at: Point, more: object = {}): Command =>
  ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind, ...more }, at });

const layer = (doc: Document, selected = ""): readonly Primitive[] => objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE satisfies PlanStyle, selected, 80);

const segments = (prims: readonly Primitive[]) => prims.flatMap((p) => (p.kind === "segment" ? [p] : []));
/** The lines drawn before the last fill: the raised block is drawn last, so these aren't its own. */
const before = (prims: readonly Primitive[]) => segments(prims.slice(0, prims.flatMap((p, i) => (p.kind === "polygon" ? [i] : [])).at(-1) ?? 0));
const inset = (ring: readonly Point[]): (p: Point) => boolean => (p) => inConvex(p, ring, -0.01);
/** Whether any point along a line lies inside the ring: a long line can cross it away from its middle. */
const crosses = (s: { a: Point; b: Point }, ring: readonly Point[]): boolean =>
  Array.from({ length: 41 }, (_, i) => i / 40).some((t) => inset(ring)({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }));

const AT = { x: 4, y: 3 };

/** A block w × d, 0.30 tall at elevation `z`: placed aside, raised, then moved over `at`, as a person would. */
function raisedBlock(at: Point, w: number, d: number, z: number): Command[] {
  return [
    place("t", "block", { x: 1, y: 1 }),
    { type: "setObjectSize", objectId: "t/o0", w, d: { standard: d }, h: { standard: 0.3 }, z: { standard: z } },
    { type: "movePlacement", placementId: "t/p0", at, rotation: 0 },
  ];
}

describe("lines under a later fill", () => {
  // The desk's front edge runs at y 2.40, through the middle of the block at y 2.2-2.6.
  const BLOCK = { x: 4, y: 2.6 };
  const under = (): Document => withCommands(clearRoomDoc(8, 6, "r"), place("d", "desk", AT), ...raisedBlock(BLOCK, 0.8, 0.4, 0.8));
  const ring = footprintQuad(BLOCK, 0.8, 0.4, 0);

  it("a desk's lines don't cross a block drawn after it, in any renderer", () => {
    const inside = before(layer(under())).filter((s) => crosses(s, ring));
    expect(inside).toEqual([]);
  });

  it("selected, the desk's lines come whole, after the block's fill", () => {
    const prims = layer(under(), "d/p0");
    const lastFill = prims.flatMap((p, i) => (p.kind === "polygon" ? [i] : [])).at(-1) ?? -1;
    const inside = prims.flatMap((p, i) => (p.kind === "segment" && p.color === COLORS.wallSelected && crosses(p, ring) ? [i] : []));
    expect(inside.length).toBeGreaterThan(0);
    expect(Math.min(...inside)).toBeGreaterThan(lastFill);
  });

  it("a low stair's lines stop at a filled piece above them", () => {
    const stairAt = { x: 4, y: 3.4 };
    const doc = withCommands(
      clearRoomDoc(8, 6, "r"),
      place("s", "stair", stairAt),
      { type: "setObjectSize", objectId: "s/o0", w: 0.9, d: { standard: 1.2 }, h: { standard: 0.45 } },
      ...raisedBlock({ x: 4, y: 3 }, 0.5, 0.4, 0.6),
    );
    const blockRing = footprintQuad({ x: 4, y: 3 }, 0.5, 0.4, 0);
    expect(before(layer(doc)).filter((s) => crosses(s, blockRing))).toEqual([]);
  });

  it("two pieces side by side keep every line: touching isn't covering", () => {
    const beside = withCommands(clearRoomDoc(8, 6, "r"), place("a", "block", { x: 3, y: 3 }), place("b", "block", { x: 3.6, y: 3 }));
    const alone = (id: string, at: Point) => segments(layer(withCommands(clearRoomDoc(8, 6, "r"), place(id, "block", at))));
    expect(segments(layer(beside))).toHaveLength(alone("a", { x: 3, y: 3 }).length + alone("b", { x: 3.6, y: 3 }).length);
  });
});
