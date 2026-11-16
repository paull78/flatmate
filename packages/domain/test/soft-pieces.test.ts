import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { kindOf } from "../src/kinds";
import type { Document } from "../src/model";
import { freeFloor } from "../src/queries/free-floor";
import { fromStored, toStored } from "../src/shape-tables";
import { pieceArea } from "../src/shapes";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// The pieces with a soft outline (symbols.01): what is drawn is what fits and what free floor counts, and a stored piece
// stays valid.

const BOX = { w: { standard: 0.1 }, d: { standard: 0.1 } };
const STAND_SIZE = { w: { standard: 0.45 }, d: { standard: 0.4 } };

/** A 0.10 box 5 mm into the front-left corner of a 0.45 × 0.40 piece at (2, 2): x 1.775–2.225, y 1.6–2. */
const besideCorner = (doc: Document) => place(doc, { object: "box", kind: "block", at: [1.73, 1.605], size: BOX });

describe("a nightstand's soft outline", () => {
  it("has the soft outline and no heavier front", () => {
    expect(kindOf("nightstand")).toMatchObject({ outline: "soft", front: false });
  });

  it("leaves its corner free: a box fits there, and collides with a rectangle at the same place (AC-11)", () => {
    const room = rectDoc(0, 0, 4, 4);
    const soft = besideCorner(place(room, { object: "n", kind: "nightstand", at: [2, 2] }));
    const square = besideCorner(place(room, { object: "n", kind: "block", at: [2, 2], size: STAND_SIZE }));
    expect(validateDocument(soft).ok).toBe(true);
    expect(validateDocument(square).ok).toBe(false);
  });

  it("a pan leaves its front corner free too: a box fits there, and collides with a rectangle (AC-11)", () => {
    // A 0.36 × 0.54 WC at (2, 2): x 1.82–2.18, y 1.46–2. A 0.10 box 2 cm into its rectangle's front-left corner.
    const room = rectDoc(0, 0, 4, 4);
    const box = (doc: Document) => place(doc, { object: "box", kind: "block", at: [1.79, 1.48], size: BOX });
    const pan = box(place(room, { object: "wc", kind: "toilet", at: [2, 2] }));
    const square = box(place(room, { object: "wc", kind: "block", at: [2, 2], size: { w: { standard: 0.36 }, d: { standard: 0.54 } } }));
    expect(validateDocument(pan).ok).toBe(true);
    expect(validateDocument(square).ok).toBe(false);
  });

  it("takes its ring's area from the free floor (AC-11)", () => {
    const room = rectDoc(0, 0, 4, 4);
    const free = (doc: Document) => [...freeFloor(doc, "s0").values()][0] ?? NaN;
    const soft = free(place(room, { object: "n", kind: "nightstand", at: [2, 2] }));
    const square = free(place(room, { object: "n", kind: "block", at: [2, 2], size: STAND_SIZE }));
    expect(soft - square).toBeCloseTo(0.45 * 0.4 - pieceArea("nightstand", 0.45, 0.4), 6);
    expect(soft).toBeGreaterThan(square);
  });

  it.each([
    ["nightstand", 0.5, 0.45],
    ["toilet", 0.4, 0.65],
    ["toilet", 0.45, 0.6],
    ["bidet", 0.4, 0.55],
    ["washbasin", 0.6, 0.45],
    ["washbasin", 0.8, 0.5],
  ] as const)("a stored %s at %s × %s stays valid and keeps its size, in a saved drawing too (AC-12)", (kind, w, d) => {
    const old = place(rectDoc(0, 0, 4, 4), { object: "n", kind, at: [2, 2], size: { w: { standard: w }, d: { standard: d } } });
    expect(validateDocument(old).ok).toBe(true);
    const back = unwrap(fromStored(toStored(old)));
    expect(validateDocument(back).ok).toBe(true);
    expect(back.objects.n).toMatchObject({ kind, w: { standard: w }, d: { standard: d } });
  });

  it("a stored piece flush against a wall and a neighbour stays valid, since a ring is inside its rectangle (AC-12)", () => {
    // Room faces at 0.1 and 3.9. A stored 0.40 × 0.65 toilet flush with the top wall, a block flush with its right side.
    let doc = place(rectDoc(0, 0, 4, 4), { object: "wc", kind: "toilet", at: [2, 3.9], size: { w: { standard: 0.4 }, d: { standard: 0.65 } } });
    doc = place(doc, { object: "b", kind: "block", at: [2.45, 3.9], size: { w: { standard: 0.5 }, d: { standard: 0.5 } } });
    expect(validateDocument(doc).ok).toBe(true);
  });
});
