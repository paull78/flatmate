import { describe, expect, it } from "vitest";
import type { Document, Opening } from "../src/model";
import { levelOf } from "../src/queries/levels";
import { wallChain, wallFace, wallRoomSides } from "../src/queries/helpers";
import { docOf, rectDoc, withOpening } from "./helpers";

/** The wall's chain at the floor level: these tests have no loft. */
const floorChain = (doc: Document, wallId: string, moving?: Opening) => wallChain(doc, wallId, levelOf(doc, null), moving);

// rectDoc's W1 runs J1 (0, 0) → J2 (4, 0): a 4.00 m centre line between W4 and W2, all 0.20 m, the room on its left.
const cm = (x: number): number => Math.round(x * 100) / 100;
const lengths = (chain: { pieces: { length: number }[] } | null) => (chain?.pieces ?? []).map((p) => cm(p.length));
const sides = (chain: { pieces: { left: unknown; right: unknown }[] } | null) =>
  (chain?.pieces ?? []).flatMap((p) => [p.left, p.right]).map((s) => JSON.stringify(s));
const extent = (face: { faceStart: number; faceEnd: number } | null) => (face ? [cm(face.faceStart), cm(face.faceEnd)] : null);

/** Two 4 × 3 rooms side by side: the bottom wall is split at the divider's T-junction J5 (4, 0). */
const twoRooms = () =>
  docOf({
    joints: [["J1", 0, 0], ["J5", 4, 0], ["J2", 8, 0], ["J3", 8, 3], ["J6", 4, 3], ["J4", 0, 3]],
    walls: [["W1a", "J1", "J5"], ["W1b", "J5", "J2"], ["W2", "J2", "J3"], ["W3a", "J3", "J6"], ["W3b", "J6", "J4"], ["W4", "J4", "J1"], ["D", "J5", "J6"]],
  });

