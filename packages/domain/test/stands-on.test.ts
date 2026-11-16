import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { candidateShape, footprintFit, placementFit, type PlacementFit } from "../src/queries/fit";
import { landing } from "../src/queries/landing";
import { levelOf } from "../src/queries/levels";
import { rectangleRoom } from "../src/scripts";
import { validateDocument } from "../src/validate";

// A piece overhanging a platform's edge (steps.06, .11, AC-08): it still stands on the platform (top at most 0.76)
// when, in order, no part is over a hole, its centre is on the slab, it lies inside the deck grown by 0.30 m in the
// deck's frame, and every corner off the deck lies in its centre's room. What is below is the height tests'. Each case
// is asked of the command (validation) and of `placementFit` (the preview), which must agree.
//
// The Studio-like room: 7 × 2.5 (inner x 0.1–6.9, y 0.1–2.4), ceiling 3.05; the hollow platform at +0.45 over
// x 2.6–4.6, y 1.3–2.4 (as the sample Studio's); its front edge is y 1.30.

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const PLAT = "plat/k0";

function studio(...more: Command[]): Document {
  return run(emptyDocument(), [
    ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 3.6, y: 1.85 }, w: 2, d: 1.1, top: 0.45, solid: false },
    ...more,
  ]);
}

type Ask = { kind: string; at: { x: number; y: number }; rotation?: number; w: number; d: number; deck: string | null };
/** A piece whose front faces −y at rotation 0: `at` is its back edge's middle, its front `d` in front of it. */
const placeCmd = (a: Ask, opId = "p"): Command => ({ type: "placeObject", opId, state: "s0", object: { kind: a.kind, size: { w: a.w, d: a.d } }, at: a.at, rotation: a.rotation ?? 0, deck: a.deck });

/** The command's verdict (null when it passes, else its message) and the preview's reason. */
function both(doc: Document, a: Ask): { message: string | null; fit: PlacementFit["reason"] } {
  const r = execute(doc, placeCmd(a));
  const message = r.ok ? null : r.error.message;
  const fit = placementFit(doc, { kind: a.kind, state: "s0", at: a.at, rotation: a.rotation ?? 0, config: "standard", w: a.w, d: a.d, surface: a.deck }).reason;
  return { message, fit };
}

/** The bar table on the platform, its back edge `back` (y), so its front lies 0.60 (or `d`) in front. */
const bar = (back: number, d = 0.6): Ask => ({ kind: "barTable", at: { x: 3.6, y: back }, w: 1.2, d, deck: PLAT });

