import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { convexOverlap } from "../src/geometry";
import { defaultSize, type OrCeiling } from "../src/kinds";
import { CEILING_ID, type Document, type Wall, sameGuards } from "../src/model";
import { footprintFit, placementFit } from "../src/queries/fit";
import { tuckRole } from "../src/queries/tucks";
import { fitShapes, footprintQuad, quadCentre } from "../src/queries/footprints";
import { solids } from "../src/queries/vertical";
import { placedShape } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { docOf, place, rng, withDeck } from "./helpers";

declare const console: { log(message: string): void };

// The collision rule in height (heights.12, AC-05–AC-07, AC-18): footprints overlap and ranges overlap; touching is
// not overlapping; a half wall spans the floor to its top; a top above the ceiling is refused. Loft beds, lift beds and
// wall cabinets are step 06's kinds: here they are a bed and a block given those kinds' heights.

const LOFT = { h: { standard: 0.35 }, z: { standard: 1.45 } }; // 1.45–1.80
const LIFT_UP = { h: { standard: 0.35 }, z: { standard: "ceiling" as const } };
const cabinet = (z: number) => ({ w: { standard: 0.6 }, d: { standard: 0.35 }, h: { standard: 0.75 }, z: { standard: z } });
const withCeiling = (doc: Document, height: number): Document => ({ ...doc, ceilings: { [CEILING_ID]: { id: CEILING_ID, height } } });
const withTop = (doc: Document, wallId: string, top: Wall["top"]): Document => {
  const w = doc.walls[wallId];
  if (!w) throw new Error(`unknown wall ${wallId}`);
  return { ...doc, walls: { ...doc.walls, [wallId]: { ...w, top } } };
};
const invariants = (doc: Document): string[] => {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
};

/**
 * A 6 × 4 room (inner faces 0.1 and 5.9 / 3.9) with a free-standing peninsula P from (1, 2) to (2.5, 2), a 1.10 m half
 * wall closing no room; a loft bed (a 1.00 × 2.10 bed at 1.45–1.80) against the top wall at x 4.4–5.4 in Day.
 */
function studio(): Document {
  let doc = docOf({
    joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["P1", 1, 2], ["P2", 2.5, 2]],
    walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"], ["P", "P1", "P2"]],
  });
  doc = withTop(doc, "P", 1.1);
  doc = place(doc, { object: "loft", kind: "bed", at: [4.9, 3.9], state: "day", size: { w: { standard: 1 }, d: { standard: 2.1 }, ...LOFT } });
  doc = place(doc, { object: "x", kind: "chair", at: [0.5, 0.6], state: "night" }); // Night exists
  return doc;
}

