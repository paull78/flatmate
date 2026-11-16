import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { rotateAbout } from "../src/geometry";
import { emptyDocument, type Document } from "../src/model";
import type { Command } from "../src/commands/types";
import { rectangleRoom } from "../src/scripts";
import { FOLD_DEPTH, clearanceWarnings, swingZone } from "../src/queries/clearance";
import { freeFloor } from "../src/queries/free-floor";
import { placementRoom } from "../src/queries/footprints";
import { zoneOfLabel, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { A, BED_160x200, C, docOf, loops, place, rectDoc, withOpening } from "./helpers";
import { OPENING_KINDS, OPENING_KIND_IDS } from "../src/kinds";

function invariants(doc: Document): string[] {
  const r = validateDocument(doc);
  return r.ok ? [] : [...new Set(r.error.map((v) => v.invariant))].sort();
}

/** A 6 × 5 room rotated 30° about the origin: every wall runs at 30° or 120°. */
function tiltedRoom(): Document {
  const c = (x: number, y: number): [number, number] => { const p = rotateAbout({ x, y }, { x: 0, y: 0 }, 30); return [p.x, p.y]; };
  return docOf({
    joints: [["A", ...c(0, 0)], ["B", ...c(6, 0)], ["C", ...c(6, 5)], ["D", ...c(0, 5)]],
    walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"], ["W4", "D", "A"]],
  });
}

describe("I10: a placement lies inside one room and off every wall body (spec: layouts)", () => {
  it("a bed 5 cm into the bottom wall is a violation naming the placement and the wall; 5 cm clear is fine", () => {
    // Inner face of the bottom wall at y = 0.1; the bed is 2 m deep and anchored at its back edge.
    const into = place(rectDoc(0, 0, 4, 5), { object: "b", kind: "bed", at: [2, 2.05], size: BED_160x200 });
    expect(invariants(into)).toEqual(["I10"]);
    const r = validateDocument(into);
    expect(r.ok ? [] : r.error.map((v) => v.entities)).toEqual([[{ table: "placements", id: "b/s0" }, { table: "walls", id: "W1" }]]);
    expect(invariants(place(rectDoc(0, 0, 4, 5), { object: "b", kind: "bed", at: [2, 2.15], size: BED_160x200 }))).toEqual([]);
  });

  it("a bed parallel to a 30° wall and 5 cm clear of it is accepted; moved 5 cm into it, refused (AC-14)", () => {
    const at = (y: number): [number, number] => { const p = rotateAbout({ x: 3, y }, { x: 0, y: 0 }, 30); return [p.x, p.y]; };
    expect(invariants(place(tiltedRoom(), { object: "b", kind: "bed", at: at(2.15), rotation: 30, size: BED_160x200 }))).toEqual([]);
    expect(invariants(place(tiltedRoom(), { object: "b", kind: "bed", at: at(2.05), rotation: 30, size: BED_160x200 }))).toEqual(["I10"]);
  });

  it("a bed outside every room, or straddling a divider, is a violation", () => {
    expect(invariants(place(rectDoc(0, 0, 4, 5), { object: "b", kind: "bed", at: [10, 10], size: BED_160x200 }))).toEqual(["I10"]);
    const divided = unwrap(execute(rectDoc(0, 0, 6, 5), { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 5 } } })).doc;
    expect(invariants(place(divided, { object: "b", kind: "bed", at: [3, 3.5], size: BED_160x200 }))).toEqual(["I10"]);
    expect(invariants(place(divided, { object: "b", kind: "bed", at: [1.5, 3.5], size: BED_160x200 }))).toEqual([]);
  });

  it("a placement in a room whose clear area is unavailable still counts as inside a room (layout-states.15)", () => {
    // A room with an arm only 0.15 m wide between wall centre lines: its inset fails, but its ring stands.
    const doc = docOf({
      joints: [["A", 0, 0], ["B", 4, 0], ["C", 4, 4], ["D", 0.15, 4], ["E", 0.15, 8], ["F", 0, 8]],
      walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"], ["W4", "D", "E"], ["W5", "E", "F"], ["W6", "F", "A"]],
    });
    expect(zones(doc)[0]?.area).toBeNull();
    expect(invariants(place(doc, { object: "c", kind: "chair", at: [2, 2.225] }))).toEqual([]);
  });
});

