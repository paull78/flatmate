import { describe, expect, it } from "vitest";
import type { InvariantId } from "../src/errors";
import { emptyDocument, type Document, sameGuards } from "../src/model";
import { nullZones } from "../src/use-zone";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc, withOpening } from "./helpers";

const bedSides = { front: false, back: false, left: true, right: true };

function invariants(doc: Document): InvariantId[] {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
}

describe("validateDocument", () => {
  it("accepts an empty document and a closed room", () => {
    expect(invariants(emptyDocument())).toEqual([]);
    expect(invariants(rectDoc(0, 0, 6, 4))).toEqual([]);
  });

  it("I1: walls need two existing, distinct joints", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "Z"]] }))).toContain("I1");
    expect(invariants(docOf({ joints: [["A", 0, 0]], walls: [["W", "A", "A"]] }))).toContain("I1");
  });

  it("I2: walls are at least 1 cm long", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.009, 0]], walls: [["W", "A", "B"]] }))).toEqual(["I2"]);
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 0.01, 0]], walls: [["W", "A", "B"]] }))).toEqual([]);
  });

  it("I13: a wall's thickness is between 0.05 and 0.50 m (layout-states.27)", () => {
    const wall = (t: number) => docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B", t]] });
    expect(invariants(wall(0.04))).toEqual(["I13"]);
    expect(invariants(wall(0.51))).toEqual(["I13"]);
    expect(invariants(wall(Number.NaN))).toEqual(["I13"]);
    expect(invariants(wall(0.05))).toEqual([]);
    expect(invariants(wall(0.5))).toEqual([]);
    const r = validateDocument(wall(0.04));
    expect(r.ok ? [] : r.error.map((v) => v.message)).toEqual(["Wall W thickness 0.04 m is outside 0.05 to 0.50 m"]);
    expect(r.ok ? [] : r.error[0]?.entities).toEqual([{ table: "walls", id: "W" }]);
  });

  it("I17: the ceiling is 1 to 10 m under its one id; a half wall is 0.10 m or more and lower than the ceiling (AC-02)", () => {
    const ceiling = (height: number, id = "ceiling"): Document => ({ ...rectDoc(0, 0, 6, 4), ceilings: { [id]: { id, height } } });
    const half = (top: number, doc: Document = rectDoc(0, 0, 6, 4)): Document => {
      const w = doc.walls.W1;
      if (!w) throw new Error("no W1");
      return { ...doc, walls: { ...doc.walls, W1: { ...w, top } } };
    };
    expect(invariants(ceiling(0.9))).toEqual(["I17"]);
    expect(invariants(ceiling(10.5))).toEqual(["I17"]);
    expect(invariants(ceiling(1))).toEqual([]);
    expect(invariants(ceiling(10))).toEqual([]);
    expect(invariants(ceiling(2.5, "roof"))).toEqual(["I17"]);
    expect(invariants(half(2.5))).toEqual([]); // a fixed top at the ceiling: "To ceiling" switched off keeps the height
    expect(invariants(half(2.5009))).toEqual([]); // within the tolerance
    expect(invariants(half(2.502))).toEqual(["I17"]);
    expect(invariants(half(2.49))).toEqual([]);
    expect(invariants(half(0.05))).toEqual(["I17"]);
    expect(invariants(half(0.1))).toEqual([]);
    expect(invariants(half(2.21, ceiling(2.2)))).toEqual(["I17"]);
    expect(invariants(half(2.2, ceiling(2.2)))).toEqual([]);
    const r = validateDocument(half(2.6));
    expect(r.ok ? [] : r.error.map((v) => [v.message, v.entities])).toEqual([["A wall can't be taller than the 2.50 m ceiling", [{ table: "walls", id: "W1" }]]]);
    const c = validateDocument(ceiling(0.9));
    expect(c.ok ? [] : c.error.map((v) => [v.message, v.entities])).toEqual([["The ceiling must be between 1.00 and 10 m", [{ table: "ceilings", id: "ceiling" }]]]);
  });

  it("I9: placements reference an existing object and state, once per pair, with a configuration of the object's kind; every object is placed; a state exists (layout-states.39)", () => {
    const base = (): Document => {
      const doc = rectDoc(0, 0, 6, 4);
      doc.states.n = { id: "n", name: "Night", order: 1 };
      doc.objects.o = { id: "o", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } };
      doc.placements.p = { id: "p", object: "o", state: "s0", at: { x: 2, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck: null };
      return doc;
    };
    expect(invariants(base())).toEqual([]);
    const cases: [string, (d: Document) => void][] = [
      ["a missing object", (d) => { d.placements.q = { id: "q", object: "nope", state: "s0", at: { x: 4, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck: null }; }],
      ["a missing state", (d) => { d.placements.q = { id: "q", object: "o", state: "nope", at: { x: 4, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck: null }; }],
      ["a duplicate (object, state) pair", (d) => { d.placements.q = { id: "q", object: "o", state: "s0", at: { x: 4, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck: null }; }],
      ["a configuration of another kind", (d) => { const p = d.placements.p; if (p) d.placements.p = { ...p, config: "down" }; }],
      ["an object without placements", (d) => { d.objects.u = { id: "u", kind: "chair", name: "Chair", w: { standard: 0.45 }, d: { standard: 0.45 }, h: { standard: 0.9 }, z: { standard: 0 } }; }],
      ["no state at all", (d) => { d.states = {}; d.placements = {}; d.objects = {}; }],
    ];
    for (const [what, change] of cases) {
      const doc = base();
      change(doc);
      expect(invariants(doc), what).toEqual(["I9"]);
    }
    const r = validateDocument((() => { const d = base(); d.placements.q = { id: "q", object: "o", state: "s0", at: { x: 4, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck: null }; return d; })());
    expect(r.ok ? [] : r.error.map((v) => v.entities)).toEqual([[{ table: "placements", id: "p" }, { table: "placements", id: "q" }]]);
  });

  it("I8 covers the layout tables: a bad ID, a key that differs from the ID, a name too long, a rotation of 400", () => {
    const doc = (change: (d: Document) => void): Document => { const d = rectDoc(0, 0, 6, 4); change(d); return d; };
    expect(invariants(doc((d) => { d.states["bad id"] = { id: "bad id", name: "x", order: 1 }; }))).toEqual(["I8"]);
    expect(invariants(doc((d) => { d.states.k = { id: "other", name: "x", order: 1 }; }))).toEqual(["I8"]);
    expect(invariants(doc((d) => { d.states.k = { id: "k", name: "x".repeat(201), order: 1 }; }))).toEqual(["I8"]);
    expect(invariants(doc((d) => {
      d.objects.o = { id: "o", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } };
      d.placements.p = { id: "p", object: "o", state: "s0", at: { x: 2, y: 2 }, rotation: 400, config: "standard", sides: bedSides, zones: nullZones(), deck: null };
    }))).toEqual(["I8"]);
    expect(invariants(doc((d) => {
      d.objects.o = { id: "o", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } };
      d.placements.p = { id: "p", object: "o", state: "s0", at: { x: 2, y: 2 }, rotation: 0, config: "standard", sides: bedSides, zones: { ...nullZones(), leftDepth: 0.4 }, deck: null };
    }))).toEqual(["I8"]); // a side with a depth but no ends (furnish.21)
    expect(invariants(doc((d) => { d.openings.x = { id: "x", wall: "W1", kind: "swing", offset: Number.NaN, width: 0.8, side: "left", hinge: "a", glazed: false, sill: 0, head: 2.1 }; }))).toEqual(["I8"]);
  });

  it("I3: every joint is used", () => {
    expect(invariants(docOf({ joints: [["A", 0, 0], ["B", 1, 0], ["C", 5, 5]], walls: [["W", "A", "B"]] }))).toEqual(["I3"]);
  });

  it("I4: joints are at least 1 mm apart", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 1, 0], ["C", 1.0005, 0], ["D", 1.0005, 1]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toContain("I4");
  });

  it("I5: walls cross only at a shared joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 4], ["C", 0, 4], ["D", 4, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(doc)).toEqual(["I5"]);
  });

  it("I6: no joint lies on another wall's body", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 6, 0], ["T", 3, 0], ["U", 3, 4]],
      walls: [["W1", "A", "B"], ["W2", "T", "U"]],
    });
    expect(invariants(doc)).toContain("I6");
  });

  it("I7: walls do not overlap collinearly", () => {
    const partial = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 2, 0.0], ["D", 6, 0]],
      walls: [["W1", "A", "B"], ["W2", "C", "D"]],
    });
    expect(invariants(partial)).toContain("I7");
    const duplicate = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W1", "A", "B"], ["W2", "B", "A"]] });
    expect(invariants(duplicate)).toEqual(["I7"]);
  });

  it("I8: malformed IDs and non-finite numbers", () => {
    const badId = docOf({ joints: [["bad id", 0, 0], ["B", 1, 0]], walls: [["W", "bad id", "B"]] });
    expect(invariants(badId)).toEqual(["I8"]);
    const nan = docOf({ joints: [["A", Number.NaN, 0], ["B", 1, 0]], walls: [["W", "A", "B"]] });
    expect(invariants(nan)).toEqual(["I8"]);
    const inf = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"]], labels: [["L", Infinity, 0, "x"]] });
    expect(invariants(inf)).toEqual(["I8"]);
    const keyMismatch: Document = { ...emptyDocument(), joints: { A: { id: "Z", x: 0, y: 0 } }, walls: {}, zoneLabels: {} };
    expect(invariants(keyMismatch)).toEqual(["I8"]);
    const inherited = docOf({ joints: [["A", 0, 0], ["B", 1, 0]], walls: [["W", "A", "B"], ["V", "A", "constructor"]] });
    expect(invariants(inherited)).toEqual(["I8"]);
  });

  it("I8 refuses a stored label with a bad finish, naming the field (finishes.17)", () => {
    const finish = { motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 };
    const labelled = (f: typeof finish | null): Document => ({ ...rectDoc(0, 0, 6, 4), zoneLabels: { L1: { id: "L1", at: { x: 1, y: 1 }, name: "Hall", finish: f } } });
    expect(invariants(labelled(finish))).toEqual([]);
    expect(invariants(labelled(null))).toEqual([]);
    const r = validateDocument(labelled({ ...finish, size: 0.5 }));
    expect(r).toMatchObject({ ok: false, error: [{ invariant: "I8", message: "zoneLabels L1: finish.size must be 0.10–0.40", entities: [{ table: "zoneLabels", id: "L1" }] }] });
    expect(validateDocument(labelled({ ...finish, motif: "parquet" }))).toMatchObject({ ok: false, error: [{ message: expect.stringMatching(/^zoneLabels L1: finish\.motif must be/) }] });
    expect(validateDocument(labelled({ ...finish, colour: "#C8A27A" }))).toMatchObject({ ok: false, error: [{ message: "zoneLabels L1: finish.colour must be #rrggbb" }] });
  });

  it("accepts a T-junction whose stem ends at a split joint", () => {
    const doc = docOf({
      joints: [["A", 0, 0], ["S", 3, 0], ["B", 6, 0], ["T", 3, 4]],
      walls: [["W1", "A", "S"], ["W2", "S", "B"], ["W3", "S", "T"]],
    });
    expect(invariants(doc)).toEqual([]);
  });
});