describe("the collision rule in height", () => {
  const doc = studio();
  const under = { state: "day", at: { x: 4.9, y: 3.9 }, rotation: 0, config: "standard" }; // the desk's back on the top wall, under the loft

  it("the studio is valid", () => {
    expect(invariants(doc)).toEqual([]);
  });

  it("desk under loft bed: a default desk (0–0.75) is accepted, a wardrobe (0–2.05) refused; another state never collides (AC-05)", () => {
    expect(placementFit(doc, { surface: null, ...under, kind: "desk" })).toEqual({ fits: true, reason: null });
    expect(execute(doc, { type: "placeObject", deck: null, opId: "d", object: { kind: "desk" }, ...under }).ok).toBe(true);
    expect(placementFit(doc, { surface: null, ...under, kind: "wardrobe" })).toEqual({ fits: false, reason: "object" });
    expect(execute(doc, { type: "placeObject", deck: null, opId: "w", object: { kind: "wardrobe" }, ...under }).ok).toBe(false);
    expect(placementFit(doc, { surface: null, ...under, kind: "wardrobe", state: "night" })).toEqual({ fits: true, reason: null });
  });

  it("touching: a desk raised to exactly 1.45 fits; to 1.4520 it is refused", () => {
    expect(placementFit(doc, { surface: null, ...under, kind: "desk", z: 1.45 })).toEqual({ fits: false, reason: "object" }); // 1.45–2.20 inside the loft's range
    expect(placementFit(doc, { surface: null, ...under, kind: "desk", h: 0.75, z: 0.7 })).toEqual({ fits: true, reason: null }); // top 1.45 touches
    expect(placementFit(doc, { surface: null, ...under, kind: "desk", h: 0.752, z: 0.7 })).toEqual({ fits: false, reason: "object" }); // top 1.452
    expect(placementFit(doc, { surface: null, ...under, kind: "desk", h: 0.6, z: 1.8 })).toEqual({ fits: true, reason: null }); // on top of it, touching
  });

  it("peninsula half wall: a wall cabinet at 1.40 over it is accepted, at 0.90 refused with wall (AC-06)", () => {
    const over = { state: "day", at: { x: 1.75, y: 2.175 }, rotation: 0, config: "standard" }; // y 1.825–2.175 across P
    let d = place(doc, { object: "c", kind: "block", at: [1.75, 2.175], state: "night", size: cabinet(1.4) });
    expect(placementFit(d, { surface: null, ...over, object: "c" })).toEqual({ fits: true, reason: null });
    d = place(doc, { object: "c", kind: "block", at: [1.75, 2.175], state: "night", size: cabinet(0.9) });
    expect(placementFit(d, { surface: null, ...over, object: "c" })).toEqual({ fits: false, reason: "wall" });
    expect(invariants(place(doc, { object: "c", kind: "block", at: [1.75, 2.175], state: "day", size: cabinet(1.4) }))).toEqual([]);
    expect(invariants(place(doc, { object: "c", kind: "block", at: [1.75, 2.175], state: "day", size: cabinet(0.9) }))).toEqual(["I10"]);
  });

  it("over a half wall between two rooms a wall cabinet at 1.40 is refused with room (AC-06)", () => {
    let d = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["M1", 3, 0], ["M2", 3, 4]],
      walls: [["W1", "J1", "M1"], ["W1b", "M1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "M2"], ["W3b", "M2", "J4"], ["W4", "J4", "J1"], ["M", "M1", "M2"]],
    });
    d = withTop(d, "M", 1.1);
    d = place(d, { object: "c", kind: "block", at: [1, 3.9], size: cabinet(1.4) });
    expect(invariants(d)).toEqual([]);
    expect(placementFit(d, { surface: null, object: "c", state: "n", at: { x: 3, y: 2 }, rotation: 0, config: "standard" })).toEqual({ fits: false, reason: "room" });
    const moved = execute(d, { type: "movePlacement", placementId: "c/s0", at: { x: 3, y: 2 }, rotation: 0 });
    expect(moved.ok ? [] : moved.error.violations.map((v) => v.invariant)).toEqual(["I10"]);
  });

  it("over that half wall, a piece with its centre in one room and an end past the wall is refused too", () => {
    let d = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["M1", 3, 0], ["M2", 3, 4]],
      walls: [["W1", "J1", "M1"], ["W1b", "M1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "M2"], ["W3b", "M2", "J4"], ["W4", "J4", "J1"], ["M", "M1", "M2"]],
    });
    d = withTop(d, "M", 1.1); // the wall's body covers x 2.9–3.1
    d = place(d, { object: "c", kind: "block", at: [1, 3.9], size: cabinet(1.4) });
    const fit = (x: number) => placementFit(d, { surface: null, object: "c", state: "n", at: { x, y: 2 }, rotation: 0, config: "standard" });
    const move = (x: number) => execute(d, { type: "movePlacement", placementId: "c/s0", at: { x, y: 2 }, rotation: 0 });

    expect(fit(2.6)).toEqual({ fits: true, reason: null }); // x 2.3–2.9, all in the left room
    expect(move(2.6).ok).toBe(true);
    expect(fit(2.85)).toEqual({ fits: false, reason: "room" }); // x 2.55–3.15: the centre in the left room, the end in the right
    const moved = move(2.85);
    expect(moved.ok ? [] : moved.error.violations.map((v) => v.invariant)).toEqual(["I10"]);
  });

  it("ceiling: a Murphy bed (2.24) under a 2.20 ceiling is refused with ceiling; a lift bed Up at the ceiling is accepted (AC-18)", () => {
    const low = withCeiling(doc, 2.2);
    const murphy = { surface: null, kind: "murphyBed", state: "day", at: { x: 1.5, y: 3.9 }, rotation: 0, config: "folded" };
    expect(placementFit(doc, murphy)).toEqual({ fits: true, reason: null });
    expect(placementFit(low, murphy)).toEqual({ fits: false, reason: "ceiling" });
    expect(execute(low, { type: "placeObject", deck: null, opId: "m", object: { kind: "murphyBed" }, ...murphy }).ok).toBe(false);
    expect(placementFit(low, { surface: null, kind: "bed", state: "day", at: { x: 1.5, y: 3.9 }, rotation: 0, config: "standard", h: 0.35, z: "ceiling" })).toEqual({ fits: true, reason: null });
    expect(placementFit(low, { surface: null, kind: "bed", state: "day", at: { x: 1.5, y: 3.9 }, rotation: 0, config: "standard", h: 0.35, z: 1.9 })).toEqual({ fits: false, reason: "ceiling" });
  });

  it("footprintFit takes the moving piece's heights: the loft itself moved onto the desk's spot keeps clear of a desk", () => {
    const withDesk = place(doc, { object: "desk", kind: "desk", at: [4.9, 3.9], state: "day" }); // under the loft
    const ring = placedShape("bed", { x: 4.9, y: 3.9 }, 1, 2.1, 0);
    expect(footprintFit(withDesk, ring, "day", { h: 0.35, z: 1.45 }, null, ["loft/day"])).toEqual({ fits: true, reason: null });
    expect(footprintFit(withDesk, ring, "day", { h: 1, z: 0 }, null, ["loft/day"])).toEqual({ fits: false, reason: "object" });
  });
});

