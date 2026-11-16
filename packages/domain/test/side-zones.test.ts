import { describe, expect, it } from "vitest";
import { unwrap, type Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { SIDE_IDS, type Side } from "../src/kinds";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { anchorAtMm, footprints, useZones } from "../src/queries/footprints";
import { freeFloor } from "../src/queries/free-floor";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { BED_160x200, place, rectDoc, rng, withOpening, withStoredZone } from "./helpers";

// Use zones by side and the seat rule (smart.08, .10, .19; spec: layouts): one band per active side, as deep as the
// state's zone and as long as the kind's default along that side (furnish.15: a bed's sides stop 0.45 m short of the
// head); a seat never blocks a zone of a piece you sit at. All in the 6 × 4 room
// (inner faces x 0.1/5.9, y 0.1/3.9; walls W1 bottom, W2 right, W3 top, W4 left) unless said otherwise.

const ALL = { front: true, back: true, left: true, right: true };
const ok = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const r9 = (v: number): number => +v.toFixed(9) + 0;
const round = (zones: readonly { side: Side; quad: readonly Point[] }[] | undefined) =>
  (zones ?? []).map((z) => ({ side: z.side, quad: z.quad.map((p) => ({ x: r9(p.x), y: r9(p.y) })) }));
const pts = (...xy: [number, number][]): Point[] => xy.map(([x, y]) => ({ x, y }));
const bed = (doc: Document): Document => place(doc, { object: "bed", kind: "bed", at: [3, 3.9], size: BED_160x200 }); // x 2.2–3.8, y 1.9–3.9

const LEFT = { side: "left", quad: pts([1.6, 1.9], [2.2, 1.9], [2.2, 3.45], [1.6, 3.45]) };
const RIGHT = { side: "right", quad: pts([3.8, 1.9], [4.4, 1.9], [4.4, 3.45], [3.8, 3.45]) };

const zoneOf = (id: string, side: Side) => ({ table: "placements", id, side });
const chairKey = { table: "placements", id: "chair/s0" };

describe("useZones by side (smart.08, AC-05)", () => {
  it("a bed placed with defaults has 0.6 m zones on its left and right and none at its foot (AC-05)", () => {
    expect(round(useZones(bed(rectDoc(0, 0, 6, 4))).get("bed/s0"))).toEqual([LEFT, RIGHT]);
  });

  it("turning front on in Day leaves Night with left and right (AC-05, a layout pair where only one has a side on)", () => {
    const night = ok(bed(rectDoc(0, 0, 6, 4)), { type: "copyState", opId: "n", from: "s0", name: "Night" });
    const doc = ok(night, { type: "setZoneSides", placementId: "bed/s0", sides: { front: true, back: false, left: true, right: true } });
    const front = { side: "front", quad: pts([2.2, 1.3], [3.8, 1.3], [3.8, 1.9], [2.2, 1.9]) };
    expect(round(useZones(doc).get("bed/s0"))).toEqual([front, LEFT, RIGHT]);
    const nightIds = Object.values(doc.placements).filter((p) => p.state !== "s0").map((p) => p.id);
    expect(nightIds).toHaveLength(1);
    expect(round(useZones(doc).get(nightIds[0] ?? ""))).toEqual([LEFT, RIGHT]);
  });

  it("a state with no zone has none whatever its toggles; the open state has all four", () => {
    const folded = place(rectDoc(0, 0, 6, 4), { object: "m", kind: "murphyBed", at: [3, 3.9], sides: ALL });
    expect(useZones(folded).has("m/s0")).toBe(false);
    const down = ok(folded, { type: "setConfiguration", placementId: "m/s0", config: "down" }); // 1.6 × 2.1: y 1.8–3.9
    const zones = round(useZones(down).get("m/s0"));
    expect(zones).toEqual([
      { side: "front", quad: pts([2.3, 1.2], [3.7, 1.2], [3.7, 1.8], [2.3, 1.8]) }, // the mattress, 0.10 m in at each end
      { side: "back", quad: pts([2.2, 3.9], [3.8, 3.9], [3.8, 4.5], [2.2, 4.5]) },
      { side: "left", quad: pts([1.6, 1.8], [2.2, 1.8], [2.2, 3.9], [1.6, 3.9]) },
      { side: "right", quad: pts([3.8, 1.8], [4.4, 1.8], [4.4, 3.9], [3.8, 3.9]) },
    ]);
  });

  it("a placement with a zone but every side off has no entry", () => {
    const off = { front: false, back: false, left: false, right: false };
    const doc = place(rectDoc(0, 0, 6, 4), { object: "bed", kind: "bed", at: [3, 3.9], size: BED_160x200, sides: off });
    expect(useZones(doc).has("bed/s0")).toBe(false);
  });

  // The footprint's corners of each side, as the editor's sideOf orders them: [front or left corner, back or right].
  const ends: Record<Side, [number, number]> = { front: [0, 1], right: [1, 2], back: [2, 3], left: [3, 0] };
  const near = (p: Point, q: Point | undefined) => q !== undefined && Math.abs(p.x - q.x) <= 1e-9 && Math.abs(p.y - q.y) <= 1e-9;
  const shoelace = (q: readonly Point[]) => Math.abs(q.reduce((s, p, k) => { const n = q[(k + 1) % q.length] ?? p; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
  const mean = (q: readonly Point[]): Point => ({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length });
  const scatter = (kind: string, sides?: typeof ALL): Document => {
    const next = rng(7);
    let doc = rectDoc(0, 0, 40, 40);
    for (let i = 0; i < 200; i++) doc = place(doc, { object: `d${i}`, kind, at: [2 + next() * 36, 2 + next() * 36], rotation: Math.floor(next() * 360), sides });
    return doc;
  };

  it("every side band shares one whole side with its footprint and has area side × zone (fuzz, seed 7)", () => {
    // A wardrobe: full-side defaults on every side, a 0.6 zone.
    const doc = scatter("wardrobe", ALL);
    const area: Record<Side, number> = { front: 1.2 * 0.6, back: 1.2 * 0.6, left: 0.6 * 0.6, right: 0.6 * 0.6 };
    for (let i = 0; i < 200; i++) {
      const foot = footprints(doc).get(`d${i}/s0`) ?? [];
      const bands = useZones(doc).get(`d${i}/s0`) ?? [];
      expect(bands.map((b) => b.side)).toEqual([...SIDE_IDS]);
      for (const b of bands) {
        const [m, n] = ends[b.side];
        expect(b.quad.filter((p) => near(p, foot[m])), `${i} ${b.side}`).toHaveLength(1);
        expect(b.quad.filter((p) => near(p, foot[n])), `${i} ${b.side}`).toHaveLength(1);
        expect(shoelace(b.quad)).toBeCloseTo(area[b.side], 9);
        // Outside, not inside: the band's centre sits half the zone depth out from its side's middle, away from the
        // footprint's centre.
        const a = foot[m] ?? { x: 0, y: 0 };
        const c = foot[n] ?? { x: 0, y: 0 };
        const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        const centre = mean(foot);
        const len = Math.hypot(mid.x - centre.x, mid.y - centre.y);
        const want = { x: mid.x + ((mid.x - centre.x) / len) * 0.3, y: mid.y + ((mid.y - centre.y) / len) * 0.3 };
        const got = mean(b.quad);
        expect(Math.hypot(got.x - want.x, got.y - want.y), `${i} ${b.side}`).toBeLessThan(1e-9);
      }
    }
  });

  it("a bed's side bands touch the footprint's front corner, not its back one, and are (d − 0.45) × 0.6 (fuzz, seed 7)", () => {
    const doc = scatter("bed"); // 1.70 × 2.10, left and right on
    for (let i = 0; i < 200; i++) {
      const foot = footprints(doc).get(`d${i}/s0`) ?? [];
      const bands = useZones(doc).get(`d${i}/s0`) ?? [];
      expect(bands.map((b) => b.side)).toEqual(["left", "right"]);
      for (const b of bands) {
        const [front, back] = b.side === "left" ? [0, 3] : [1, 2];
        expect(b.quad.filter((p) => near(p, foot[front])), `${i} ${b.side}`).toHaveLength(1);
        expect(b.quad.filter((p) => near(p, foot[back])), `${i} ${b.side}`).toHaveLength(0);
        expect(shoelace(b.quad)).toBeCloseTo((2.1 - 0.45) * 0.6, 9);
        // Its centre: 1.65 / 2 along the side from the front corner, 0.3 out from it.
        const f = foot[front] ?? { x: 0, y: 0 };
        const h = foot[back] ?? { x: 0, y: 0 };
        const along = { x: (h.x - f.x) / 2.1, y: (h.y - f.y) / 2.1 };
        const other = foot[b.side === "left" ? 1 : 0] ?? { x: 0, y: 0 };
        const out = { x: (f.x - other.x) / 1.7, y: (f.y - other.y) / 1.7 };
        const want = { x: f.x + along.x * 0.825 + out.x * 0.3, y: f.y + along.y * 0.825 + out.y * 0.3 };
        const got = mean(b.quad);
        expect(Math.hypot(got.x - want.x, got.y - want.y), `${i} ${b.side}`).toBeLessThan(1e-9);
      }
    }
  });
});

describe("clearanceWarnings by side and the seat rule (smart.10, .19, AC-07)", () => {
  const desk = (doc: Document, x = 2): Document => place(doc, { object: "desk", kind: "desk", at: [x, 3.9] });
  const wardrobe = (doc: Document, x = 4.5): Document => place(doc, { object: "wardrobe", kind: "wardrobe", at: [x, 3.9] });
  const chair = (doc: Document, x: number, y: number, rotation = 0): Document => place(doc, { object: "chair", kind: "chair", at: [x, y], rotation });

  it("a chair in a desk's zone gives no warning; the same chair in a wardrobe's zone gives one (AC-07)", () => {
    const atDesk = chair(desk(rectDoc(0, 0, 6, 4)), 2, 3.2); // desk zone y 2.5–3.3; chair y 2.75–3.2
    expect(validateDocument(atDesk).ok).toBe(true);
    expect(clearanceWarnings(atDesk, "s0")).toEqual([]);
    const atWardrobe = chair(wardrobe(rectDoc(0, 0, 6, 4)), 4.5, 3.2); // wardrobe zone y 2.7–3.3
    expect(validateDocument(atWardrobe).ok).toBe(true);
    expect(clearanceWarnings(atWardrobe, "s0")).toEqual([{ zone: zoneOf("wardrobe/s0", "front"), against: chairKey }]);
  });

  it("a chair turned 45° straddling the desk zone's edge gives no warning (AC-07)", () => {
    const at = anchorAtMm({ x: 2, y: 2.5 }, 0.45, 45); // y 2.18–2.82 crosses the zone edge y = 2.5
    const doc = chair(desk(rectDoc(0, 0, 6, 4)), at.x, at.y, 45);
    expect(validateDocument(doc).ok).toBe(true);
    expect(clearanceWarnings(doc, "s0")).toEqual([]);
  });

  it("one chair inside both a desk zone and a wardrobe zone warns once, for the wardrobe (fixture that changes the answer)", () => {
    // Desk x 1.8–3.0, wardrobe x 3.0–4.2, chair x 2.775–3.225, y 2.775–3.225: inside both zones. Skipping every
    // chair would give no warning, and no seat rule two.
    // The desk's default front zone is 0.70 m long (x 2.05–2.75) and misses the chair, so a stored full-side 0.8 zone
    // puts the chair back in it.
    const doc = withStoredZone(chair(wardrobe(desk(rectDoc(0, 0, 6, 4), 2.4), 3.6), 3.0, 3.225), "desk/s0", "front", { depth: 0.8, start: 0, end: 0 });
    expect(validateDocument(doc).ok).toBe(true);
    expect(clearanceWarnings(doc, "s0")).toEqual([{ zone: zoneOf("wardrobe/s0", "front"), against: chairKey }]);
  });

  it("a block in a desk zone warns; a chair in an open folding table's zone does not", () => {
    const blocked = place(desk(rectDoc(0, 0, 6, 4)), { object: "block", kind: "block", at: [2, 3.2] });
    expect(clearanceWarnings(blocked, "s0")).toEqual([{ zone: zoneOf("desk/s0", "front"), against: { table: "placements", id: "block/s0" } }]);
    const table = place(rectDoc(0, 0, 6, 4), { object: "t", kind: "foldingTable", at: [2, 3.9], config: "open" }); // zone y 2.5–3.1
    const seated = chair(table, 2, 3.0);
    expect(validateDocument(seated).ok).toBe(true);
    expect(useZones(seated).has("t/s0")).toBe(true);
    expect(clearanceWarnings(seated, "s0")).toEqual([]);
  });

  it("one bed blocked on two sides warns once per side, sorted by side", () => {
    // Bed x 0.1–1.7, y 1.9–3.9: its left zone crosses W4, its right zone (x 1.7–2.3) holds the block (y 2.4–3.0).
    const bedAtWall = place(rectDoc(0, 0, 6, 4), { object: "bed", kind: "bed", at: [0.9, 3.9], size: BED_160x200 });
    const doc = place(bedAtWall, { object: "block", kind: "block", at: [2.0, 3.0] });
    expect(validateDocument(doc).ok).toBe(true);
    expect(clearanceWarnings(doc, "s0")).toEqual([
      { zone: zoneOf("bed/s0", "left"), against: { table: "walls", id: "W4" } },
      { zone: zoneOf("bed/s0", "right"), against: { table: "placements", id: "block/s0" } },
    ]);
  });

  it("a chair at the long side of a closed extending table gives no warning; a block 0.30 m from that side gives one (AC-07)", () => {
    const table = place(rectDoc(0, 0, 6, 4), { object: "t", kind: "extendingTable", at: [3, 2.5] }); // closed: x 2.6–3.4, y 1.3–2.5
    expect(round(useZones(table).get("t/s0"))).toEqual([
      { side: "left", quad: pts([2.0, 1.3], [2.6, 1.3], [2.6, 2.5], [2.0, 2.5]) },
      { side: "right", quad: pts([3.4, 1.3], [4.0, 1.3], [4.0, 2.5], [3.4, 2.5]) },
    ]);
    const seated = chair(table, 2.3, 2.1); // x 2.075–2.525: inside the left zone
    expect(validateDocument(seated).ok).toBe(true);
    expect(clearanceWarnings(seated, "s0")).toEqual([]);
    const blocked = place(table, { object: "b", kind: "block", at: [2.0, 2.2] }); // x 1.7–2.3: its near edge 0.30 m from the side
    expect(validateDocument(blocked).ok).toBe(true);
    expect(clearanceWarnings(blocked, "s0")).toEqual([{ zone: zoneOf("t/s0", "left"), against: { table: "placements", id: "b/s0" } }]);
    const extended = ok(table, { type: "setConfiguration", placementId: "t/s0", config: "extended" });
    expect(useZones(extended).get("t/s0")?.map((z) => z.side)).toEqual(["left", "right"]);
  });

  it("a door swing still warns for a chair", () => {
    // The swing square: x 1–1.8, y 0.1–0.9. The chair: x 1.175–1.625, y 0.15–0.6.
    const doc = chair(withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 1 }), 1.4, 0.6);
    expect(clearanceWarnings(doc, "s0")).toEqual([{ zone: { table: "openings", id: "d" }, against: chairKey }]);
  });

  it("a pre-cycle drawing opens with its warnings as before, except bed sides and chairs at desks (AC-11)", () => {
    const at = (x: number, y: number, rotation = 0) => ({ at: { x, y }, rotation, config: "standard" });
    const object = (id: string, kind: string, name: string, w: number, d: number) => ({ id, kind, name, w: { standard: w }, d: { standard: d } });
    const placement = (object: string, x: number, y: number, rotation = 0) => ({ id: `${object}/s0`, object, state: "s0", ...at(x, y, rotation) });
    const file: Record<string, unknown> = {
      ...serialize(rectDoc(0, 0, 6, 4)),
      states: { s0: { id: "s0", name: "Layout", order: 0 } },
      objects: {
        bed: object("bed", "bed", "Bed", 1.6, 2),
        block: object("block", "block", "Block", 0.6, 0.6),
        chair: object("chair", "chair", "Chair", 0.45, 0.45),
        desk: object("desk", "desk", "Desk", 1.2, 0.6),
        wardrobe: object("wardrobe", "wardrobe", "Wardrobe", 1.2, 0.6),
      },
      placements: {
        "bed/s0": placement("bed", 0.9, 3.9), // x 0.1–1.7, its left against W4
        "desk/s0": placement("desk", 3.5, 3.9), // zone y 2.5–3.3
        "chair/s0": placement("chair", 3.5, 3.2), // in the desk zone
        "wardrobe/s0": placement("wardrobe", 5.0, 0.1, 180), // y 0.1–0.7, zone y 0.7–1.3
        "block/s0": placement("block", 5.0, 1.3), // y 0.7–1.3
      },
    };
    expect(file.version).toBe(4);
    const r = deserialize(JSON.parse(JSON.stringify(file)));
    if (!r.ok) throw new Error(r.error.message);
    const doc = r.value;
    expect(validateDocument(doc).ok).toBe(true);
    expect(clearanceWarnings(doc, "s0")).toEqual([
      { zone: zoneOf("bed/s0", "left"), against: { table: "walls", id: "W4" } },
      { zone: zoneOf("wardrobe/s0", "front"), against: { table: "placements", id: "block/s0" } },
    ]);
    // Zones never touch free floor (layout-states.14): 22.04 − 3.2 − 0.72 − 0.2025 − 0.72 − 0.36.
    const free = [...freeFloor(doc, "s0").values()];
    expect(free).toHaveLength(1);
    expect(free[0]).toBeCloseTo(16.8375, 9);
  });
});
