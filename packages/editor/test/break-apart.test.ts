import { describe, expect, it } from "vitest";
import { CHAIR_SIZE, add, execute, placedShape, rotateAbout, type Command, type Document, type NewPiece, type ObjectOptions } from "@fm/domain";
import { unwrap, type Point } from "@fm/protocol";
import { brokenApart } from "../src/break-apart";
import { aggregateLayout } from "../src/view/aggregate";
import { clearRoomDoc, withCommands } from "./builders";

// Break apart (seated.02, .10, AC-07 to AC-09, AC-15, AC-16): the pieces are computed here and checked by the domain.

const NIGHT = "n/s0";
const room = (): Document => clearRoomDoc(10, 8, "r");

const set = (doc: Document, kind: string, preset: string, at: Point, rotation = 0, more: Partial<Extract<Command, { type: "placeObject" }>> = {}): Document =>
  withCommands(doc, { type: "placeObject", linked: false, deck: null, opId: "set", state: "s0", object: { kind, preset }, at, rotation, ...more });

const inNight = (doc: Document, at: Point, rotation = 0): Document =>
  withCommands(doc, { type: "addState", opId: "n", name: "Night" }, { type: "placeObject", linked: false, deck: null, opId: "set2", state: NIGHT, object: { existing: "set/o0" }, at, rotation });

const options = (doc: Document, on: ObjectOptions): Document =>
  Object.keys(on).reduce((d, o) => withCommands(d, { type: "setOption", objectId: "set/o0", option: o === "computer" ? "computer" : "roundChairs", on: true }), doc);

const broken = (doc: Document, id = "set/o0"): { pieces: NewPiece[]; run: ReturnType<typeof execute> } => {
  const b = brokenApart(doc, id);
  if (!b.ok) throw new Error(b.error);
  return { pieces: b.value.pieces, run: execute(doc, { type: "placePieces", opId: "b", ...b.value }) };
};

const after = (doc: Document): Document => unwrap(broken(doc).run).doc;

/** A world ring's points, in a stable order, to the millimetre. */
const mm = (ring: readonly Point[]): string[] => ring.map((p) => `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`).sort();

/** The world rectangle of the set's chair or table parts, as the set draws them in one placement. */
function drawnChairs(doc: Document, state: string): string[][] {
  const o = doc.objects["set/o0"];
  const p = Object.values(doc.placements).find((q) => q.object === "set/o0" && q.state === state);
  if (!o || !p) throw new Error("no set");
  const l = aggregateLayout(o.kind, o.w.standard ?? 0, o.d.standard ?? 0);
  return (l?.chairs ?? []).map((c) => {
    const at = rotateAbout(add(c.at, p.at), p.at, p.rotation);
    return mm(placedShape("chair", at, CHAIR_SIZE.w, CHAIR_SIZE.d, p.rotation + c.rotation));
  }).sort();
}

function drawnTable(doc: Document, state: string): string[] {
  const o = doc.objects["set/o0"];
  const p = Object.values(doc.placements).find((q) => q.object === "set/o0" && q.state === state);
  if (!o || !p) throw new Error("no set");
  const l = aggregateLayout(o.kind, o.w.standard ?? 0, o.d.standard ?? 0);
  return mm((l?.table ?? []).map((q) => rotateAbout(add(q, p.at), p.at, p.rotation)));
}

/** A state's new pieces as world rings: chairs, and the one table. */
function pieces(doc: Document, state: string): { chairs: string[][]; table: string[]; kinds: string[] } {
  const here = Object.values(doc.placements).filter((p) => p.state === state);
  const ring = (id: string): string[] => {
    const p = here.find((q) => q.object === id);
    const o = doc.objects[id];
    if (!p || !o) throw new Error("no piece");
    return mm(placedShape(o.kind, p.at, o.w[p.config] ?? 0, o.d[p.config] ?? 0, p.rotation));
  };
  const ids = here.map((p) => p.object);
  const chairs = ids.filter((id) => doc.objects[id]?.kind === "chair");
  const others = ids.filter((id) => doc.objects[id]?.kind !== "chair");
  return { chairs: chairs.map(ring).sort(), table: others[0] === undefined ? [] : ring(others[0]), kinds: ids.map((id) => doc.objects[id]?.kind ?? "").sort() };
}

