import { describe, expect, it } from "vitest";
import { unwrap, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Side } from "../src/kinds";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { useZones, zoneExtent } from "../src/queries/footprints";
import { clampInsets } from "../src/use-zone";
import { validateDocument } from "../src/validate";
import { place, rectDoc, withStoredZone } from "./helpers";

// Use-zone extents (furnish.15, .20; spec: layouts): one resolver, zoneExtent, gives each side's depth and its insets
// along the side, from the stored entry or the kind's defaults, clamped when read. All in the 6 × 4 room (inner faces
// x 0.1/5.9, y 0.1/3.9).

const ALL = { front: true, back: true, left: true, right: true };
const ok = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const r9 = (v: number): number => +v.toFixed(9) + 0;
const xs = (q: readonly Point[] | undefined): [number, number] => {
  const v = (q ?? []).map((p) => r9(p.x));
  return [Math.min(...v), Math.max(...v)];
};
const ys = (q: readonly Point[] | undefined): [number, number] => {
  const v = (q ?? []).map((p) => r9(p.y));
  return [Math.min(...v), Math.max(...v)];
};
const band = (doc: Document, id: string, side: Side): readonly Point[] | undefined => useZones(doc).get(id)?.find((z) => z.side === side)?.quad;
const placement = (doc: Document, id: string) => {
  const p = doc.placements[id];
  if (!p) throw new Error(`no placement ${id}`);
  return p;
};
const extentOf = (doc: Document, id: string, side: Side) => zoneExtent(doc, placement(doc, id), side);
const room = (): Document => rectDoc(0, 0, 6, 4);
const bed = (doc: Document): Document => place(doc, { object: "bed", kind: "bed", at: [3, 3.9] }); // 1.70 × 2.10: x 2.15–3.85, y 1.8–3.9

describe("the mattress's zones (cleanup.07, .14)", () => {
  const mattress = (doc: Document): Document => place(doc, { object: "m", kind: "mattress", at: [3, 3.9] }); // its back on the north face: x 2.2–3.8, y 1.9–3.9
  it("a mattress is 1.60 × 2.00 × 0.25 on its surface with every side off by default", () => {
    const doc = mattress(room());
    expect(doc.objects["m"]).toMatchObject({ kind: "mattress", w: { standard: 1.6 }, d: { standard: 2 } });
    expect(useZones(doc).get("m/s0") ?? []).toEqual([]);
  });
  it("set_zones can turn a mattress's side on: its extent then shows", () => {
    const doc = ok(mattress(room()), { type: "setZoneSides", placementId: "m/s0", sides: { front: false, back: false, left: true, right: false } });
    expect(extentOf(doc, "m/s0", "left")).toMatchObject({ depth: 0.6 });
    expect(band(doc, "m/s0", "left")).toBeDefined();
  });
});

describe("clampInsets (furnish.20)", () => {
  it("clampInsets keeps insets that leave 0.10 m and shrinks the rest in proportion", () => {
    expect(clampInsets(1.66, 0.3, 0.9)).toEqual([0.3, 0.9]);
    const [s, e] = clampInsets(1.2, 0.3, 0.9);
    expect(s).toBeCloseTo(0.275, 9); // an "end first" clamp gives [0.3, 0.8]
    expect(e).toBeCloseTo(0.825, 9);
    expect(clampInsets(0.3, 0.1, 0.1)).toEqual([0.1, 0.1]); // 0.1 + 0.1 + 0.1 is 0.30000000000000004
    const [a, b] = clampInsets(0.25, 0.1, 0.1);
    expect(a).toBeCloseTo(0.075, 9);
    expect(b).toBeCloseTo(0.075, 9);
    expect(clampInsets(0.1, 0.3, 0.9)).toEqual([0, 0]);
    expect(clampInsets(0.1, 0, 0)).toEqual([0, 0]); // no NaN from 0/0
  });
});