describe("I11: two placements in one state do not overlap", () => {
  it("overlapping in one state is a violation; in different states fine; touching edges fine", () => {
    const two = (state2: string, x2: number) => {
      const doc = place(rectDoc(0, 0, 6, 5), { object: "b1", kind: "bed", at: [1.2, 3], size: BED_160x200 });
      return place(doc, { object: "b2", kind: "bed", at: [x2, 3], state: state2, size: BED_160x200 });
    };
    expect(invariants(two("s0", 2.5))).toEqual(["I11"]);
    expect(invariants(two("night", 2.5))).toEqual([]);
    expect(invariants(two("s0", 2.8))).toEqual([]); // 1.2 + 0.8 = 2.0 = 2.8 − 0.8
    const r = validateDocument(two("s0", 2.5));
    expect(r.ok ? [] : r.error.map((v) => v.entities)).toEqual([[{ table: "placements", id: "b1/s0" }, { table: "placements", id: "b2/s0" }]]);
  });
});

describe("rooms, free floor and use-zone warnings per state", () => {
  it("free floor of a 4 × 5 room (0.20 walls) with one bed: 18.24 − 3.20 = 15.04; per state; an unavailable room gives null (AC-04)", () => {
    const placed = place(rectDoc(0, 0, 4, 5), { object: "b", kind: "bed", at: [2, 3], size: BED_160x200 });
    const doc = { ...placed, states: { ...placed.states, night: { id: "night", name: "Night", order: 1 } } };
    const key = zones(doc)[0]?.face.key ?? "";
    expect(placementRoom(doc, "b/s0")).toBe(key);
    expect(freeFloor(doc, "s0").get(key)).toBeCloseTo(15.04, 9);
    expect(freeFloor(doc, "night").get(key)).toBeCloseTo(18.24, 9);
    const narrow = docOf({ joints: [["A", 0, 0], ["B", 0.15, 0], ["C", 0.15, 3], ["D", 0, 3]], walls: [["W1", "A", "B"], ["W2", "B", "C"], ["W3", "C", "D"], ["W4", "D", "A"]] });
    expect([...freeFloor(narrow, "s0").values()]).toEqual([null]);
  });

  it("free floor in a room with a hole is its net area minus its furniture; furniture in the hole's room is not counted (AC-06)", () => {
    // The bed's `at` is the middle of its back edge: x 1.2–2.8, y 0.5–2.5.
    const one = place(loops(A, C), { object: "b", kind: "bed", at: [2, 2.5], size: BED_160x200 });
    expect(validateDocument(one).ok).toBe(true);
    expect(freeFloor(one, "s0").get("A1|A2|A3|A4")).toBeCloseTo(66.2 - 3.2, 9);
    const two = place(one, { object: "b2", kind: "bed", at: [5, 5], size: BED_160x200 }); // in the core: x 4.2–5.8, y 3–5
    expect(validateDocument(two).ok).toBe(true);
    expect(freeFloor(two, "s0").get("A1|A2|A3|A4")).toBeCloseTo(63, 9);
    expect(freeFloor(two, "s0").get("C1|C2|C3|C4")).toBeCloseTo(7.84 - 3.2, 9);
  });

  it("drawing and then deleting a core keeps the room's key, label and free floor (AC-14)", () => {
    const run = (doc: Document, cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
    const furnished = run(emptyDocument(), [
      ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "apt"),
      { type: "labelZone", id: "L1", at: { x: 1, y: 1 }, name: "Living", finish: null },
      { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 2.5 } },
      { type: "setObjectSize", objectId: "bed/o0", w: 1.6, d: { standard: 2 } },
    ]);
    const cored = run(furnished, rectangleRoom({ x: 3.5, y: 2.5 }, 3, 3, "core"));
    const opened = run(cored, [{ type: "deleteEntities", ids: [{ table: "walls", id: "core-2/w0" }] }]);
    const key = zoneOfLabel(furnished, "L1")?.face.key ?? "";
    expect(key).not.toBe("");
    const stages: [Document, number][] = [[furnished, 73.24], [cored, 63], [opened, 73.24]];
    for (const [doc, free] of stages) {
      const z = zones(doc).find((x) => x.face.key === key);
      expect(z?.labelIds).toEqual(["L1"]);
      expect(zoneOfLabel(doc, "L1")).toBe(z);
      expect(freeFloor(doc, "s0").get(key)).toBeCloseTo(free, 9);
    }
  });

  it("warns when a bed's side zone crosses a wall and a block sits in a desk's zone; a chair there and a folded murphy bed give nothing", () => {
    let doc = place(rectDoc(0, 0, 6, 5), { object: "desk", kind: "desk", at: [2, 2.8] }); // x 1.4–2.6, y 2.2–2.8, zone y ∈ [1.4, 2.2]
    doc = place(doc, { object: "chair", kind: "chair", at: [2, 2.025] }); // in the desk zone: a seat at a desk
    doc = place(doc, { object: "block", kind: "block", at: [2.6, 2.1] }); // x 2.3–2.9, y 1.5–2.1: in the desk zone
    doc = place(doc, { object: "bed", kind: "bed", at: [5.1, 2.4], size: BED_160x200 }); // x 4.3–5.9: its right zone runs into W2
    doc = place(doc, { object: "murphy", kind: "murphyBed", at: [4.5, 4.7] });
    expect(validateDocument(doc).ok).toBe(true);
    expect(clearanceWarnings(doc, "s0")).toEqual([
      { zone: { table: "placements", id: "bed/s0", side: "right" }, against: { table: "walls", id: "W2" } },
      { zone: { table: "placements", id: "desk/s0", side: "front" }, against: { table: "placements", id: "block/s0" } },
    ]);
    expect(clearanceWarnings(doc, "other")).toEqual([]);
  });
});