describe("I12: openings lie within their wall, apart from each other (spec: openings)", () => {
  const ids = (doc: Document): string[] => {
    const r = validateDocument(doc);
    return r.ok ? [] : r.error.map((v) => `${v.invariant} ${v.entities.map((e) => e.id).join(",")}`);
  };
  it("an opening past the wall's end, two overlapping doors on one wall and a missing wall are violations; touching doors pass", () => {
    const room = rectDoc(0, 0, 6, 4);
    expect(ids(withOpening(room, { id: "d", wall: "W1", offset: 5.3 }))).toEqual(["I12 d,W1"]);
    expect(ids(withOpening(room, { id: "d", wall: "W1", offset: -0.1 }))).toEqual(["I12 d,W1"]);
    expect(ids(withOpening(withOpening(room, { id: "d1", wall: "W1", offset: 1 }), { id: "d2", wall: "W1", offset: 1.5 }))).toEqual(["I12 d1,d2"]);
    expect(ids(withOpening(room, { id: "d", wall: "W9", offset: 1 }))).toEqual(["I12 d"]);
    expect(ids(withOpening(withOpening(room, { id: "d1", wall: "W1", offset: 1 }), { id: "d2", wall: "W1", offset: 1.8 }))).toEqual([]);
    expect(ids(withOpening(withOpening(room, { id: "d1", wall: "W1", offset: 1 }), { id: "d2", wall: "W2", offset: 1 }))).toEqual([]);
  });
});