describe("refusals from any edit (AC-07, AC-18)", () => {
  it("lowering the ceiling under a piece or a half wall is refused", () => {
    const doc = place(studio(), { object: "w", kind: "wardrobe", at: [1.5, 3.9], state: "day" }); // 0–2.05
    expect(invariants(withCeiling(doc, 2.1))).toEqual([]);
    expect(invariants(withCeiling(doc, 2))).toEqual(["I17"]);
    expect(invariants(withCeiling(withTop(doc, "P", 2), 2.1))).toEqual([]);
    expect(invariants(withCeiling(withTop(doc, "P", 2.05), 2.06))).toEqual([]); // a fixed top up to the ceiling (decks.56)
    expect(invariants(withCeiling(withTop(doc, "P", 2.08), 2.06))).toEqual(["I17"]);
  });

  it("lowering the ceiling to 1.00 with a \"ceiling\" lift bed over a table is refused", () => {
    // The peninsula lowered and the loft removed, so only the lift bed and the table meet the low ceilings.
    const base = withTop(studio(), "P", 0.5);
    const objects = Object.fromEntries(Object.entries(base.objects).filter(([id]) => id !== "loft"));
    const placements = Object.fromEntries(Object.entries(base.placements).filter(([id]) => id !== "loft/day"));
    let doc: Document = { ...base, objects, placements };
    doc = place(doc, { object: "lift", kind: "bed", at: [3.5, 3.9], state: "night", size: { w: { standard: 1.6 }, d: { standard: 2 }, ...LIFT_UP } }); // x 2.7–4.3
    doc = place(doc, { object: "t", kind: "desk", at: [3.5, 3.9], state: "night" }); // 0–0.75, under it
    expect(invariants(withCeiling(doc, 2.2))).toEqual([]); // the bed at 1.85–2.20
    expect(invariants(withCeiling(doc, 1.1))).toEqual([]); // at 0.75–1.10: touching
    expect(invariants(withCeiling(doc, 1))).toEqual(["I11"]);
  });
});