describe("zoneExtent (AC-20)", () => {
  it("zoneExtent: null when the side is off or the configuration has no zone", () => {
    const doc = bed(room());
    expect(extentOf(doc, "bed/s0", "front")).toBeNull(); // the bed's front is off
    expect(extentOf(doc, "bed/s0", "left")).toEqual({ depth: 0.6, start: 0.45, end: 0 });

    const folded = withStoredZone(
      place(room(), { object: "m", kind: "murphyBed", at: [3, 3.9], config: "folded", sides: ALL }),
      "m/s0", "front", { depth: 0.5, start: 0.2, end: 0.2 },
    );
    expect(extentOf(folded, "m/s0", "front")).toBeNull(); // closed, the unit has no zone

    const objects = { ...doc.objects };
    delete objects.bed;
    const orphan = { ...doc, objects };
    expect(zoneExtent(orphan, placement(orphan, "bed/s0"), "left")).toBeNull();
  });

  it("a new bed's side zones start 0.45 m from its head, so a nightstand at the head raises no warning (AC-20)", () => {
    const doc = bed(room());
    const zones = useZones(doc).get("bed/s0");
    expect(zones?.map((z) => z.side)).toEqual(["left", "right"]);
    expect([xs(band(doc, "bed/s0", "left")), ys(band(doc, "bed/s0", "left"))]).toEqual([[1.55, 2.15], [1.8, 3.45]]);
    expect([xs(band(doc, "bed/s0", "right")), ys(band(doc, "bed/s0", "right"))]).toEqual([[3.85, 4.45], [1.8, 3.45]]);

    const stand = place(doc, { object: "ns", kind: "nightstand", at: [1.92, 3.9] }); // 0.45 × 0.40: x 1.695–2.145, y 3.5–3.9
    expect(validateDocument(stand).ok).toBe(true);
    expect(clearanceWarnings(stand, "s0")).toEqual([]); // a full-side zone reaches y 3.9 and warns

    const deeper = ok(stand, { type: "setObjectSize", objectId: "ns", w: 0.45, d: { standard: 0.46 } }); // y 3.44–3.9
    expect(clearanceWarnings(deeper, "s0")).toEqual([
      { zone: { table: "placements", id: "bed/s0", side: "left" }, against: { table: "placements", id: "ns/s0" } },
    ]); // a 0.50 m head inset gives none
  });

  it("a desk's front zone is 0.70 m long and centred, whatever its width (AC-20)", () => {
    const doc = place(room(), { object: "desk", kind: "desk", at: [3, 3.9] }); // x 2.4–3.6, y 3.3–3.9
    expect([xs(band(doc, "desk/s0", "front")), ys(band(doc, "desk/s0", "front"))]).toEqual([[2.65, 3.35], [2.5, 3.3]]);
    const wide = ok(doc, { type: "setObjectSize", objectId: "desk", w: 1.6, d: {} }); // x 2.2–3.8
    expect(xs(band(wide, "desk/s0", "front"))).toEqual([2.65, 3.35]); // "trim 0.25 at each end" gives [2.45, 3.55]
    const narrow = ok(doc, { type: "setObjectSize", objectId: "desk", w: 0.6, d: {} }); // x 2.7–3.3
    expect(xs(band(narrow, "desk/s0", "front"))).toEqual([2.7, 3.3]); // the whole side, not wider
  });

  it("the open Murphy bed's zone is 0.20 m shorter than its width, centred (AC-20)", () => {
    const doc = place(room(), { object: "m", kind: "murphyBed", at: [3, 3.9], config: "down" }); // 1.60 × 2.10: x 2.2–3.8, y 1.8–3.9
    expect([xs(band(doc, "m/s0", "front")), ys(band(doc, "m/s0", "front"))]).toEqual([[2.3, 3.7], [1.2, 1.8]]);
    const narrow = ok(doc, { type: "setObjectSize", objectId: "m", w: 1, d: {} });
    expect(xs(band(narrow, "m/s0", "front"))).toEqual([2.6, 3.4]); // a 12.5 % trim gives [2.5625, 3.4375]
  });

  it("stored insets run from the left corner on the front and from the back corner on the sides", () => {
    const front = { depth: 0.4, start: 0.2, end: 0.5 };
    const wardrobe = withStoredZone(place(room(), { object: "w", kind: "wardrobe", at: [3, 3.9] }), "w/s0", "front", front); // x 2.4–3.6, y 3.3–3.9
    expect(extentOf(wardrobe, "w/s0", "front")).toEqual(front);
    expect([xs(band(wardrobe, "w/s0", "front")), ys(band(wardrobe, "w/s0", "front"))]).toEqual([[2.6, 3.1], [2.9, 3.3]]); // swapped: [2.9, 3.4]

    const turned = withStoredZone(place(room(), { object: "w", kind: "wardrobe", at: [3, 0.1], rotation: 180 }), "w/s0", "front", front); // y 0.1–0.7
    expect([xs(band(turned, "w/s0", "front")), ys(band(turned, "w/s0", "front"))]).toEqual([[2.9, 3.4], [0.7, 1.1]]);

    const right = withStoredZone(bed(room()), "bed/s0", "right", { depth: 0.5, start: 0.45, end: 0.3 });
    expect([xs(band(right, "bed/s0", "right")), ys(band(right, "bed/s0", "right"))]).toEqual([[3.85, 4.35], [2.1, 3.45]]); // from the front: [2.25, 3.6]
  });

  it("a stored entry applies to every configuration with a zone, clamped when the side is short (AC-21)", () => {
    const closed = withStoredZone(place(room(), { object: "t", kind: "extendingTable", at: [3, 2.5] }), "t/s0", "left", { depth: 0.5, start: 0.3, end: 0.9 }); // 0.80 × 1.20: y 1.3–2.5
    const c = extentOf(closed, "t/s0", "left");
    expect(c?.depth).toBeCloseTo(0.5, 9);
    expect(c?.start).toBeCloseTo(0.275, 9);
    expect(c?.end).toBeCloseTo(0.825, 9);
    expect([xs(band(closed, "t/s0", "left")), ys(band(closed, "t/s0", "left"))]).toEqual([[2.1, 2.6], [2.125, 2.225]]);

    const extended = ok(closed, { type: "setConfiguration", placementId: "t/s0", config: "extended" }); // y 0.84–2.5
    expect(extentOf(extended, "t/s0", "left")).toEqual({ depth: 0.5, start: 0.3, end: 0.9 });
    expect(ys(band(extended, "t/s0", "left"))).toEqual([1.74, 2.2]);

    for (const doc of [closed, extended]) expect(doc.placements["t/s0"]?.zones).toMatchObject({ leftDepth: 0.5, leftStart: 0.3, leftEnd: 0.9 }); // never written
  });
});
