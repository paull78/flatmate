import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { flushEnd } from "../src/commands/wall-ends";
import { execute } from "../src/commands/execute";
import type { Command, CommandResult, JointRef } from "../src/commands/types";
import { MESSAGES } from "../src/errors";
import { FLOOR_BASE, type Document, type Wall } from "../src/model";
import { swingZone } from "../src/queries/clearance";
import { doorSpans } from "../src/queries/door-spans";
import { openingRange } from "../src/queries/vertical";
import { validateDocument } from "../src/validate";
import { loftStudio, withOpening } from "./helpers";

// Walls on a deck (pillars.08, .09; AC-08, AC-09, AC-10): addWall takes a base, resolves its ends only against joints
// and walls of that base, and ends flush against the face of a wall of another base it is drawn into.

/**
 * The studio without its mattress (shell W1..W4 of 0.20, inner faces x 0.1 / 6.9, y 0.1 / 2.4; the loft over x 0.1–2.5,
 * y 0.1–2.4 at 2.15) and a free 0.10 floor partition Q from Q1 (1.5, 0.6) to Q2 (1.5, 1.6), 2.03 m high, under the loft.
 */
function studio(): Document {
  const doc = loftStudio();
  const q: Wall = { id: "Q", a: "Q1", b: "Q2", thickness: 0.1, top: 2.03, base: FLOOR_BASE, column: false };
  return {
    ...doc,
    objects: {},
    placements: {},
    joints: { ...doc.joints, Q1: { id: "Q1", x: 1.5, y: 0.6 }, Q2: { id: "Q2", x: 1.5, y: 1.6 } },
    walls: { ...doc.walls, Q: q },
  };
}

const at = (x: number, y: number): JointRef => ({ at: { x, y } });
type AddWall = Extract<Command, { type: "addWall" }>;
const onLoft = (opId: string, from: JointRef, to: JointRef, extra: Partial<AddWall> = {}): AddWall => ({ type: "addWall", opId, from, to, base: "loft", ...extra });