describe("wallChain: clear interior dimensions (ux-polish.35)", () => {
  const door = () => withOpening(rectDoc(0, 0, 4, 3), { id: "door", wall: "W1", offset: 1.1 });

  it("a 4.00 m wall between two perpendicular walls, all 0.20 m, with a 0.80 door at offset 1.10: faceStart 0.10, faceEnd 3.90, pieces 1.00, 0.80, 2.00 adding up to 3.80 (AC-16)", () => {
    const chain = floorChain(door(), "W1");
    expect(chain?.side).toBe("left");
    expect(extent(chain)).toEqual([0.1, 3.9]);
    expect(lengths(chain)).toEqual([1, 0.8, 2]);
    expect(chain?.pieces.map((p) => p.role)).toEqual(["gap", "opening", "gap"]);
    expect((chain?.pieces ?? []).reduce((s, p) => s + p.length, 0)).toBeCloseTo(3.8, 9);
    expect(chain?.pieces[0]?.start).toBeCloseTo(0.1, 9);
    expect(chain?.pieces[2]?.end).toBeCloseTo(3.9, 9);
    // Points lie on the room-side face line, y = 0.10; opening edges keep their along-wall coordinate.
    const p = chain?.pieces[1];
    expect(p?.start).toBeCloseTo(1.1, 9);
    expect(p?.end).toBeCloseTo(1.9, 9);
    expect(p?.from.x).toBeCloseTo(1.1, 9);
    expect(p?.from.y).toBeCloseTo(0.1, 9);
    expect(p?.to.x).toBeCloseTo(1.9, 9);
    expect(p?.to.y).toBeCloseTo(0.1, 9);
    const a = JSON.stringify({ kind: "joint", joint: "a" });
    const b = JSON.stringify({ kind: "joint", joint: "b" });
    const d = JSON.stringify({ kind: "opening", id: "door" });
    expect(sides(chain)).toEqual([a, d, d, d, d, b]);
    expect(wallFace(door(), "W1")).toEqual({ side: chain?.side, faceStart: chain?.faceStart, faceEnd: chain?.faceEnd });
  });

  it("the side is the one facing a room: an outer wall whose left side is outside measures its right face; a divider between two rooms uses the left (AC-17)", () => {
    // Clockwise rectangle: W1 runs (0, 0) → (0, 3), so its left (x < 0) is outside and the room is on its right.
    const cw = docOf({
      joints: [["J1", 0, 0], ["J2", 0, 3], ["J3", 4, 3], ["J4", 4, 0]],
      walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
    });
    const outer = floorChain(cw, "W1");
    expect(outer?.side).toBe("right");
    expect(extent(outer)).toEqual([0.1, 2.9]);
    expect(outer?.pieces[0]?.from.x).toBeCloseTo(0.1, 9);
    expect(outer?.pieces[0]?.from.y).toBeCloseTo(0.1, 9);
    // The divider D runs (4, 0) → (4, 3) with a room on each side: the left of a → b.
    const divider = floorChain(twoRooms(), "D");
    expect(divider?.side).toBe("left");
    expect(extent(divider)).toEqual([0.1, 2.9]);
    expect(divider?.pieces[0]?.from.x).toBeCloseTo(3.9, 9);
    // A free wall with no room either side: the left, running to its flat ends.
    const free = docOf({ joints: [["A", 0, 0], ["B", 4, 0]], walls: [["W", "A", "B"]] });
    expect(wallFace(free, "W")).toEqual({ side: "left", faceStart: 0, faceEnd: 4 });
  });

  it("with a 0.30 m neighbour at a and a 0.10 m neighbour at b, the face starts 0.15 and ends 0.05 short of the joints", () => {
    const doc = rectDoc(0, 0, 4, 3);
    const mixed = { ...doc, walls: { ...doc.walls, W4: { id: "W4", a: "J4", b: "J1", thickness: 0.3, top: "ceiling" as const, base: "floor", column: false }, W2: { id: "W2", a: "J2", b: "J3", thickness: 0.1, top: "ceiling" as const, base: "floor", column: false } } };
    expect(extent(wallFace(mixed, "W1"))).toEqual([0.15, 3.95]);
    expect(lengths(floorChain(mixed, "W1"))).toEqual([3.8]);
  });

  it("a wall split by a T-junction measures each fragment's room-side face to the divider's face", () => {
    const doc = twoRooms();
    expect(wallFace(doc, "W1a")).toMatchObject({ side: "left" });
    expect(extent(wallFace(doc, "W1a"))).toEqual([0.1, 3.9]);
    expect(wallFace(doc, "W1b")).toMatchObject({ side: "left" });
    expect(extent(wallFace(doc, "W1b"))).toEqual([0.1, 3.9]);
  });

  it("a straight continuation runs the face to the shared joint", () => {
    const doc = docOf({ joints: [["A", 0, 0], ["B", 4, 0], ["C", 8, 0]], walls: [["W", "A", "B"], ["V", "B", "C", 0.3]] });
    expect(extent(wallFace(doc, "W"))).toEqual([0, 4]);
    expect(extent(wallFace(doc, "V"))).toEqual([0, 4]);
  });

  it("a moving opening replaces its stored position or joins the chain (clear numbers); an opening touching the face start leaves no zero piece", () => {
    const doc = door();
    const d = doc.openings.door;
    if (!d) throw new Error("no door");
    expect(lengths(floorChain(doc, "W1", { ...d, offset: 0.5 }))).toEqual([0.4, 0.8, 2.6]);
    const preview = { ...d, id: "preview/d0", offset: 3, width: 0.8 };
    expect(lengths(floorChain(doc, "W1", preview))).toEqual([1, 0.8, 1.1, 0.8, 0.1]);
    const touching = floorChain(doc, "W1", { ...d, offset: 0.1 });
    expect(lengths(touching)).toEqual([0.8, 3]);
    expect(touching?.pieces.map((p) => p.role)).toEqual(["opening", "gap"]);
  });

  it("an opening reaching past the face (into the corner, or off the wall) keeps its full width and drops the gap it covers", () => {
    const doc = withOpening(rectDoc(0, 0, 4, 3), { id: "d", wall: "W1", offset: 0 });
    const chain = floorChain(doc, "W1");
    expect(lengths(chain)).toEqual([0.8, 3.1]);
    expect(chain?.pieces[0]?.start).toBe(0);
    const d = doc.openings.d;
    if (!d) throw new Error("no door");
    expect(lengths(floorChain(doc, "W1", { ...d, offset: 3.5 }))).toEqual([3.4, 0.8]);
  });

  it("touching openings leave no zero gap between them", () => {
    let doc = withOpening(rectDoc(0, 0, 4, 3), { id: "d1", wall: "W1", offset: 0.1 });
    doc = withOpening(doc, { id: "d2", wall: "W1", offset: 0.9 });
    expect(lengths(floorChain(doc, "W1"))).toEqual([0.8, 0.8, 2.2]);
  });

  it("a wall without openings gives one gap equal to its clear length; a missing wall gives null; only the wall's own openings count", () => {
    expect(lengths(floorChain(rectDoc(0, 0, 4, 3), "W1"))).toEqual([3.8]);
    expect(floorChain(rectDoc(0, 0, 4, 3), "nope")).toBeNull();
    expect(wallFace(rectDoc(0, 0, 4, 3), "nope")).toBeNull();
    const doc = withOpening(rectDoc(0, 0, 4, 3), { id: "other", wall: "W2", offset: 1 });
    expect(lengths(floorChain(doc, "W1"))).toEqual([3.8]);
  });
});

describe("wallRoomSides (heights.19)", () => {
  it("a shell wall has a room on one side, a divider on both, a free wall on neither", () => {
    const room = rectDoc(0, 0, 6, 4); // W1 J1(0,0) → J2(6,0): the room is on its left (+y)
    expect(wallRoomSides(room, "W1")).toEqual({ left: true, right: false, normal: { x: -0, y: 1 } });
    const free = { ...room, joints: { ...room.joints, F1: { id: "F1", x: 8, y: 0 }, F2: { id: "F2", x: 9, y: 0 } }, walls: { ...room.walls, F: { id: "F", a: "F1", b: "F2", thickness: 0.2, top: "ceiling" as const, base: "floor", column: false } } };
    expect(wallRoomSides(free, "F")).toMatchObject({ left: false, right: false });
    expect(wallRoomSides(room, "nope")).toBeNull();
  });
});