// Decks (decks.15; spec "The landing rule"): I9 catches a placement whose surface names no deck, so fit never runs on
// a dangling surface.
describe("I9 for decks", () => {
  const bed = { id: "o", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } };
  const platform = { id: "stage/k0", name: "Platform", at: { x: 3, y: 2 }, w: 2, d: 2, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
  const base = (deck: string | null): Document => {
    const doc = rectDoc(0, 0, 6, 4);
    doc.objects.o = bed;
    doc.placements.p = { id: "p", object: "o", state: "s0", at: { x: 3, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck };
    doc.decks[platform.id] = platform;
    return doc;
  };

  it("a placement on a missing deck is an I9 violation", () => {
    expect(invariants(base(null))).toEqual(["I10"]); // on the floor through the platform: a piece–deck collision
    expect(invariants(base("stage/k0"))).toEqual([]);
    const r = validateDocument(base("gone/k0"));
    expect(r.ok ? [] : r.error.map((v) => [v.invariant, v.entities])).toEqual([["I9", [{ table: "placements", id: "p" }]]]);
  });

  it("fit is skipped then", () => {
    // A second piece over the first, both on one surface: on the platform an I11, but on a missing deck only the I9 is
    // reported.
    const overlapping = (deck: string | null): Document => {
      const doc = base(deck);
      doc.objects.q = { ...bed, id: "q" };
      doc.placements.q = { id: "q", object: "q", state: "s0", at: { x: 3.2, y: 3 }, rotation: 0, config: "standard", sides: bedSides, zones: nullZones(), deck };
      return doc;
    };
    expect(invariants(overlapping("stage/k0"))).toEqual(["I11"]);
    expect(invariants(overlapping("gone/k0"))).toEqual(["I9"]);
  });
});
