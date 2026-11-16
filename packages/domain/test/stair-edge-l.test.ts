import { unwrap, type Point } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { distanceToSegment } from "../src/geometry";
import { kindConfigs, stairRuleOf } from "../src/kinds";
import { emptyDocument, type Document, type Placement, sameGuards } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { deckView } from "../src/queries/decks";
import { STAIR_LANDING, stairEdges, stairOnEdge, type StairFlight, type StairParts, type StairRequest } from "../src/queries/stair-edge";
import { stairChecks } from "../src/queries/stair-checks";
import { stairBase, stairGeometry } from "../src/queries/stairs";
import { placementRange } from "../src/queries/vertical";
import { rectangleRoom } from "../src/scripts";
import { STAIR_RULES } from "../src/stairs";
import { validateDocument } from "../src/validate";
import { deepFreeze } from "./helpers";

// The L on a deck's edge (AC-05, AC-08, stairdraw.04, .05, .09, spec "The L"): an upper flight with its back on the
// edge, a solid square landing at its foot and a lower flight turning off the landing's side, placed in one patch.
//
//        LOFT                     seen from above, l-left at x 4.50 on the loft's bottom edge (y 3.71)
//  ══════╤═════╤══════            upper flight: x 4.05–4.95, y 2.352–3.71, 6 risers, starts at the landing
//        │  ▲  │
//  ┌─────┼─────┤                  landing: x 4.05–4.95, y 1.452–2.352, top 1.075
//  │ UP ►│LAND │                  lower flight: x 2.692–4.05, its back on the landing's left edge, 6 risers
//  └─────┴─────┘

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** The sample room of stair-edge.test.ts: inner x 0.47–5.47, y 0.31–5.31, ceiling 3.20, a loft at +2.15 top right. */
const LOFT = "loft/k0";
const room = (top = 2.15): Document =>
  run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 5.2, 5.2, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 4.42, y: 4.51 }, w: 2.1, d: 1.6, top, name: "Loft" },
    { type: "addState", opId: "n", name: "Night" },
  ]);

/** An off-grid 8.0 × 7.0 room (inner x 0.47–8.27, y 0.31–7.11) with a solid 2.00 × 1.40 deck at +1.60 turned 30°. */
const DECK = "deck/k0";
const turnedRoom = (): Document =>
  run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 8, 7, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "deck", preset: "platform", at: { x: 4.3, y: 3.9 }, w: 2, d: 1.4, rotation: 30, top: 1.6, name: "Deck" },
  ]);
/** A point 3 mm outside the turned deck's edge facing 30°, 41% of the way along it: off the grid and off its middle. */
function turnedPoint(doc: Document): Point {
  const edge = stairEdges(doc, null, 0.9).find((e) => e.deck === DECK && e.normal.x > 0.86 && e.normal.y > 0.49);
  if (!edge) throw new Error("no 30° edge");
  const t = 0.4137;
  return { x: edge.a.x + (edge.b.x - edge.a.x) * t + edge.normal.x * 0.003, y: edge.a.y + (edge.b.y - edge.a.y) * t + edge.normal.y * 0.003 };
}

type Asked = Partial<Omit<StairRequest, "at">>;
const ask = (at: Point, extra: Asked = {}): StairRequest => ({ state: "s0", kind: "stair", deck: LOFT, at, shape: "l-left", surface: null, ...extra });
const placeCmd = (opId: string, at: Point, extra: Asked = {}): Command => ({ type: "placeStair", opId, ...ask(at, extra) });
const AT = { x: 4.5, y: 3.71 };

const rad = (deg: number): number => (deg * Math.PI) / 180;
const front = (f: { rotation: number }): Point => ({ x: Math.sin(rad(f.rotation)), y: -Math.cos(rad(f.rotation)) });
const along = (p: Point, v: Point, t: number): Point => ({ x: p.x + v.x * t, y: p.y + v.y * t });
const gap = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);
const flights = (parts: StairParts): [StairFlight, StairFlight] => {
  const [upper, lower] = parts.flights;
  if (!upper || !lower || parts.flights.length !== 2) throw new Error("not an L");
  return [upper, lower];
};
const copies = (doc: Document, object: string): Placement[] => Object.values(doc.placements).filter((p) => p.object === object).sort((a, b) => (a.state < b.state ? -1 : 1));
/** A placed flight's riser count, from where its steps begin (stairBase) to its top. */
const risersOf = (doc: Document, placement: string): number => {
  const p = doc.placements[placement];
  const o = p ? doc.objects[p.object] : undefined;
  const rule = o ? stairRuleOf(o.kind) : null;
  const range = placementRange(doc, placement);
  const base = stairBase(doc, placement);
  if (!p || !o || !rule || !range || base === null) throw new Error("no stair");
  return stairGeometry(rule, o.w[p.config] ?? 0, o.d[p.config] ?? 0, range.top - base, null).risers;
};

