import { describe, expect, it } from "vitest";
import { assertNever, unwrap, type Point } from "@fm/protocol";
import {
  MIN_ZONE_SIZE, OBJECT_KINDS, SIDE_IDS, SIDE_ZONE_KEYS, armsOf, clearanceWarnings, emptyDocument, execute, footprints, rectangleRoom, rotateAbout,
  storedZone, useZones, zoneExtent, type Command, type Document, type Placement, type Side, type ZoneExtent,
} from "../src";

// zoneExtent under random input (furnish.14, .20; AC-20, AC-21): a 20 × 20 room, one piece at (10, 10). Every
// resolved zone stays inside its side, at least 0.10 m deep and long; stored numbers survive a resize or a change of
// configuration; the drawn band is the resolved extent, its insets measured from the side's reference corner.

const ok = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const withCommands = (doc: Document, ...cmds: Command[]): Document => cmds.reduce(ok, doc);
const room = rectangleRoom({ x: 0, y: 0 }, 20, 20).reduce(ok, emptyDocument());
const ALL_ON = { front: true, back: true, left: true, right: true };
const ID = "x/p0";

const placement = (doc: Document): Placement => {
  const p = doc.placements[ID];
  if (!p) throw new Error("no placement");
  return p;
};
const sideLength = (doc: Document, side: Side): number => {
  const p = placement(doc);
  const object = doc.objects[p.object];
  const v = side === "front" || side === "back" ? object?.w[p.config] : object?.d[p.config];
  if (v === undefined) throw new Error("no size");
  return v;
};
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

/**
 * Checks the drawn band of `side` against `extent`: two corners on the side's line and two `depth` outward, and the
 * inner corners at exactly [start, L − end] from the side's reference corner (front q0, back q3, left q3, right q2,
 * of footprintQuad's q0 front-left, q1 front-right, q2 back-right, q3 back-left).
 */
function expectBand(doc: Document, side: Side, extent: ZoneExtent, label: string): void {
  const [q0, q1, q2, q3] = footprints(doc).get(ID) ?? [];
  if (!q0 || !q1 || !q2 || !q3) throw new Error("no footprint");
  const [ref, toward] = ((): [Point, Point] => {
    switch (side) {
      case "front": return [q0, q1];
      case "back": return [q3, q2];
      case "left": return [q3, q0];
      case "right": return [q2, q1];
      default: return assertNever(side);
    }
  })();
  const L = Math.hypot(toward.x - ref.x, toward.y - ref.y);
  const u = { x: (toward.x - ref.x) / L, y: (toward.y - ref.y) / L };
  const centre = { x: (q0.x + q2.x) / 2, y: (q0.y + q2.y) / 2 };
  const perp = { x: -u.y, y: u.x };
  const n = dot(sub(ref, centre), perp) > 0 ? perp : { x: u.y, y: -u.x }; // outward
  const band = useZones(doc).get(ID)?.find((z) => z.side === side)?.quad ?? [];
  expect(band, label).toHaveLength(4);
  const out = band.map((c) => dot(sub(c, ref), n));
  const inner = band.filter((_, i) => Math.abs(out[i] ?? NaN) <= 1e-9);
  const outer = band.filter((_, i) => Math.abs((out[i] ?? NaN) - extent.depth) <= 1e-9);
  expect([inner.length, outer.length], `${label}: band corners on the side and at depth`).toEqual([2, 2]);
  const along = inner.map((c) => dot(sub(c, ref), u)).sort((a, b) => a - b);
  expect(along[0], `${label}: start`).toBeCloseTo(extent.start, 9);
  expect(along[1], `${label}: L − end`).toBeCloseTo(L - extent.end, 9);
}

/**
 * Checks an `L` piece's front strips against `extent` (catalog.13): in footprint space, the left strip x from the
 * inner corner to `depth` beyond it, y from −d + start to the corner; the back strip y `depth` in front of the corner,
 * x from the corner to w/2 − end. Each strip at least MIN_ZONE_SIZE long.
 */