describe("overhanging a platform (AC-08)", () => {
  it("bar over the bed: a bar table 0.20 m past the front edge, over a 0.30 m bed on the floor, is accepted", () => {
    const doc = studio(placeCmd({ kind: "block", at: { x: 3.6, y: 1.3 }, w: 0.85, d: 0.85, deck: null }, "bed"), { type: "setObjectSize", objectId: "bed/o0", w: 0.85, d: { standard: 0.85 }, h: { standard: 0.3 } });
    expect(both(doc, bar(1.7))).toEqual({ message: null, fit: null });
    expect(validateDocument(run(doc, [placeCmd(bar(1.7))]))).toEqual({ ok: true, value: undefined });
  });

  it("reach: 0.35 m past the edge (a 0.80 deep piece, its centre still on the slab) is refused", () => {
    const r = both(studio(), bar(1.75, 0.8));
    expect(r.message).toContain("reaches more than 0.30 m past");
    expect(r.fit).toBe("deckReach");
  });

  it("centre: a stool whose centre is 0.05 m off the slab, 0.25 m past, is refused for its centre", () => {
    const r = both(studio(), { kind: "stool", at: { x: 3.0, y: 1.45 }, w: 0.4, d: 0.4, deck: PLAT });
    expect(r.message).toContain("centre is off");
    expect(r.fit).toBe("deckCentre");
  });

  it("order: a piece both centre-off and past 0.30 m names its centre first", () => {
    const r = both(studio(), bar(1.55));
    expect(r.message).toContain("centre is off");
    expect(r.fit).toBe("deckCentre");
  });

  it("room: reaching over a 0.40 m half wall into the next room is refused for its room; over a full wall, the wall", () => {
    // A wall on x = 5.0 (body 4.9–5.1) and a platform against it at x 3.85–4.85; a piece 0.28 m past its right edge.
    const withWall = (top: number | null): Document => {
      const doc = studio({ type: "addWall", opId: "pw", from: { at: { x: 5, y: 0 } }, to: { at: { x: 5, y: 2.5 } } }, { type: "addDeck", opId: "side", preset: "platform", at: { x: 4.35, y: 0.6 }, w: 1, d: 0.8, top: 0.45, solid: true });
      const onX5 = (j: string): boolean => Math.abs((doc.joints[j]?.x ?? 0) - 5) < 1e-9;
      const wall = Object.values(doc.walls).find((w) => onX5(w.a) && onX5(w.b));
      return top === null || !wall ? doc : run(doc, [{ type: "setWallTop", wallId: wall.id, top }]);
    };
    // Turned 90° (front toward +x): its back edge at x 4.53, its front 0.75 further, at x 5.13 (0.28 past 4.85).
    const piece: Ask = { kind: "block", at: { x: 4.38, y: 0.6 }, rotation: 90, w: 0.5, d: 0.75, deck: "side/k0" };
    const low = both(withWall(0.4), piece);
    expect(low.message).toContain("overhangs out of its room");
    expect(low.fit).toBe("deckRoom");
    const full = both(withWall(null), piece);
    expect(full.fit).toBe("wall");
    expect(full.message).toContain("wall");
  });

  it("stool under the overhang: a stool on the floor under the bar table's overhang collides with it", () => {
    const doc = studio(placeCmd(bar(1.7), "b"));
    // y 0.88–1.28: under the bar's overhang (y 1.10–1.30), clear of the platform (from y 1.30).
    const r = both(doc, { kind: "stool", at: { x: 3.6, y: 1.28 }, w: 0.4, d: 0.4, deck: null });
    expect(r.fit).toBe("object");
    expect(r.message).toContain("Bar table");
  });

  it("loft unchanged: a piece on a 2.15 loft 0.10 m past its edge lies outside it, as before", () => {
    const doc = studio({ type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.2, y: 1.25 }, w: 2, d: 2.3, top: 2.15 });
    // The loft spans x 0.2–2.2; a stool (0.75 tall, under the 3.05 ceiling) with its front 0.10 m past x 2.2, turned toward +x.
    const r = both(doc, { kind: "stool", at: { x: 1.9, y: 1.2 }, rotation: 90, w: 0.4, d: 0.4, deck: "loft/k0" });
    expect(r.message).toContain("lies outside");
    expect(r.fit).toBe("outsideDeck");
  });

  it("turned deck: on a platform turned 30°, 0.25 m past its edge in its own frame passes, 0.35 m doesn't", () => {
    const c = { x: 3.5, y: 1.2 };
    const doc = run(emptyDocument(), [
      ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"),
      { type: "addDeck", opId: "t", preset: "platform", at: c, w: 1.6, d: 1.2, rotation: 30, top: 0.45, solid: true },
    ]);
    const r = (30 * Math.PI) / 180;
    const v = { x: -Math.sin(r), y: Math.cos(r) }; // the deck's own +y (its depth)
    // A 0.80 deep box turned 30° too, its front `past` beyond the deck's −v edge: its back edge 0.80 behind that.
    const piece = (past: number): Ask => {
      const back = 0.6 + past - 0.8; // from the centre along v: the front at −(0.60 + past), the back 0.80 further in
      return { kind: "block", at: { x: c.x - v.x * back, y: c.y - v.y * back }, rotation: 30, w: 0.5, d: 0.8, deck: "t/k0" };
    };
    expect(both(doc, piece(0.25))).toEqual({ message: null, fit: null });
    expect(both(doc, piece(0.35)).fit).toBe("deckReach");
  });

  it("raising a platform above 0.76 m while a piece overhangs it is refused", () => {
    const doc = studio(placeCmd(bar(1.7), "b"));
    const r = execute(doc, { type: "setDeck", deckId: PLAT, top: 0.9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("lies outside");
  });
});

describe("a path across a platform's edge (AC-09)", () => {
  it("landing and the command agree at every centimetre: on the platform, then refused, then on the floor", () => {
    // A chair on the sample platform (front edge y 1.30) moved straight toward −y, its back edge from y 1.80 down to
    // y 0.80 by centimetres; at each spot, `landing` from the platform and the command storing its answer agree.
    const doc = studio(placeCmd({ kind: "chair", at: { x: 3.0, y: 1.9 }, w: 0.45, d: 0.45, deck: PLAT }, "c"));
    const answers: string[] = [];
    for (let cm = 180; cm >= 80; cm--) {
      const at = { x: 3.0, y: cm / 100 };
      const shape = candidateShape("chair", at, 0.45, 0.45, 0);
      const heights = { h: 0.85, z: 0 };
      const c = { state: "s0", ring: shape.ring, parts: shape.parts, heights, current: PLAT, ignore: ["c/p0"], centre: shape.centre };
      const landed = landing(doc, c, levelOf(doc, null));
      const surface = landed.kind === "surface" ? landed.deck : null;
      const fits = footprintFit(doc, shape.ring, "s0", heights, surface, ["c/p0"], shape.centre, undefined, null, shape.parts).fits;
      const r = execute(doc, { type: "movePlacement", placementId: "c/p0", at, rotation: 0, deck: surface });
      expect({ cm, accepted: r.ok }).toEqual({ cm, accepted: fits });
      const tag = !fits ? "refused" : surface === PLAT ? "platform" : "floor";
      if (answers[answers.length - 1] !== tag) answers.push(tag);
    }
    expect(answers).toEqual(["platform", "refused", "floor"]);
  });
});