describe("swingZone (spec: openings)", () => {
  it("is a width × width square on the opening side for a swing door; null for sliding and window; a bed in it warns and free floor is unchanged (AC-18)", () => {
    const room = rectDoc(0, 0, 6, 4);
    const doc = withOpening(room, { id: "d", wall: "W1", offset: 1 });
    expect(swingZone(doc, "d")).toEqual([{ x: 1, y: 0.1 }, { x: 1.8, y: 0.1 }, { x: 1.8, y: 0.9 }, { x: 1, y: 0.9 }]);
    const right = withOpening(room, { id: "d", wall: "W1", offset: 1, side: "right" });
    expect(swingZone(right, "d")).toEqual([{ x: 1.8, y: -0.1 }, { x: 1, y: -0.1 }, { x: 1, y: -0.9 }, { x: 1.8, y: -0.9 }]);
    expect(swingZone(withOpening(room, { id: "d", wall: "W1", offset: 1, kind: "sliding" }), "d")).toBeNull();
    expect(swingZone(withOpening(room, { id: "d", wall: "W1", offset: 1, kind: "window" }), "d")).toBeNull();

    const bed = (d: Document) => place(d, { object: "bed", kind: "bed", at: [2.4, 0.4], rotation: 180 }); // x 1.6–3.2, y 0.4–2.4
    expect(clearanceWarnings(bed(doc), "s0")).toEqual([{ zone: { table: "openings", id: "d" }, against: { table: "placements", id: "bed/s0" } }]);
    expect(clearanceWarnings(bed(doc), "other")).toEqual([]);
    expect([...freeFloor(bed(doc), "s0")]).toEqual([...freeFloor(bed(room), "s0")]);
  });

  it("warns when a swing crosses another wall's body", () => {
    // A door at the corner J1: its square starts on the left wall's centre line, inside that wall's body.
    expect(clearanceWarnings(withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 0 }), "s0"))
      .toEqual([{ zone: { table: "openings", id: "d" }, against: { table: "walls", id: "W4" } }]);
    expect(clearanceWarnings(withOpening(rectDoc(0, 0, 6, 4), { id: "d", wall: "W1", offset: 0.1 }), "s0")).toEqual([]);
  });
});

