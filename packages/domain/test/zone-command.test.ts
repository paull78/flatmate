import { describe, expect, it } from "vitest";
import { unwrap, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { setZoneExtent } from "../src/commands/objects";
import type { Command, CommandOf } from "../src/commands/types";
import { SIDE_IDS, type Side } from "../src/kinds";
import type { Document, Placement } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { useZones, zoneExtent } from "../src/queries/footprints";
import { nullZones, type ZoneExtent } from "../src/use-zone";
import { rectDoc } from "./helpers";

// setZoneExtent (furnish.14, .20; spec: layouts): one side's use zone of one placement, a depth and two insets from the
// side's corners, in its layout only. The fixtures are zone-sides.test.ts's: a 6 × 4 room (inner faces x 0.1/5.9,
// y 0.1/3.9).

const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command) => unwrap(run(doc, cmd));
const placeKind = (doc: Document, opId: string, kind: string, x: number, y: number): Document =>
  ok(doc, { type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } }).doc;

// The bed's back edge (its head) on the far wall: x 2.2–3.8, y 1.9–3.9; its left side is x = 2.2, 2.00 long.
const withBed = (): Document =>
  ok(placeKind(rectDoc(0, 0, 6, 4), "b", "bed", 3, 3.9), { type: "setObjectSize", objectId: "b/o0", w: 1.6, d: { standard: 2 } }).doc;
/** The bed in s0 (b/p0) and in Night (n/p0, a copy of s0). */
const dayAndNight = (): Document => ok(withBed(), { type: "copyState", opId: "n", from: "s0", name: "Night" }).doc;
/** A desk, 1.20 × 0.60: x 2.4–3.6, y 3.3–3.9. */
const withDesk = (): Document => placeKind(rectDoc(0, 0, 6, 4), "d", "desk", 3, 3.9);

const r9 = (v: number): number => +v.toFixed(9) + 0;
const range = (q: readonly Point[] | undefined, axis: "x" | "y"): [number, number] => {
  const v = (q ?? []).map((p) => r9(p[axis]));
  return [Math.min(...v), Math.max(...v)];
};
const band = (doc: Document, id: string, side: Side): readonly Point[] | undefined => useZones(doc).get(id)?.find((z) => z.side === side)?.quad;
const placement = (doc: Document, id: string): Placement => {
  const p = doc.placements[id];
  if (!p) throw new Error(`no placement ${id}`);
  return p;
};
const extentOf = (doc: Document, id: string, side: Side) => zoneExtent(doc, placement(doc, id), side);
const extent = (placementId: string, side: Side, e: ZoneExtent | null): Command => ({ type: "setZoneExtent", placementId, side, extent: e });
const refused = (message: string) => ({ ok: false, error: { kind: "invalidInput", message } });
const BED_DEFAULT = { depth: 0.6, start: 0.45, end: 0 };