// The agreement fuzz (heights.30): placementFit and footprintFit say what execute accepts, with heights, elevations
// at and around the boundaries, "ceiling", a loft bed, a peninsula half wall, a half wall between rooms and a 2.20 m
// ceiling; and, with decks (decks.11), pieces on the floor under and across a platform, a turned platform and a loft
// over the half wall, and pieces standing on each deck, inside, across its edges and off it. Every reason is counted so
// the fuzz cannot pass vacuously.

const ELEVATIONS: readonly OrCeiling[] = [0, 0.75, 0.45 + 0.3, 1.45 + 0.35, 0.7499, 0.7501, "ceiling", 1.45];
const KINDS = ["desk", "wardrobe", "murphyBed", "chair", "bed"] as const;
const FUZZ_DECKS = [
  { id: "plat", name: "Platform", at: [5, 3] as [number, number], w: 1.6, d: 1.4, top: 0.45, solid: true }, // x 4.2–5.8, y 2.3–3.7
  { id: "loft", name: "Loft", at: [4, 1.2] as [number, number], w: 1.6, d: 1.4, top: 2.15, solid: false }, // x 3.2–4.8, y 0.5–1.9
  { id: "turned", name: "Step", at: [2.5, 0.9] as [number, number], w: 1, d: 0.8, rotation: 30, top: 0.3, solid: true, finish: null, ...sameGuards("none") },
];

/**
 * Two rooms split at x = 4 by a 1.10 m half wall, a peninsula in the left one, furniture in Day (the loft over a desk,
 * a table), and every fuzz object parked in Night in a third room far away, so each can be added to Day. With `decks`,
 * three decks: a solid platform (0.45) in the right room with a stool on it in Day, a loft (2.15) over the half wall
 * above the table, and a solid platform (0.30) turned 30° in the left room.
 */