describe("swing clearance per kind (arch-review R-01)", () => {
  it.each(OPENING_KIND_IDS)("%s has a swing zone exactly when its table row says so", (kind) => {
    const doc = withOpening(rectDoc(0, 0, 4, 4), { id: "o", wall: "W1", offset: 1, kind, width: OPENING_KINDS[kind].width.default });
    expect(swingZone(doc, "o") !== null).toBe(OPENING_KINDS[kind].clearance !== "none");
  });
});

// The new kinds' clearances (openkinds.03, .17, AC-11): a double door's two half-width squares are one rectangle,
// width × width/2; the windows, and the doors that take no floor, have none. W1 runs (0, 0) → (6, 0), 0.20 m thick.
describe("clearance by kind (AC-11)", () => {
  const room = rectDoc(0, 0, 6, 4);
  // A 0.60 × 0.60 block: rotation 0, `at` its back edge's centre, so it covers y from at.y − 0.60 to at.y.
  const block = (d: Document, x: number, back: number) => place(d, { object: "block", kind: "block", at: [x, back] });
  const warned = (d: Document) => clearanceWarnings(d, "s0").map((w) => w.zone);

  it("a 1.20 double door's zone is its two half-width squares: x 1.00–2.20, y 0.10–0.70", () => {
    const doc = withOpening(room, { id: "d", wall: "W1", offset: 1, kind: "double", width: 1.2 });
    expect(swingZone(doc, "d")).toEqual([{ x: 1, y: 0.1 }, { x: 2.2, y: 0.1 }, { x: 2.2, y: 0.7 }, { x: 1, y: 0.7 }]);
  });

  it("a piece in either square warns, naming the door; one just past their depth doesn't", () => {
    const doc = withOpening(room, { id: "d", wall: "W1", offset: 1, kind: "double", width: 1.2 });
    expect(warned(block(doc, 1.3, 1.2))).toEqual([{ table: "openings", id: "d" }]); // x 1.0–1.6, y 0.6–1.2: the left square
    expect(warned(block(doc, 1.9, 1.2))).toEqual([{ table: "openings", id: "d" }]); // x 1.6–2.2: the right square
    expect(warned(block(doc, 1.6, 1.31))).toEqual([]); // y 0.71–1.31
  });

  it("a piece in front of a casement or a two-leaf window warns of nothing", () => {
    for (const kind of ["casement", "twoLeaf"] as const) {
      const doc = withOpening(room, { id: "o", wall: "W1", offset: 1, kind, width: 1.2 });
      expect(warned(block(doc, 1.6, 0.8)), kind).toEqual([]);
    }
  });
});

// A folding door's strip (openkinds.03, AC-03): across its whole span on its side face, FOLD_DEPTH (0.15 m) deep.
describe("a folding door's strip (AC-03)", () => {
  const room = rectDoc(0, 0, 6, 4);
  const doc = withOpening(room, { id: "f", wall: "W1", offset: 1, kind: "folding", width: 0.9 }); // face y 0.10
  const block = (x: number, back: number) => place(doc, { object: "block", kind: "block", at: [x, back] }); // y back − 0.60 to back

  it("is the span's whole width, 0.15 m deep, on the side face", () => {
    expect(swingZone(doc, "f")).toEqual([{ x: 1, y: 0.1 }, { x: 1.9, y: 0.1 }, { x: 1.9, y: 0.25 }, { x: 1, y: 0.25 }]);
    expect(FOLD_DEPTH).toBe(0.15);
  });

  it("a piece reaching into it warns naming the door; the same piece 0.16 m from the face doesn't", () => {
    expect(clearanceWarnings(block(1.8, 0.84), "s0").map((w) => w.zone)).toEqual([{ table: "openings", id: "f" }]); // its front 0.14 m from the face
    expect(clearanceWarnings(block(1.8, 0.86), "s0")).toEqual([]); // 0.16 m
  });
});
