import { describe, expect, it } from "vitest";
import { emptyDocument, execute, freeFloor, placementFit, rectangleRoom, type Command, type Document } from "../src";

// Wheel wells over walls and the cover rule (trailer.09, .13, .14; AC-06, AC-07, AC-09). A 7 × 2.5 room of 0.20 m walls
// on centrelines: the lower wall's body is y −0.1 to 0.1, its inner face y = 0.1. At rotation 0 a piece's back edge is
// at `at.y` and its front at `at.y − d`.

const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const room = (): Document => build(...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "c"));
const S = (doc: Document): string => Object.keys(doc.states).sort()[0] ?? "";
const place = (opId: string, kind: string, x: number, backY: number, size?: { w: number; d: number; h?: number }): (doc: Document) => Command => (doc) => ({
  type: "placeObject", opId, state: S(doc), object: { kind, ...(size ? { size } : {}) }, at: { x, y: backY }, deck: null,
});
const refusal = (doc: Document, make: (doc: Document) => Command): string | null => {
  const r = execute(doc, make(doc));
  return r.ok ? null : r.error.message;
};
const ok = (doc: Document, make: (doc: Document) => Command): Document => {
  const r = execute(doc, make(doc));
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
};
/** What the editor's preview says for the same placement as `make`. */
const previews = (doc: Document, kind: string, x: number, backY: number, size?: { w: number; d: number; h?: number }): boolean =>
  placementFit(doc, { kind, state: S(doc), at: { x, y: backY }, rotation: 0, config: "standard", surface: null, ...(size ? { w: size.w, d: size.d, ...(size.h !== undefined ? { h: size.h } : {}) } : {}) }).fits;

/** A well 1.80 × 0.40 × 0.35 at x 2.1–3.9, y −0.05 to 0.35: its outer 0.15 m under the lower wall, its centre at y 0.15. */
const WELL = place("w", "wheelWell", 3, 0.35);
const BENCH = { w: 1.8, d: 0.6, h: 0.45 };

describe("a well over a wall (AC-06, AC-09)", () => {
  it("half over the long wall is accepted, and the editor's preview agrees", () => {
    expect(refusal(room(), WELL)).toBeNull();
    expect(previews(room(), "wheelWell", 3, 0.35)).toBe(true);
  });

  it("with its centre under the wall it is refused as not inside a room, and the preview agrees", () => {
    const under = place("w", "wheelWell", 3, 0.15); // y −0.25 to 0.15: centre at −0.05, in the wall's body
    expect(refusal(room(), under)).toMatch(/not inside a room/);
    expect(previews(room(), "wheelWell", 3, 0.15)).toBe(false);
    // Its centre at y 0.05: inside the room's outline drawn on the walls' centrelines, but under the wall's inner half.
    expect(refusal(room(), place("w", "wheelWell", 3, 0.25))).toMatch(/not inside a room/);
    expect(previews(room(), "wheelWell", 3, 0.25)).toBe(false);
  });

  it("a partition running across it is accepted", () => {
    const split = build(...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "c"), { type: "addWall", opId: "p", from: { at: { x: 3.5, y: 0 } }, to: { at: { x: 3.5, y: 2.5 } } });
    expect(refusal(split, WELL)).toBeNull();
  });

  it("a block (any other piece) over the wall is still refused", () => {
    expect(refusal(room(), place("b", "block", 3, 0.35, { w: 1.8, d: 0.4, h: 0.35 }))).toMatch(/overlaps a wall/);
  });
});

describe("the cover rule (AC-07)", () => {
  const withWell = (): Document => ok(room(), WELL);

  it("a 1.80 × 0.60 × 0.45 bench wholly over the well's part outside the wall is accepted, either placed first", () => {
    expect(refusal(withWell(), place("b", "bench", 3, 0.7, BENCH))).toBeNull();
    expect(previews(withWell(), "bench", 3, 0.7, BENCH)).toBe(true);
    const benchFirst = ok(room(), place("b", "bench", 3, 0.7, BENCH));
    expect(refusal(benchFirst, WELL)).toBeNull();
    expect(previews(benchFirst, "wheelWell", 3, 0.35)).toBe(true);
  });

  it("the bench shifted so the well pokes out is refused, naming the well; so is a piece no taller than the well", () => {
    expect(refusal(withWell(), place("b", "bench", 3.3, 0.7, BENCH))).toMatch(/Wheel well/);
    expect(previews(withWell(), "bench", 3.3, 0.7, BENCH)).toBe(false);
    expect(refusal(withWell(), place("b", "bench", 3, 0.7, { ...BENCH, h: 0.3 }))).toMatch(/Wheel well/);
    expect(refusal(withWell(), place("b", "bench", 3, 0.7, { ...BENCH, h: 0.35 }))).toMatch(/Wheel well/);
  });

  it("a piece above the well, apart from it in height, fits as anything does", () => {
    const cabinet = (doc: Document): Command => ({ type: "placeObject", opId: "s", state: S(doc), object: { kind: "wallCabinet" }, at: { x: 3, y: 0.45 }, deck: null });
    expect(refusal(withWell(), cabinet)).toBeNull(); // hung at 1.40 m, over the well's 0.35
  });
});

describe("in every layout (AC-09)", () => {
  it("placing a well where a piece stands in another layout is refused, naming that piece and layout", () => {
    const two = build(...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "c"), { type: "addState", opId: "n", name: "Night" });
    const byName = (name: string): string => Object.values(two.states).find((s) => s.name === name)?.id ?? "";
    const [day, night] = [byName("Layout"), byName("Night")];
    const withChest = ok(two, () => ({ type: "placeObject", opId: "c", state: night ?? "", object: { kind: "block", size: { w: 0.5, d: 0.5, h: 0.5 } }, at: { x: 3, y: 0.8 }, deck: null, linked: false }));
    const r = execute(withChest, { type: "placeObject", opId: "w", state: day ?? "", object: { kind: "wheelWell" }, at: { x: 3, y: 0.6 }, deck: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/Custom box/);
      expect(r.error.message).toMatch(/Night/);
    }
  });
});

describe("free floor", () => {
  it("a well takes its part outside the wall; under a bench it is counted once", () => {
    const bare = room();
    const area = (doc: Document): number => [...freeFloor(doc, S(doc)).values()][0] ?? 0;
    const well = ok(bare, WELL);
    expect(area(bare) - area(well)).toBeCloseTo(1.8 * 0.25, 6);
    const bench = ok(bare, place("b", "bench", 3, 0.7, BENCH));
    const both = ok(bench, WELL);
    expect(area(both)).toBeCloseTo(area(bench), 6);
  });
});