describe("setZoneExtent (furnish.14, .20)", () => {
  it("setZoneExtent stores one side in one layout and depends on the placement (AC-18)", () => {
    const doc = dayAndNight();
    const r = ok(doc, extent("b/p0", "left", { depth: 0.4, start: 0.45, end: 0 }));
    expect(r.doc.placements["b/p0"]?.zones).toEqual({ ...nullZones(), leftDepth: 0.4, leftStart: 0.45, leftEnd: 0 });
    expect(r.doc.placements["n/p0"]?.zones).toEqual(nullZones());
    expect(extentOf(r.doc, "b/p0", "left")).toEqual({ depth: 0.4, start: 0.45, end: 0 });
    expect(extentOf(r.doc, "b/p0", "right")).toEqual(BED_DEFAULT);
    expect(range(band(r.doc, "b/p0", "left"), "x")).toEqual([1.8, 2.2]);
    expect(range(band(r.doc, "b/p0", "left"), "y")).toEqual([1.9, 3.45]); // from the back corner; from the front it would be [2.35, 3.9]
    expect(range(band(r.doc, "b/p0", "right"), "x")).toEqual([3.8, 4.4]);
    expect(range(band(r.doc, "b/p0", "right"), "y")).toEqual([1.9, 3.45]);
    expect(range(band(r.doc, "n/p0", "left"), "x")).toEqual([1.6, 2.2]);
    expect(r.patch.puts.map((p) => `${p.table}/${p.entity.id}`)).toEqual(["placements/b/p0"]);
    expect(r.patch.dependencies).toEqual([
      { table: "objects", id: "b/o0" },
      { table: "placements", id: "b/p0" },
      { table: "states", id: "s0" },
    ]);
    const undone = unwrap(applyPatch(r.doc, invertPatch(r.patch)));
    expect(undone).toEqual(doc);
    expect(range(band(undone, "b/p0", "left"), "x")).toEqual([1.6, 2.2]); // one Undo restores 0.60
  });

  it("each side writes only its own three keys", () => {
    const doc = withDesk();
    for (const s of SIDE_IDS) {
      const zones = ok(doc, extent("d/p0", s, { depth: 0.3, start: 0.1, end: 0.2 })).doc.placements["d/p0"]?.zones;
      const set = Object.entries(zones ?? {}).filter(([, v]) => v !== null);
      expect(set).toEqual([[`${s}Depth`, 0.3], [`${s}Start`, 0.1], [`${s}End`, 0.2]]); // start ≠ end, so a swap shows
    }
  });

  it("the first write stores all three numbers even when they equal the default; the same extent again is an empty patch", () => {
    const first = ok(withBed(), extent("b/p0", "left", BED_DEFAULT));
    expect(first.patch.puts).toHaveLength(1);
    expect(first.doc.placements["b/p0"]?.zones.leftDepth).toBe(0.6);
    const cmd: CommandOf<"setZoneExtent"> = { type: "setZoneExtent", placementId: "b/p0", side: "left", extent: { ...BED_DEFAULT } };
    const again = unwrap(setZoneExtent(first.doc, cmd)); // direct, not through execute (smart.40)
    expect(again.doc).toBe(first.doc);
    expect(again.patch.puts).toEqual([]);
    expect(again.patch.dependencies).toHaveLength(3);
  });

  it("null puts a side back to the kind's default", () => {
    const stored = ok(withBed(), extent("b/p0", "left", { depth: 0.4, start: 0.45, end: 0 })).doc;
    const back = ok(stored, extent("b/p0", "left", null)).doc;
    expect(back.placements["b/p0"]?.zones).toEqual(nullZones());
    expect(extentOf(back, "b/p0", "left")).toEqual(BED_DEFAULT);
    const doc = withBed();
    const none = unwrap(setZoneExtent(doc, { type: "setZoneExtent", placementId: "b/p0", side: "left", extent: null }));
    expect(none.doc).toBe(doc);
    expect(none.patch.puts).toEqual([]);
  });

  it("limits, measured on the side in the current configuration", () => {
    const doc = withBed();
    expect(run(doc, extent("b/p0", "left", { depth: 0.1, start: 0, end: 0 })).ok).toBe(true);
    expect(run(doc, extent("b/p0", "left", { depth: 0.09, start: 0, end: 0 }))).toMatchObject(refused("A use zone is at least 0.10 m deep"));
    // A depth a hair under 0.10 (a computed drag) is stored as 0.10, which the load parser accepts (furnish.53).
    expect(ok(doc, extent("b/p0", "left", { depth: 0.1 - 5e-10, start: 0, end: 0 })).doc.placements["b/p0"]?.zones.leftDepth).toBe(0.1);
    expect(run(doc, extent("b/p0", "left", { depth: 0.5, start: -0.01, end: 0 }))).toMatchObject(refused("A use zone can't run past its side"));
    expect(run(doc, extent("b/p0", "left", { depth: 0.5, start: 0, end: -0.01 }))).toMatchObject(refused("A use zone can't run past its side"));
    expect(run(doc, extent("b/p0", "left", { depth: 0.5, start: 0.95, end: 0.95 })).ok).toBe(true);
    expect(run(doc, extent("b/p0", "left", { depth: 0.5, start: 0.96, end: 0.95 }))).toMatchObject(refused("A use zone is at least 0.10 m long"));
    expect(run(doc, extent("b/p0", "left", { depth: 0.5, start: 2.1, end: 0 }))).toMatchObject(refused("A use zone is at least 0.10 m long"));
    // −0 passes as an inset and is stored as 0, as JSON would carry it to the other clients.
    expect(Object.is(ok(doc, extent("b/p0", "left", { depth: 0.5, start: -0, end: -0 })).doc.placements["b/p0"]?.zones.leftStart, 0)).toBe(true);
    // 1.2 − 0.55 − 0.55 is 0.0999999999999999 in floating point.
    expect(run(withDesk(), extent("d/p0", "front", { depth: 0.5, start: 0.55, end: 0.55 })).ok).toBe(true);

    const bad: Command[] = [
      JSON.parse('{"type":"setZoneExtent","placementId":"b/p0","side":"top","extent":null}'),
      JSON.parse('{"type":"setZoneExtent","placementId":"b/p0","side":"left","extent":{"depth":0.5,"start":0}}'),
      JSON.parse('{"type":"setZoneExtent","placementId":"b/p0","side":"left","extent":{"depth":"0.5","start":0,"end":0}}'),
      JSON.parse('{"type":"setZoneExtent","placementId":"b/p0","side":"left","extent":{"depth":0.5,"start":0,"end":0,"width":1}}'),
      extent("b/p0", "left", { depth: Number.NaN, start: 0, end: 0 }),
      extent("b/p0", "left", { depth: 10.5, start: 0, end: 0 }),
    ];
    for (const cmd of bad) expect(run(doc, cmd)).toMatchObject(refused("Invalid zone"));
    expect(run(doc, extent("nope", "left", null))).toMatchObject({ ok: false, error: { kind: "notFound", message: "Placement not found" } });
  });

  it("allowed in any configuration; a configuration without a zone ignores it until it opens", () => {
    const folded = placeKind(rectDoc(0, 0, 6, 4), "m", "murphyBed", 3, 3.9); // 1.60 × 0.40: y 3.5–3.9
    const doc = ok(folded, extent("m/p0", "front", { depth: 0.8, start: 0.2, end: 0.2 })).doc;
    expect(extentOf(doc, "m/p0", "front")).toBeNull();
    expect(useZones(doc).get("m/p0")).toBeUndefined();
    const down = ok(doc, { type: "setConfiguration", placementId: "m/p0", config: "down" }).doc; // 2.10 deep: y 1.8–3.9
    expect(extentOf(down, "m/p0", "front")).toEqual({ depth: 0.8, start: 0.2, end: 0.2 });
    expect(range(band(down, "m/p0", "front"), "x")).toEqual([2.4, 3.6]);
    expect(range(band(down, "m/p0", "front"), "y")).toEqual([1, 1.8]);
    // Folded, the left side is 0.40 long, though open it would be 2.10.
    expect(run(folded, extent("m/p0", "left", { depth: 0.5, start: 0.2, end: 0.2 }))).toMatchObject(refused("A use zone is at least 0.10 m long"));
  });

  it("an extending table trimmed while Extended keeps a zone inside its side when Closed (AC-21)", () => {
    // Extended, 0.80 × 1.66: x 2.6–3.4, y 2.24–3.9.
    const doc = ok(rectDoc(0, 0, 6, 4), { type: "placeObject", deck: null, opId: "t", state: "s0", object: { kind: "extendingTable" }, at: { x: 3, y: 3.9 }, config: "extended" }).doc;
    const trimmed = ok(doc, extent("t/p0", "left", { depth: 0.6, start: 0.3, end: 1.0 })).doc; // leaves 0.36 m
    const closed = ok(trimmed, { type: "setConfiguration", placementId: "t/p0", config: "closed" }).doc; // y 2.7–3.9
    expect(closed.placements["t/p0"]?.zones).toMatchObject({ leftStart: 0.3, leftEnd: 1.0 });
    const e = extentOf(closed, "t/p0", "left");
    expect(e).not.toBeNull();
    expect(e?.depth).toBe(0.6);
    expect(e?.start).toBeGreaterThanOrEqual(0);
    expect(e?.end).toBeGreaterThanOrEqual(0);
    expect((e?.start ?? 9) + (e?.end ?? 9) + 0.1).toBeLessThanOrEqual(1.2 + 1e-9);
    const [y0, y1] = range(band(closed, "t/p0", "left"), "y");
    expect(y0).toBeGreaterThanOrEqual(2.7);
    expect(y1).toBeLessThanOrEqual(3.9);
    expect(y1 - y0).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(run(closed, extent("t/p0", "left", { depth: 0.6, start: 0.3, end: 1.0 }))).toMatchObject(refused("A use zone is at least 0.10 m long"));
  });
});