function run(doc: Document, cmd: Command): CommandResult {
  return execute(doc, cmd);
}
function done(doc: Document, cmd: Command): Document {
  const r = run(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}
function refused(doc: Document, cmd: Command): { message: string; plain: string | undefined } {
  const r = run(doc, cmd);
  if (r.ok) throw new Error("expected a refusal");
  return { message: r.error.message, plain: r.error.violations[0]?.plain };
}
const point = (doc: Document, jointId: string | undefined): Point | null => {
  const j = jointId === undefined ? undefined : doc.joints[jointId];
  return j ? { x: j.x, y: j.y } : null;
};
const ends = (doc: Document, wallId: string): [Point | null, Point | null] => {
  const w = doc.walls[wallId];
  return [point(doc, w?.a), point(doc, w?.b)];
};
/** The wall's ends, to the nanometre: a flush end is computed, so it carries float noise. */
const endsNear = (doc: Document, wallId: string): number[][] => ends(doc, wallId).map((p) => (p ? [p.x, p.y].map((v) => Math.round(v * 1e9) / 1e9) : []));
const shellOf = (doc: Document) => ({ walls: ["W1", "W2", "W3", "W4"].map((id) => doc.walls[id]), joints: ["J1", "J2", "J3", "J4"].map((id) => doc.joints[id]) });

describe("addWall's base and top", () => {
  it("the fixture is valid", () => {
    expect(validateDocument(studio()).ok).toBe(true);
  });

  it("a wall on the loft has that base and, by default, the ceiling as its top", () => {
    const next = done(studio(), onLoft("k", at(0.6, 1.2), at(1.2, 1.2)));
    expect(next.walls["k/w0"]).toMatchObject({ base: "loft", top: "ceiling" });
  });

  it("a numeric top is a height from the base", () => {
    const next = done(studio(), onLoft("k", at(0.6, 1.2), at(1.2, 1.2), { top: 0.6 }));
    expect(next.walls["k/w0"]).toMatchObject({ base: "loft", top: 0.6 });
  });

  it("a wall drawn without a base stands on the floor", () => {
    const next = done(studio(), { type: "addWall", opId: "f", from: at(3, 1), to: at(4, 1) });
    expect(next.walls["f/w0"]).toMatchObject({ base: FLOOR_BASE, top: "ceiling" });
  });

  it("a deck as top is refused: only a free column on the floor reaches up to a deck", () => {
    expect(refused(studio(), { type: "addWall", opId: "f", from: at(3, 0.4), to: at(3, 1.2), top: "loft" }).message).toBe(MESSAGES.onlyColumnsReachDecks);
  });

  it("a missing deck as base is refused", () => {
    expect(refused(studio(), onLoft("k", at(0.6, 1.2), at(1.2, 1.2), { base: "nope" })).message).toBe("Deck not found");
  });
});

describe("a wall on the loft drawn to the shell (AC-09)", () => {
  it("ends flush against the shell's inner face, and the shell wall is not split", () => {
    const doc = studio();
    const next = done(doc, onLoft("k", at(1.5, 1.2), at(0, 1.2)));
    expect(endsNear(next, "k/w0")).toEqual([[1.5, 1.2], [0.1, 1.2]]);
    expect(shellOf(next)).toEqual(shellOf(doc));
    expect(Object.keys(next.walls).sort()).toEqual([...Object.keys(doc.walls), "k/w0"].sort());
  });

  it("drawn from the shell, its start ends flush too", () => {
    const next = done(studio(), onLoft("k", at(1.2, 2.5), at(1.2, 1.5)));
    expect(endsNear(next, "k/w0")).toEqual([[1.2, 2.4], [1.2, 1.5]]);
  });

  it("a click anywhere in the shell's body ends on its inner face", () => {
    const next = done(studio(), onLoft("k", at(1.5, 1.2), at(0.07, 1.2)));
    expect(endsNear(next, "k/w0")[1]).toEqual([0.1, 1.2]);
  });

  it("at an angle, the end stays on the wall's own line and lies on the face", () => {
    const end = flushEnd(studio(), { x: 0, y: 0.65 }, { x: 1.1, y: 1.2 }, "loft", { bottom: 2.15, top: 3.05 });
    expect(end?.x).toBeCloseTo(0.1, 9);
    expect(end?.y).toBeCloseTo(0.7, 9);
  });

  it("at an angle against a loft that reaches the shell's faces, a corner of its body reaches past the loft: refused", () => {
    expect(refused(studio(), onLoft("k", at(1.1, 1.2), at(0, 0.65))).message).toBe("Wall k/w0 reaches past Loft's edge");
  });

  it("an end in the bodies of two shell walls stops at the first face it meets", () => {
    // From (1, 0.5) towards the corner: the south wall's face (y 0.1) comes before the west wall's (x 0.1).
    const end = flushEnd(studio(), { x: 0.05, y: 0.05 }, { x: 1, y: 0.5 }, "loft", { bottom: 2.15, top: 3.05 });
    expect(end?.x).toBeCloseTo(1 - 0.95 * (0.4 / 0.45), 9);
    expect(end?.y).toBeCloseTo(0.1, 9);
  });

  it("an end in no other wall's body stays where it is", () => {
    expect(flushEnd(studio(), { x: 1, y: 1 }, { x: 2, y: 1 }, "loft", { bottom: 2.15, top: 3.05 })).toBeNull();
  });

  it("a knee wall along the loft's open edge, from shell to shell, is accepted", () => {
    const next = done(studio(), onLoft("k", at(2.45, 0), at(2.45, 2.5), { thickness: 0.1, top: 0.9 }));
    expect(endsNear(next, "k/w0")).toEqual([[2.45, 0.1], [2.45, 2.4]]);
  });

  it("a wall on the floor drawn to the shell still splits it", () => {
    const next = done(studio(), { type: "addWall", opId: "f", from: at(4, 1.2), to: at(7, 1.2) });
    expect(next.walls["f/w1"]).toBeDefined();
  });
});

describe("a wall on the loft and its edge (AC-10)", () => {
  it("past the loft's open edge it is refused with a reason", () => {
    const r = refused(studio(), onLoft("k", at(1.5, 1.2), at(2.7, 1.2)));
    expect(r.message).toBe("Wall k/w0 reaches past Loft's edge");
    expect(r.plain).toBe("A wall reaches past Loft's edge");
  });

  it("flush with the loft's edge against the shell, from the shell to the open edge, it is accepted", () => {
    const next = done(studio(), onLoft("k", at(0, 2.35), at(2.5, 2.35), { thickness: 0.1 }));
    expect(endsNear(next, "k/w0")).toEqual([[0.1, 2.35], [2.5, 2.35]]);
  });

  it("flush with the loft's edge against the shell, one end inside, it is accepted", () => {
    const next = done(studio(), onLoft("k", at(0, 2.35), at(1.5, 2.35), { thickness: 0.1 }));
    expect(endsNear(next, "k/w0")).toEqual([[0.1, 2.35], [1.5, 2.35]]);
  });

  it("across the loft from the south shell to the north shell, it is accepted", () => {
    const next = done(studio(), onLoft("k", at(1, 0), at(1, 2.5)));
    expect(endsNear(next, "k/w0")).toEqual([[1, 0.1], [1, 2.4]]);
  });
});

describe("joints and splits stay within one base (pillars.09)", () => {
  it("a loft wall drawn across the 2.03 floor partition doesn't split it", () => {
    const doc = studio();
    const next = done(doc, onLoft("k", at(0.5, 1), at(2.4, 1)));
    expect(next.walls.Q).toEqual(doc.walls.Q);
    expect(Object.keys(next.walls).sort()).toEqual([...Object.keys(doc.walls), "k/w0"].sort());
  });

  it("a loft wall ending over the partition's joint doesn't join it", () => {
    const next = done(studio(), onLoft("k", at(0.5, 1.6), at(1.5, 1.6)));
    const wall = next.walls["k/w0"];
    expect(wall?.b).toBe("k/j1");
    expect(point(next, wall?.b)).toEqual({ x: 1.5, y: 1.6 });
  });

  it("a loft wall ending inside the partition's body doesn't end flush against it (their heights don't meet)", () => {
    const next = done(studio(), onLoft("k", at(0.5, 1), at(1.52, 1)));
    expect(point(next, next.walls["k/w0"]?.b)).toEqual({ x: 1.52, y: 1 });
  });

  it("two loft walls drawn end to end share a joint", () => {
    const first = done(studio(), onLoft("a", at(0.5, 1), at(1.2, 1)));
    const next = done(first, onLoft("b", at(1.2, 1), at(1.2, 2)));
    expect(next.walls["b/w0"]?.a).toBe(first.walls["a/w0"]?.b);
  });

  it("a loft wall ending on another loft wall splits it, the fragment keeping the base", () => {
    const first = done(studio(), onLoft("a", at(0.5, 1), at(2, 1)));
    const next = done(first, onLoft("b", at(1.2, 1), at(1.2, 2)));
    expect(next.walls["b/w1"]).toMatchObject({ base: "loft" });
    expect(next.walls["b/w0"]?.a).toBe(next.walls["a/w0"]?.b);
  });

  it("a loft wall from a floor wall's joint is refused: two walls of different bases at one joint", () => {
    const r = refused(studio(), onLoft("k", { existing: "Q2" }, at(0.5, 1.6)));
    expect(r.message).toBe("Walls at joint Q2 stand on different bases");
    expect(r.plain).toBe(MESSAGES.oneBasePerJoint);
  });

  it("dragging a loft wall's joint onto the partition's joint doesn't merge them", () => {
    const doc = done(studio(), onLoft("k", at(0.5, 1.2), at(1.2, 1.2)));
    const next = done(doc, { type: "moveJoints", moves: [{ jointId: "k/j1", to: { x: 1.5, y: 1.6 } }] });
    expect(next.walls["k/w0"]?.b).toBe("k/j1");
    expect(next.walls.Q).toEqual(doc.walls.Q);
    expect(next.joints.Q2).toEqual(doc.joints.Q2);
  });

  it("dragging a loft wall's joint onto another loft wall's joint is refused", () => {
    const doc = done(done(studio(), onLoft("a", at(0.5, 1), at(1.2, 1))), onLoft("b", at(0.5, 2), at(1.2, 2)));
    expect(run(doc, { type: "moveJoints", moves: [{ jointId: "b/j1", to: { x: 1.2, y: 1 } }] }).ok).toBe(false);
  });
});

describe("doors and windows on a wall on a deck (sills.03, which replaced pillars.08's refusal; sills step 06, AC-04)", () => {
  const withLoftWall = (doc = studio()): Document => done(doc, onLoft("k", at(0.5, 1.2), at(2, 1.2)));
  const opening = (kind: "swing" | "window"): Command => ({ type: "addOpening", opId: "d", wall: "k/w0", kind, offset: 0.2 });
  /** The studio under a 4.20 ceiling: its loft's walls run 2.05 m above the loft's top at 2.15. */
  const tall = (): Document => withLoftWall(done(studio(), { type: "setCeiling", height: 4.2 }));

  it("a door and a window on a wall on the loft take their heights above the loft's top", () => {
    const door = done(tall(), opening("swing"));
    expect([door.openings["d/d0"]?.sill, door.openings["d/d0"]?.head]).toEqual([0, 1.95]);
    expect(openingRange(door, "d/d0")).toEqual({ bottom: 2.15, top: 4.1 });
    const win = done(tall(), opening("window"));
    expect(openingRange(win, "d/d0")).toEqual({ bottom: 3.05, top: 4.1 });
  });

  it("under the studio's 3.05 ceiling the loft's 0.90 m wall takes a 0.80 m door, and a window is too short there", () => {
    expect(done(withLoftWall(), opening("swing")).openings["d/d0"]?.head).toBe(0.8);
    expect(refused(withLoftWall(), opening("window")).plain).toBe("An opening must be at least 0.30 m tall");
  });

  it("a stored drawing may hold one", () => {
    expect(validateDocument(withOpening(tall(), { id: "o", wall: "k/w0", offset: 0.2 })).ok).toBe(true);
  });

  it("a door there has a swing zone, checked at its deck (spec: levels, which replaced sills.13), and no span", () => {
    const doc = done(tall(), opening("swing"));
    expect(swingZone(doc, "d/d0")).not.toBeNull();
    expect(doorSpans(doc).map((s) => s.openingId)).not.toContain("d/d0");
  });

  it("a door on a column is refused with a reason", () => {
    const doc = done(studio(), { type: "placeColumn", opId: "c", at: { x: 4, y: 1.2 }, width: 0.3, depth: 0.3 });
    expect(refused(doc, { type: "addOpening", opId: "d", wall: "c/w0", kind: "swing", offset: 0 }).plain).toBe(MESSAGES.columnLockedPlain);
  });

  it("a door on a wall on the floor is still accepted", () => {
    const doc = done(studio(), { type: "addWall", opId: "f", from: at(4, 0), to: at(4, 2.5) });
    expect(run(doc, { type: "addOpening", opId: "d", wall: "f/w0", kind: "swing", offset: 0.5 }).ok).toBe(true);
  });
});