function expectStrips(doc: Document, extent: ZoneExtent, label: string): void {
  const p = placement(doc);
  const object = doc.objects[p.object];
  const arms = object ? armsOf(object) : null;
  const w = sideLength(doc, "front");
  const d = sideLength(doc, "left");
  if (!arms) throw new Error("no arms");
  const local = (q: Point): Point => sub(rotateAbout(q, p.at, -p.rotation), p.at);
  const box = (quad: readonly Point[]): number[] => {
    const xs = quad.map((q) => local(q).x);
    const ys = quad.map((q) => local(q).y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const strips = (useZones(doc).get(ID) ?? []).filter((z) => z.side === "front");
  expect(strips.map((z) => z.strip), `${label}: strips`).toEqual([0, 1]);
  const [cx, cy, z] = [-w / 2 + arms.left, -arms.back, extent.depth];
  const want = [[cx, -d + extent.start, cx + z, cy], [cx, cy - z, w / 2 - extent.end, cy]];
  strips.forEach((s, i) => box(s.quad).forEach((v, j) => expect(v, `${label}: strip ${i} [${j}]`).toBeCloseTo(want[i]?.[j] ?? NaN, 9)));
  expect(extent.start + MIN_ZONE_SIZE, `${label}: left strip length`).toBeLessThanOrEqual(d - arms.back + 1e-9);
  expect(extent.end + MIN_ZONE_SIZE, `${label}: back strip length`).toBeLessThanOrEqual(w - arms.left + 1e-9);
}

/** A bed 1.70 × 2.10 at (10, 10) turned `rotation`, its left zone stored as `left`, then sized w × d. */
const bed = (left: ZoneExtent, d = 2.1, rotation = 0): Document => withCommands(
  room,
  { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: "bed" }, at: { x: 10, y: 10 }, rotation },
  { type: "setZoneExtent", placementId: ID, side: "left", extent: left },
  { type: "setObjectSize", objectId: "x/o0", w: 1.7, d: { standard: d } },
);

describe("zoneExtent under random input (furnish.20; AC-20, AC-21)", () => {
  it("a stored zone longer than a shrunk side is clamped when read; the stored numbers stay", () => {
    const short = bed({ depth: 0.4, start: 0.45, end: 0.3 }, 0.5);
    const e = zoneExtent(short, placement(short), "left");
    expect(e?.depth).toBe(0.4);
    expect((e?.start ?? 0) + (e?.end ?? 0) + MIN_ZONE_SIZE).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(e?.start).toBeCloseTo(0.45 * 0.4 / 0.75, 9); // in proportion
    expect(e?.end).toBeCloseTo(0.3 * 0.4 / 0.75, 9);
    expect(storedZone(placement(short).zones, "left")).toEqual({ depth: 0.4, start: 0.45, end: 0.3 });
    const long = bed({ depth: 0.4, start: 0.45, end: 0.3 }, 2.1);
    expect(zoneExtent(long, placement(long), "left")).toEqual({ depth: 0.4, start: 0.45, end: 0.3 });
  });

  it("an extending table's zone stored while Extended stays as stored when Closed (AC-21)", () => {
    const doc = withCommands(
      room,
      { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: "extendingTable" }, at: { x: 10, y: 10 }, config: "extended" },
      { type: "setZoneExtent", placementId: ID, side: "left", extent: { depth: 0.6, start: 0.2, end: 0.4 } },
      { type: "setConfiguration", placementId: ID, config: "closed" },
    );
    expect(placement(doc).config).toBe("closed");
    expect(zoneExtent(doc, placement(doc), "left")).toEqual({ depth: 0.6, start: 0.2, end: 0.4 });
    expectBand(doc, "left", { depth: 0.6, start: 0.2, end: 0.4 }, "closed table");
  });

  it("a bed turned 90° measures its left zone's insets from the back corner", () => {
    const doc = bed({ depth: 0.6, start: 0.45, end: 0 }, 2.1, 90);
    expectBand(doc, "left", { depth: 0.6, start: 0.45, end: 0 }, "bed 90°");
  });

  it("zoneExtent stays inside its side for any stored entry, size, configuration and turn (fuzz)", () => {
    let seed = 11;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647; // Park–Miller, reproducible
    const pick = <T>(xs: readonly T[]): T => {
      const x = xs[Math.floor(random() * xs.length)];
      if (x === undefined) throw new Error("empty");
      return x;
    };
    const kinds = OBJECT_KINDS.filter((k) => !k.retired && k.configs.some((c) => c.zone !== null));
    let ells = 0;
    let ellFronts = 0;
    let warned = 0;
    const ellKinds = kinds.filter((k) => k.outline === "ell"); // a quarter of the trials: their front zone is two strips
    for (let trial = 0; trial < 600; trial++) {
      const kind = random() < 0.25 ? pick(ellKinds) : pick(kinds);
      const config = pick(kind.configs.filter((c) => c.zone !== null));
      const rotation = Math.floor(random() * 360);
      const side = pick(SIDE_IDS);
      // An `L` keeps its arms (0.60, the sofa's 0.90): sides from the arm + 0.10; on its front each strip, 3 − arm long on
      // the 3 × 3 piece, keeps 0.10.
      const ell = kind.outline === "ell";
      const arm = Math.max(kind.arms?.back ?? 0, kind.arms?.left ?? 0);
      const fit = (v: number, to: number): number => (ell ? to + (v - 0.1) * ((3 - to) / 2.9) : v);
      const inset = (v: number): number => (ell && side === "front" ? v * ((2.9 - arm) / 2.9) : v);
      const depth = 0.1 + random() * 1.9;
      const start = inset(random() * 2.9);
      const end = ell && side === "front" ? inset(random() * 2.9) : random() * (2.9 - start); // a strip each: independent
      const w = fit(0.1 + random() * 2.9, arm + 0.1);
      // A winder stays deeper than wide by 0.05 at least (I19, steps.09).
      const winder = kind.stair?.shape === "winder";
      const d = winder ? Math.max(fit(0.1 + random() * 2.9, arm + 0.1), w + 0.06) : fit(0.1 + random() * 2.9, arm + 0.1);
      if (ell) ells++;
      if (ell && side === "front") ellFronts++;
      const next = pick(kind.configs);
      const label = `trial ${trial}: ${kind.id} ${config.id}→${next.id} ${rotation}° ${w}×${d}, ${side} {${depth}, ${start}, ${end}}`;
      const allD = (v: number) => Object.fromEntries(kind.configs.map((c) => [c.id, v]));
      const doc = withCommands(
        room,
        { type: "placeObject", deck: null, opId: "x", state: "s0", object: { kind: kind.id }, at: { x: 10, y: 10 }, rotation, config: config.id },
        { type: "setObjectSize", objectId: "x/o0", w: winder ? 2.9 : 3, d: allD(3) },
        { type: "setZoneSides", placementId: ID, sides: ALL_ON },
        { type: "setZoneExtent", placementId: ID, side, extent: { depth, start, end } },
        { type: "setObjectSize", objectId: "x/o0", w, d: allD(d) },
        { type: "setConfiguration", placementId: ID, config: next.id },
      );
      const p = placement(doc);
      const zoneDepth = kind.configs.find((c) => c.id === p.config)?.zone ?? null;
      for (const s of SIDE_IDS) {
        const L = sideLength(doc, s);
        const keys = SIDE_ZONE_KEYS[s].map((k) => p.zones[k]);
        expect(keys, `${label}: stored ${s}`).toEqual(s === side ? [depth, start, end] : [null, null, null]);
        if (s === side) SIDE_ZONE_KEYS[s].forEach((k, i) => expect(p.zones[k], `${label}: ${k}`).toBe([depth, start, end][i]));
        const e = zoneExtent(doc, p, s);
        if (zoneDepth === null) {
          expect(e, `${label}: ${s} no zone`).toBeNull();
          continue;
        }
        if (!e) throw new Error(`${label}: ${s} has no zone`);
        expect(e.depth, `${label}: ${s} depth`).toBeGreaterThanOrEqual(MIN_ZONE_SIZE);
        expect(e.start, `${label}: ${s} start`).toBeGreaterThanOrEqual(0);
        expect(e.end, `${label}: ${s} end`).toBeGreaterThanOrEqual(0);
        if (ell && s === "front") {
          expectStrips(doc, e, `${label}: front`);
          const object = doc.objects[p.object];
          const arms = object ? armsOf(object) : null;
          const fits = arms !== null && start + MIN_ZONE_SIZE <= sideLength(doc, "left") - arms.back && end + MIN_ZONE_SIZE <= L - arms.left;
          if (s === side && fits) expect(e, `${label}: unclamped`).toEqual({ depth, start, end });
          if (s !== side) expect(e, `${label}: front default`).toEqual({ depth: zoneDepth, start: 0, end: 0 });
          continue;
        }
        expect(e.start + e.end + MIN_ZONE_SIZE, `${label}: ${s} length`).toBeLessThanOrEqual(L + 1e-9);
        if (s === side && start + end + MIN_ZONE_SIZE <= L) expect(e, `${label}: unclamped`).toEqual({ depth, start, end });
        if (s !== side && kind.id !== "bed" && kind.id !== "liftBed" && kind.id !== "desk" && kind.id !== "deskSet" && kind.id !== "murphyBed" && kind.id !== "winderStair") {
          expect(e, `${label}: ${s} default`).toEqual({ depth: zoneDepth, start: 0, end: 0 });
        }
        expectBand(doc, s, e, `${label}: ${s}`);
      }
      const warnings = clearanceWarnings(doc, "s0");
      warned += warnings.length;
      expect(warnings.filter((x) => x.against.table === "placements" && x.against.id === x.zone.id), `${label}: own footprint`).toEqual([]);
    }
    expect(warned).toBe(0); // one piece in an empty room: nothing to warn about, whatever its zones
    expect(ells).toBeGreaterThan(5); // `L` kinds are drawn too (catalog.27)
    expect(ellFronts).toBeGreaterThan(20);
  });
});