describe("stairOnEdge, the L (AC-05)", () => {
  it("an L to the 2.15 loft: upper 6 R, landing top 6 × 2.15/12, lower 6 R; the landing square at the stair's width; reaches and startsAt as specified", () => {
    const parts = unwrap(stairOnEdge(room(), ask(AT)));
    // The going for a riser of 2.15/12 is 0.63 − 2 × 0.1792 = 0.2717; five treads make 1.358.
    expect(parts.flights).toEqual([
      { at: { x: 4.5, y: 3.71 }, rotation: 0, w: 0.9, d: 1.358, h: 2.15, reaches: LOFT, startsAt: STAIR_LANDING, sides: null, leftEntry: false },
      { at: { x: 4.05, y: 1.902 }, rotation: 270, w: 0.9, d: 1.358, h: 1.075, reaches: STAIR_LANDING, startsAt: null, sides: null, leftEntry: false },
    ]);
    expect(parts.landing).toEqual({ at: { x: 4.5, y: 1.902 }, w: 0.9, d: 0.9, rotation: 0, top: 1.075 });
    expect(parts.landing?.top).toBe(Math.round(((6 * 2.15) / 12) * 1000) / 1000);
    const [upper, lower] = flights(parts);
    expect(stairGeometry(STAIR_RULES.solid, upper.w, upper.d, upper.h - 1.075, null).risers).toBe(6);
    expect(stairGeometry(STAIR_RULES.solid, lower.w, lower.d, lower.h, null).risers).toBe(6);
  });

  it("l-left mirrors l-right about the upper flight's axis", () => {
    for (const [doc, at, deck] of [[room(), AT, LOFT], [turnedRoom(), turnedPoint(turnedRoom()), DECK]] as const) {
      const left = unwrap(stairOnEdge(doc, ask(at, { deck, shape: "l-left" })));
      const right = unwrap(stairOnEdge(doc, ask(at, { deck, shape: "l-right" })));
      const [upper, lowerL] = flights(left);
      const [upperR, lowerR] = flights(right);
      expect(upperR).toEqual(upper);
      expect(right.landing).toEqual(left.landing);
      // Reflect the left lower flight's back about the axis through the upper flight's back, along its front.
      const f = front(upper);
      const v = { x: lowerL.at.x - upper.at.x, y: lowerL.at.y - upper.at.y };
      const t = v.x * f.x + v.y * f.y;
      const mirrored = { x: upper.at.x + 2 * t * f.x - v.x, y: upper.at.y + 2 * t * f.y - v.y };
      expect(gap(mirrored, lowerR.at)).toBeLessThanOrEqual(0.0015);
      expect(lowerR.rotation).toBe((((2 * upper.rotation - lowerL.rotation) % 360) + 360) % 360);
      expect({ d: lowerR.d, h: lowerR.h, w: lowerR.w }).toEqual({ d: lowerL.d, h: lowerL.h, w: lowerL.w });
      // Seen from the floor facing the edge, l-left's lower flight is on the left.
      const left90 = { x: f.y, y: -f.x }; // facing the edge (−front), the left is front turned clockwise
      expect((lowerL.at.x - upper.at.x) * left90.x + (lowerL.at.y - upper.at.y) * left90.y).toBeGreaterThan(0.4);
    }
  });

  it("the derived riser count of each flight equals its share of the split", () => {
    let odd = 0;
    for (const kind of ["stair", "openStair", "storageStair"]) {
      const rule = stairRuleOf(kind);
      const w = kindConfigs(kind)[0]?.w ?? 0;
      if (!rule) throw new Error(kind);
      for (let top = 0.6; top <= 3.0; top += 0.037) {
        const doc = room(Math.round(top * 1000) / 1000);
        const rise = doc.decks[LOFT]?.top ?? 0;
        const all = stairGeometry(rule, w, 1, rise, null).risers;
        const parts = stairOnEdge(doc, ask(AT, { kind }));
        if (all < 4) {
          expect({ kind, rise, parts }).toEqual({ kind, rise, parts: { ok: false, error: "tooLowToTurn" } });
          continue;
        }
        if (all % 2 === 1) odd++;
        const [upper, lower] = flights(unwrap(parts));
        const landing = unwrap(parts).landing?.top ?? NaN;
        const n2 = Math.ceil(all / 2);
        expect({ kind, rise, upper: stairGeometry(rule, w, upper.d, upper.h - landing, null).risers, lower: stairGeometry(rule, w, lower.d, lower.h, null).risers }).toEqual({ kind, rise, upper: n2, lower: all - n2 });
      }
    }
    expect(odd).toBeGreaterThan(10);
    // Placed: a rise of 2.30 is 13 risers, 7 up from the landing at 1.062 and 6 up to it.
    const doc = unwrap(execute(room(2.3), placeCmd("ps", AT))).doc;
    expect(doc.decks["ps/k0"]?.top).toBe(1.062);
    expect([risersOf(doc, "ps/s0/p0"), risersOf(doc, "ps/s1/p0")]).toEqual([7, 6]);
  });

  it("on a deck turned 30°, off the grid", () => {
    const doc = turnedRoom();
    for (const shape of ["l-left", "l-right"] as const) {
      const parts = unwrap(stairOnEdge(doc, ask(turnedPoint(doc), { deck: DECK, shape })));
      const [upper, lower] = flights(parts);
      const landing = parts.landing;
      if (!landing) throw new Error("no landing");
      // Square to the edge: the upper flight faces 30°, the landing turns with it, the lower flight at a right angle.
      expect(upper.rotation).toBe(120);
      expect(landing.rotation % 90).toBe(30);
      expect(lower.rotation).toBe(shape === "l-left" ? 30 : 210);
      // Touching, to the millimetre: the landing centred on the upper flight's front, the lower flight's back on its side.
      expect(gap(along(upper.at, front(upper), upper.d + upper.w / 2), landing.at)).toBeLessThanOrEqual(0.001);
      expect(gap(along(lower.at, front(lower), -landing.w / 2), landing.at)).toBeLessThanOrEqual(0.001);
      // Placed, every part passes validation and each flight's back touches the deck it reaches.
      const next = unwrap(execute(doc, placeCmd("ps", turnedPoint(doc), { deck: DECK, shape }))).doc;
      expect(validateDocument(next).ok).toBe(true);
      const ring = deckView(next, "ps/k0")?.ring ?? [];
      const onRing = (p: Point) => Math.min(...ring.map((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length] ?? a)));
      expect(onRing(along(upper.at, front(upper), upper.d))).toBeLessThanOrEqual(0.001);
      expect(onRing(lower.at)).toBeLessThanOrEqual(0.001);
      for (const id of ["ps/s0/o0", "ps/s1/o0"]) expect(stairChecks(next, id).find((c) => c.id === "reach")).toMatchObject({ ok: true });
      expect([risersOf(next, "ps/s0/p0"), risersOf(next, "ps/s1/p0")]).toEqual([5, 4]); // 1.60 is 9 risers
    }
  });

  it("a ship's ladder, an alternating tread, a rung ladder and a spiral are refused doesNotTurn; stair, open and storage turn", () => {
    const doc = room();
    for (const kind of ["shipsLadder", "alternatingTread", "rungLadder", "spiralStair"]) {
      for (const shape of ["l-left", "l-right"] as const) expect(stairOnEdge(doc, ask(AT, { kind, shape }))).toEqual({ ok: false, error: "doesNotTurn" });
      expect(unwrap(stairOnEdge(doc, ask(AT, { kind, shape: "straight" }))).flights).toHaveLength(1);
    }
    for (const kind of ["stair", "openStair", "storageStair"]) expect(unwrap(stairOnEdge(doc, ask(AT, { kind }))).landing).not.toBeNull();
    // placeStair words it with the kind's label.
    expect(execute(doc, placeCmd("ps", AT, { kind: "shipsLadder" }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Ship's ladder doesn't turn" } });
    expect(execute(doc, placeCmd("ps", AT, { kind: "spiralStair", shape: "l-right" }))).toMatchObject({ ok: false, error: { message: "Spiral stair doesn't turn" } });
  });

  it("an L too low for two flights of two risers each is refused tooLowToTurn", () => {
    // A 0.45 platform is 3 risers of a Stair (2 and 1) and 2 of a storage stair (1 and 1).
    const doc = run(room(), [{ type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.6, y: 1.5 }, w: 2, d: 1.4, name: "Platform" }]);
    for (const kind of ["stair", "storageStair"]) expect(stairOnEdge(doc, ask({ x: 2.6, y: 1.5 }, { kind, deck: "plat/k0" }))).toEqual({ ok: false, error: "tooLowToTurn" });
    expect(execute(doc, placeCmd("ps", { x: 2.6, y: 1.5 }, { deck: "plat/k0" }))).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Too low for an L: each flight needs two risers" } });
  });
});

describe("placeStair, the L (AC-05)", () => {
  it("placeStair L is one patch and one undo; both flights are in every layout; the landing is shared", () => {
    const doc = deepFreeze(room());
    const parts = unwrap(stairOnEdge(doc, ask(AT)));
    const [upper, lower] = flights(parts);
    const r = unwrap(execute(doc, placeCmd("ps", AT)));
    expect(r.patch.puts.map((p) => `${p.table}:${p.entity.id}`).sort()).toEqual([
      "decks:ps/k0", "objects:ps/s0/o0", "objects:ps/s1/o0", "placements:ps/s0/o0/n/s0", "placements:ps/s0/p0", "placements:ps/s1/o0/n/s0", "placements:ps/s1/p0",
    ]);
    expect(r.patch.dependencies).toEqual(expect.arrayContaining([{ table: "decks", id: LOFT }, { table: "states", id: "s0" }]));
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
    expect(validateDocument(r.doc).ok).toBe(true);
    // The landing: one deck, every layout's, solid, named Landing.
    expect(r.doc.decks["ps/k0"]).toEqual({ id: "ps/k0", name: "Landing", at: parts.landing?.at, w: 0.9, d: 0.9, rotation: 0, top: 1.075, solid: true, finish: null, ...sameGuards("railing") });
    expect(r.doc.objects["ps/s0/o0"]).toMatchObject({ kind: "stair", reaches: LOFT, startsAt: "ps/k0", h: { standard: 2.15 }, d: { standard: upper.d } });
    expect(r.doc.objects["ps/s1/o0"]).toMatchObject({ kind: "stair", reaches: "ps/k0", startsAt: null, h: { standard: 1.075 }, d: { standard: lower.d } });
    for (const [id, f] of [["ps/s0/o0", upper], ["ps/s1/o0", lower]] as const) {
      expect(copies(r.doc, id).map((p) => ({ state: p.state, at: p.at, rotation: p.rotation, deck: p.deck }))).toEqual([
        { state: "n/s0", at: f.at, rotation: f.rotation, deck: null },
        { state: "s0", at: f.at, rotation: f.rotation, deck: null },
      ]);
    }
    // The upper flight's steps begin at the landing's top; its box still runs from the floor.
    expect(stairBase(r.doc, "ps/s0/p0")).toBe(1.075);
    expect(placementRange(r.doc, "ps/s0/p0")).toEqual({ bottom: 0, top: 2.15 });
    expect([risersOf(r.doc, "ps/s0/p0"), risersOf(r.doc, "ps/s1/p0")]).toEqual([6, 6]);
  });

  it("placeStair L refuses whole when the lower flight hits a wall, and changes nothing", () => {
    const doc = deepFreeze(room());
    // l-right at x 4.50 turns the lower flight toward +x: x 4.95–6.308, past the right wall's face at 5.47.
    const r = execute(doc, placeCmd("ps", AT, { shape: "l-right" }));
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid" } });
    if (!r.ok) expect(r.error.message).toMatch(/^Stair \(0\.00–1\.08\) overlaps a wall/);
    // The same L turned left fits.
    expect(execute(doc, placeCmd("ps", AT)).ok).toBe(true);
  });
});