function fuzzDoc(ceiling: number, decks: boolean): { doc: Document; objects: string[] } {
  let doc = docOf({
    joints: [
      ["J1", 0, 0], ["M1", 4, 0], ["J2", 6, 0], ["J3", 6, 4], ["M2", 4, 4], ["J4", 0, 4], ["P1", 1, 2], ["P2", 2.5, 2],
      ["F1", 10, 0], ["F2", 120, 0], ["F3", 120, 4], ["F4", 10, 4],
    ],
    walls: [
      ["W1", "J1", "M1"], ["W1b", "M1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "M2"], ["W3b", "M2", "J4"], ["W4", "J4", "J1"], ["M", "M1", "M2"], ["P", "P1", "P2"],
      ["F1", "F1", "F2"], ["F2", "F2", "F3"], ["F3", "F3", "F4"], ["F4", "F4", "F1"],
    ],
  });
  doc = withTop(withTop(doc, "M", 1.1), "P", 1.1);
  doc = withCeiling(doc, ceiling);
  doc = place(doc, { object: "loft", kind: "bed", at: [1.2, 3.9], state: "day", size: { w: { standard: 1 }, d: { standard: 2.1 }, ...LOFT } });
  doc = place(doc, { object: "desk", kind: "desk", at: [1.2, 3.9], state: "day" });
  doc = place(doc, { object: "table", kind: "desk", at: [5, 0.1], rotation: 180, state: "day" });
  if (decks) {
    for (const deck of FUZZ_DECKS) doc = withDeck(doc, deck);
    doc = place(doc, { object: "stool", kind: "chair", at: [5, 3.7], state: "day", deck: "plat" });
  }
  const objects: string[] = [];
  let x = 11;
  for (const kind of KINDS) {
    for (const [i, z] of ELEVATIONS.entries()) {
      const id = `${kind}${i}`;
      const base = place(doc, { object: id, kind, at: [x, 3.9], state: "night" });
      const object = base.objects[id];
      const config = kind === "murphyBed" ? "folded" : "standard";
      const own = object?.h[config];
      if (!object || own === undefined) throw new Error("no object");
      // The kind's height where the piece stays under the ceiling at this elevation, else 0.35 (parked pieces are valid).
      const h = (z === "ceiling" ? own : z + own) <= ceiling - 0.01 && i % 2 === 0 ? own : 0.35;
      const one = <T,>(v: T): Record<string, T> => (kind === "murphyBed" ? { folded: v, down: v } : { standard: v });
      doc = { ...base, objects: { ...base.objects, [id]: { ...object, h: one(h), z: one(z) } } };
      objects.push(id);
      x += 2.5;
    }
  }
  return { doc, objects };
}

type Tally = { count: (reason: string) => void; disagree: (line: string) => void };
const random2 = (random: () => number): Point => ({ x: Math.round((-0.3 + 6.6 * random()) * 100) / 100, y: Math.round((-0.3 + 4.6 * random()) * 100) / 100 });

/**
 * `draws` places on the floor (half a parked object added to Day, half a new piece of a kind) and 600 moves of the Day
 * pieces, each ignoring itself: placementFit and footprintFit against execute.
 */
function floorStream(doc: Document, objects: readonly string[], ceiling: number, random: () => number, draws: number, t: Tally): void {
  const dayShapes = [...fitShapes(doc)].filter(([id]) => doc.placements[id]?.state === "day").map(([, ring]) => ring);
  const walls = solids(doc).filter((s) => s.key.table === "walls").map((s) => s.ring);
  const flat = (ring: readonly Point[]): boolean => [...dayShapes, ...walls].some((o) => convexOverlap(ring, o));
  for (let n = 0; n < draws; n++) {
    const at = random2(random);
    const rotation = [0, 90, 180, 30][Math.floor(random() * 4)] ?? 0;
    const fresh = random() < 0.5;
    const object = objects[Math.floor(random() * objects.length)] ?? "";
    const kind = fresh ? KINDS[Math.floor(random() * KINDS.length)] ?? "desk" : doc.objects[object]?.kind ?? "";
    const config = kind === "murphyBed" ? "folded" : "standard";
    const who = fresh ? { kind } : { object };
    const fit = placementFit(doc, { surface: null, ...who, state: "day", at, rotation, config });
    const accepted = execute(doc, { type: "placeObject", deck: null, opId: "g", state: "day", object: fresh ? { kind } : { existing: object }, at, rotation, config }).ok;
    if (fit.fits !== accepted) t.disagree(`place ${JSON.stringify(who)} ${ceiling} ${rotation}° (${at.x}, ${at.y}): ${fit.reason}`);
    t.count(String(fit.reason));
    const size = fresh ? defaultSize(kind) : doc.objects[object];
    const ring = placedShape(kind, at, size?.w[config] ?? 0, size?.d[config] ?? 0, rotation);
    if (fit.fits && flat(ring)) t.count("apart");
  }
  for (let n = 0; n < 600; n++) {
    const id = ["loft/day", "desk/day", "table/day"][n % 3] ?? "";
    const p = doc.placements[id];
    const o = p && doc.objects[p.object];
    if (!p || !o) throw new Error("no piece");
    const at = random2(random);
    const rotation = [0, 90, 180, 270][Math.floor(random() * 4)] ?? 0;
    const w = o.w.standard ?? 0;
    const d = o.d.standard ?? 0;
    const h = o.h.standard ?? 0;
    const z = o.z.standard ?? 0;
    const centre = quadCentre(footprintQuad(at, w, d, rotation));
    const tuck = tuckRole({ kind: o.kind, config: p.config, at, rotation, w, d }); // the tuck rule needs the moving piece's role
    const fit = footprintFit(doc, placedShape(o.kind, at, w, d, rotation), "day", { h, z }, p.deck, [id], centre, undefined, tuck);
    const accepted = execute(doc, { type: "movePlacement", placementId: id, at, rotation }).ok;
    if (fit.fits !== accepted) t.disagree(`move ${id} ${ceiling} ${rotation}° (${at.x}, ${at.y}): ${fit.reason}`);
    t.count(`move ${String(fit.reason)}`);
  }
}

/**
 * `draws` parked objects standing on a deck in Day, around it (inside, across its edges, off it): footprintFit on that
 * surface against validating the document with the piece placed there (placeObject takes no surface yet).
 */
function deckStream(doc: Document, objects: readonly string[], ceiling: number, random: () => number, draws: number, t: Tally): void {
  for (let n = 0; n < draws; n++) {
    const deck = FUZZ_DECKS[n % FUZZ_DECKS.length];
    const object = objects[Math.floor(random() * objects.length)] ?? "";
    const o = doc.objects[object];
    if (!deck || !o) throw new Error("no deck or object");
    const config = o.kind === "murphyBed" ? "folded" : "standard";
    const reach = Math.max(deck.w, deck.d) / 2 + 0.4;
    const at = { x: Math.round((deck.at[0] + reach * (2 * random() - 1)) * 100) / 100, y: Math.round((deck.at[1] + reach * (2 * random() - 1)) * 100) / 100 };
    const rotation = [0, 90, 180, 30][Math.floor(random() * 4)] ?? 0;
    const w = o.w[config] ?? 0;
    const d = o.d[config] ?? 0;
    const centre = quadCentre(footprintQuad(at, w, d, rotation));
    const tuck = tuckRole({ kind: o.kind, config, at, rotation, w, d });
    const fit = footprintFit(doc, placedShape(o.kind, at, w, d, rotation), "day", { h: o.h[config] ?? 0, z: o.z[config] ?? 0 }, deck.id, [], centre, undefined, tuck);
    const accepted = validateDocument(place(doc, { object, kind: o.kind, at: [at.x, at.y], rotation, config, state: "day", deck: deck.id })).ok;
    if (fit.fits !== accepted) t.disagree(`on ${deck.id} ${object} ${ceiling} ${rotation}° (${at.x}, ${at.y}): ${fit.reason}`);
    t.count(`on ${String(fit.reason)}`);
    if (o.z[config] === "ceiling") t.count(`on hung ${String(fit.reason)}`); // hung from the ceiling: through its own deck, or on it
  }
}

/** Runs `run` for both ceilings and checks agreement and that every reason in `reasons` occurs at least 20 times. */
function fuzz(label: string, reasons: readonly string[], run: (doc: Document, objects: readonly string[], ceiling: number, t: Tally) => void): void {
  const seen = new Map<string, number>();
  const disagreements: string[] = [];
  const t: Tally = { count: (k) => void seen.set(k, (seen.get(k) ?? 0) + 1), disagree: (line) => void disagreements.push(line) };
  for (const ceiling of [2.5, 2.2]) {
    const { doc, objects } = fuzzDoc(ceiling, label === "decks");
    expect(invariants(doc)).toEqual([]);
    run(doc, objects, ceiling, t);
  }
  console.log(`${label} fuzz reasons: ${JSON.stringify(Object.fromEntries([...seen].sort()))}`);
  expect(disagreements).toEqual([]);
  for (const reason of reasons) expect({ reason, enough: (seen.get(reason) ?? 0) >= 20 }).toEqual({ reason, enough: true });
}

describe("the agreement fuzz with heights", () => {
  it("placementFit and footprintFit agree with execute; every reason occurs at least 20 times", () => {
    const random = rng(20261019);
    fuzz("height", ["wall", "object", "ceiling", "room", "apart", "move object", "move null"], (doc, objects, ceiling, t) => floorStream(doc, objects, ceiling, random, 1500, t));
  });

  it("with decks: placementFit and footprintFit agree with validation on the floor under and across decks and standing on them (decks.11)", () => {
    const random = rng(20261020);
    const reasons = ["wall", "deck", "object", "room", "null", "move deck", "move null", "on null", "on deckCentre", "on deckReach", "on object", "on ceiling", "on deck", "on wall", "on hung deck"];
    fuzz("decks", reasons, (doc, objects, ceiling, t) => {
      floorStream(doc, objects, ceiling, random, 1000, t);
      deckStream(doc, objects, ceiling, random, 1500, t);
    });
  }); // slow under load: the shared 30 s default covers it (snags.20)
});

describe("refusal texts through execute (AC-08)", () => {
  const message = (doc: Document, cmd: Parameters<typeof execute>[1]): string => {
    const r = execute(doc, cmd);
    return r.ok ? "accepted" : r.error.violations.map((v) => v.message).join(" | ");
  };
  const at = { state: "day", at: { x: 4.9, y: 3.9 }, rotation: 0, config: "standard" };

  it("two pieces, a half wall, a full wall and the ceiling, each with its ranges", () => {
    const doc = studio();
    expect(message(doc, { type: "placeObject", deck: null, opId: "w", object: { kind: "wardrobe" }, ...at })).toBe("Bed (1.45–1.80) and Wardrobe (0.00–2.05) overlap in day"); // by placement ID, as I11 always was
    expect(message(doc, { type: "placeObject", deck: null, opId: "w", object: { kind: "wardrobe" }, ...at, at: { x: 1.75, y: 2.3 } })).toBe("Wardrobe (0.00–2.05) overlaps a 1.10 m wall in day");
    expect(message(doc, { type: "placeObject", deck: null, opId: "w", object: { kind: "wardrobe" }, ...at, at: { x: 1, y: 4.2 } })).toBe("Wardrobe (0.00–2.05) overlaps a wall in day");
    const low = withCeiling(doc, 2.2);
    expect(message(low, { type: "placeObject", deck: null, opId: "m", object: { kind: "murphyBed" }, ...at, at: { x: 1.5, y: 3.9 }, config: "folded" })).toBe("Murphy bed (Closed) reaches 2.24 m in day; the ceiling is 2.20 m");
    const r = validateDocument(withCeiling(doc, 1.05));
    expect(r.ok ? [] : r.error.map((v) => v.message)).toContain("A wall can't be taller than the 1.05 m ceiling");
  });
});

describe("the lift bed (AC-18, heights.25)", () => {
  // The room's top wall face at y 3.9; the bed's back on it: y 1.8–3.9, x 2.15–3.85. A desk under its middle.
  let doc = place(docOf({
    joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4]],
    walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
  }), { object: "t", kind: "desk", at: [3, 3.9], state: "day" });
  doc = place(doc, { object: "x", kind: "chair", at: [0.5, 0.6], state: "night" });
  const lift = (state: string, config: string) => ({ surface: null, kind: "liftBed", state, at: { x: 3, y: 3.9 }, rotation: 0, config });

  it("Up over the table is accepted, Down over it refused; Down at Night, where the table is not, accepted", () => {
    expect(placementFit(doc, lift("day", "up"))).toEqual({ fits: true, reason: null });
    expect(placementFit(doc, lift("day", "down"))).toEqual({ fits: false, reason: "object" });
    expect(placementFit(doc, lift("night", "down"))).toEqual({ fits: true, reason: null });
    const placed = execute(doc, { type: "placeObject", deck: null, opId: "l", object: { kind: "liftBed" }, ...lift("day", "up") });
    expect(placed.ok).toBe(true);
  });
});