describe("brokenApart", () => {
  it("refuses in plain words a piece that isn't a set, and an unknown one", () => {
    const doc = withCommands(room(), { type: "placeObject", linked: false, deck: null, opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 5, y: 5 } });
    expect(brokenApart(doc, "sofa/o0")).toEqual({ ok: false, error: "Only a table or desk with chairs breaks apart" });
    expect(brokenApart(doc, "nope")).toEqual({ ok: false, error: "Only a table or desk with chairs breaks apart" });
  });

  it("a 6-seat set in two layouts gives one table and six chairs, placed in both, each to the millimetre where the set drew it (AC-07)", () => {
    const doc = inNight(set(room(), "seatedDining", "6 seats", { x: 3, y: 4 }), { x: 6, y: 6 }, 30);
    const next = after(doc);
    expect(next.objects["set/o0"]).toBeUndefined();
    expect(Object.keys(next.objects)).toHaveLength(7);
    expect(Object.keys(next.placements)).toHaveLength(14);
    for (const state of ["s0", NIGHT]) {
      const got = pieces(next, state);
      expect(got.kinds.filter((k) => k === "chair"), state).toHaveLength(6);
      expect(got.chairs, state).toEqual(drawnChairs(doc, state));
      expect(got.table, state).toEqual(drawnTable(doc, state));
    }
  });

  it("is one patch: its inverse restores the set in both layouts (AC-07)", async () => {
    const { applyPatch, invertPatch } = await import("@fm/domain");
    const doc = inNight(set(room(), "seatedDining", "6 seats", { x: 3, y: 4 }), { x: 6, y: 6 }, 30);
    const { doc: next, patch } = unwrap(broken(doc).run);
    expect(unwrap(applyPatch(next, invertPatch(patch)))).toEqual(doc);
  });

  it.each([[0], [90], [180], [270], [30], [45]])("a round set turned %s° breaks where it stood, at the kind's table (AC-08)", (rotation) => {
    const doc = set(room(), "seatedRound", "8 seats", { x: 5, y: 5 }, rotation);
    const next = after(doc);
    const got = pieces(next, "s0");
    expect(got.kinds).toEqual(["chair", "chair", "chair", "chair", "chair", "chair", "chair", "chair", "roundTable"]);
    expect(got.chairs).toEqual(drawnChairs(doc, "s0"));
    expect(got.table).toEqual(drawnTable(doc, "s0"));
  });

  it("a desk with chair keeps its computer on the desk, and its chair stands where it did (AC-08)", () => {
    const doc = options(set(room(), "deskSet", "120", { x: 5, y: 5 }), { computer: true });
    const next = after(doc);
    const desk = Object.values(next.objects).find((o) => o.kind === "desk");
    expect(desk?.options).toEqual({ computer: true });
    expect(Object.values(next.objects).find((o) => o.kind === "chair")?.options).toBeUndefined();
    expect(pieces(next, "s0").chairs).toEqual(drawnChairs(doc, "s0"));
    expect(pieces(next, "s0").table).toEqual(drawnTable(doc, "s0"));
  });

  it.each([["seatedDining", "4 seats"], ["seatedDining", "6 seats"], ["seatedDining", "8 seats"], ["seatedDining", "10 seats"], ["seatedRound", "4 seats"], ["seatedRound", "6 seats"], ["seatedRound", "8 seats"], ["deskSet", "120"]])("%s at %s: its chairs stand where the set drew them, and it's valid (AC-08)", (kind, preset) => {
    const doc = set(room(), kind, preset, { x: 5, y: 5 });
    const next = after(doc);
    const got = pieces(next, "s0");
    expect(got.chairs).toEqual(drawnChairs(doc, "s0"));
    expect(got.table).toEqual(drawnTable(doc, "s0"));
  });

  it("a set flush against a wall, at an odd size, breaks without a part poking through it", () => {
    // Inner faces at 0.1: the set's back flush at y 8.1, its left end at x 0.1, 2.605 m wide.
    const size = { w: { standard: 2.605 }, d: { standard: 2.1 }, h: { standard: 0.9 }, z: { standard: 0 } };
    const placed = withCommands(room(), { type: "placeObject", linked: false, deck: null, opId: "set", state: "s0", object: { kind: "seatedDining", size: { w: 2.605, d: 2.1 } }, at: { x: 0.1 + 2.605 / 2, y: 8.1 } });
    expect(placed.objects["set/o0"]).toMatchObject({ w: size.w, d: size.d });
    expect(broken(placed).run.ok).toBe(true);
  });

  it("on a deck the pieces stay on it (AC-09)", () => {
    const decked = withCommands(room(), { type: "addDeck", opId: "d", preset: "platform", at: { x: 5, y: 4 }, w: 4, d: 4 });
    const deck = Object.keys(decked.decks)[0] ?? "";
    const next = after(set(decked, "seatedDining", "6 seats", { x: 5, y: 5 }, 0, { deck }));
    expect(Object.values(next.placements).filter((p) => p.state === "s0").map((p) => p.deck)).toEqual(Array.from({ length: 7 }, () => deck));
  });

  it("a set lowered to fit under a low loft stays valid: no part is taller than the set (AC-09)", () => {
    // A hollow deck over it, its underside at 0.70: a 0.75 table or a 0.90 chair would hit it.
    const under = withCommands(
      room(),
      { type: "placeObject", linked: false, deck: null, opId: "set", state: "s0", object: { kind: "seatedDining", preset: "6 seats", size: { w: 2.6, d: 2.1, h: 0.7 } }, at: { x: 5, y: 5 } },
      { type: "addDeck", opId: "d", preset: "loft", at: { x: 5, y: 4 }, w: 4, d: 4, top: 0.82 },
    );
    const next = after(under);
    for (const o of Object.values(next.objects)) expect(o.h[Object.keys(o.h)[0] ?? ""], o.kind).toBeLessThanOrEqual(0.7);
  });

  it("round chairs stay round, square stay square (AC-15)", () => {
    const square = after(set(room(), "seatedDining", "6 seats", { x: 3, y: 4 }));
    expect(Object.values(square.objects).filter((o) => o.kind === "chair").map((o) => o.options)).toEqual(Array.from({ length: 6 }, () => undefined));
    const round = after(options(set(room(), "seatedDining", "6 seats", { x: 3, y: 4 }), { roundChairs: true }));
    expect(Object.values(round.objects).filter((o) => o.kind === "chair").map((o) => o.options)).toEqual(Array.from({ length: 6 }, () => ({ roundChairs: true })));
  });

  it("a dining table is an extending table turned a quarter: width 0.90, closed 1.40, extended 1.86, which opens along its length (AC-16)", () => {
    const doc = set(room(), "seatedDining", "6 seats", { x: 3, y: 4 });
    const next = after(doc);
    const table = Object.values(next.objects).find((o) => o.kind === "extendingTable");
    expect(table?.w).toEqual({ closed: expect.closeTo(0.9, 9), extended: expect.closeTo(0.9, 9) });
    expect(table?.d).toEqual({ closed: expect.closeTo(1.4, 9), extended: expect.closeTo(1.86, 9) });
    const placed = Object.values(next.placements).find((p) => p.object === table?.id);
    expect(placed?.config).toBe("closed");
    expect(placed?.rotation).toBe(90);
    // Without its end chair on that side, Extended grows the table along x, its length, and keeps its width across y.
    const ring = (d: Document, id: string): Point[] => {
      const o = d.objects[id];
      const p = Object.values(d.placements).find((q) => q.object === id);
      if (!o || !p) throw new Error("no piece");
      return placedShape(o.kind, p.at, o.w[p.config] ?? 0, o.d[p.config] ?? 0, p.rotation);
    };
    const end = Object.values(next.placements).filter((p) => next.objects[p.object]?.kind === "chair").reduce((best, p) => (p.at.x > (best?.at.x ?? -Infinity) ? p : best));
    const open = withCommands(next, { type: "removePlacement", placementId: end.id }, { type: "setConfiguration", placementId: placed?.id ?? "", config: "extended" });
    const span = (r: Point[], a: "x" | "y") => Math.max(...r.map((q) => q[a])) - Math.min(...r.map((q) => q[a]));
    expect(span(ring(open, table?.id ?? ""), "x")).toBeCloseTo(1.86, 9);
    expect(span(ring(open, table?.id ?? ""), "y")).toBeCloseTo(0.9, 9);
  });

  it("a set too small for chairs breaks into its bare table alone", () => {
    const small = withCommands(room(), { type: "placeObject", linked: false, deck: null, opId: "set", state: "s0", object: { kind: "seatedDining", size: { w: 1.2, d: 1 } }, at: { x: 5, y: 5 } });
    const next = after(small);
    expect(Object.values(next.objects).map((o) => o.kind)).toEqual(["extendingTable"]);
  });
});
