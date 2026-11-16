import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, Wall } from "../src/model";
import { wallRange } from "../src/queries/vertical";
import { loftStudio } from "./helpers";

// The deck lock (pillars.05, .23; AC-05, AC-11): a deck that a wall or column references, as base or top, keeps its
// place, size and turn and can't be deleted, the refusal naming the row before any piece the deck carries; raising,
// lowering and `solid` are left to validation.

const run = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const set = (fields: Omit<Extract<Command, { type: "setDeck" }>, "type" | "deckId">): Command => ({ type: "setDeck", deckId: "loft", ...fields });
const del = (...ids: Extract<Command, { type: "deleteEntities" }>["ids"]): Command => ({ type: "deleteEntities", ids });
const LOFT = { table: "decks", id: "loft" } as const;

/** The studio with a 0.20 post under the loft's open edge, up to its underside (u/w0); the mattress stays on the loft. */
const UNDER = run(loftStudio(), { type: "placeColumn", opId: "u", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: "loft" });
/** The studio with a 0.20 post on the loft up to the ceiling (o/w0). */
const ON = run(loftStudio(), { type: "placeColumn", opId: "o", at: { x: 2.35, y: 0.3 }, width: 0.2, depth: 0.2, base: "loft" });
const REACHES = "Column u/w0 reaches up to Loft; move it first";
const STANDS = "Column o/w0 stands on Loft; move it first";

describe("the deck lock", () => {
  it("moving, resizing or turning the loft with a post under it is refused naming the post, not the mattress", () => {
    expect(refusal(UNDER, set({ at: { x: 1.4, y: 1.25 } }))).toBe(REACHES);
    expect(refusal(UNDER, set({ w: 2.3 }))).toBe(REACHES);
    expect(refusal(UNDER, set({ d: 2.2 }))).toBe(REACHES);
    expect(refusal(UNDER, set({ rotation: 90 }))).toBe(REACHES);
  });

  it("a post on the loft locks it too, as its base", () => {
    expect(refusal(ON, set({ at: { x: 1.4, y: 1.25 } }))).toBe(STANDS);
    expect(refusal(ON, del(LOFT))).toBe(STANDS);
  });

  it("the refusal carries plain words for people, naming the deck but not the row", () => {
    const r = execute(UNDER, set({ w: 2.3 }));
    expect(r.ok ? null : r.error.violations.map((v) => [v.invariant, v.plain, v.entities])).toEqual([
      ["I21", "A column reaches up to Loft; move it first", [LOFT, { table: "walls", id: "u/w0" }]],
    ]);
  });

  it("a wall on the loft locks it", () => {
    const knee: Wall = { id: "K", a: "Ka", b: "Kb", thickness: 0.1, top: 0.9, base: "loft", column: false };
    const s = loftStudio();
    const doc: Document = { ...s, joints: { ...s.joints, Ka: { id: "Ka", x: 2.45, y: 0.6 }, Kb: { id: "Kb", x: 2.45, y: 2 } }, walls: { ...s.walls, K: knee } };
    expect(refusal(doc, set({ at: { x: 1.4, y: 1.25 } }))).toBe("Wall K stands on Loft; move it first");
  });

  it("deleting the loft is refused naming the post; with the post and the mattress it goes", () => {
    expect(refusal(UNDER, del(LOFT))).toBe(REACHES);
    expect(refusal(UNDER, del(LOFT, { table: "walls", id: "u/w0" }))).toBe("Loft carries Mattress in Layout; move it off first");
    expect(refusal(UNDER, del(LOFT, { table: "walls", id: "u/w0" }, { table: "objects", id: "mat" }))).toBe("accepted");
  });

  it("raising the loft is accepted, and the post follows", () => {
    const raised = run(UNDER, set({ top: 2.3 }));
    expect(raised.decks.loft?.top).toBe(2.3);
    expect(wallRange(raised, "u/w0")?.top).toBeCloseTo(2.18, 9);
  });

  it("an unchanged position, size or turn is no edit to lock", () => {
    expect(refusal(UNDER, set({ at: { x: 1.3, y: 1.25 }, w: 2.4, rotation: 0, name: "Sleeping loft" }))).toBe("accepted");
  });

  it("a deck no row references moves as before, carrying its pieces", () => {
    const moved = run(loftStudio(), set({ at: { x: 1.4, y: 1.25 }, w: 2.4, d: 2.3 }));
    expect(moved.decks.loft?.at).toEqual({ x: 1.4, y: 1.25 });
    expect(moved.placements["mat/s0"]?.at).toEqual({ x: 1.2, y: 2.4 });
  });
});
