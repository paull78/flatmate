import { describe, expect, it } from "vitest";
import { stairFits, stairOnEdge, validateDocument, type Command, type Document, type StairRequest } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { MAX_FIXES, stairFixes } from "../src/tools/stair-fixes";
import type { StairFix } from "../src/tools/types";
import { clearRoomDoc, roomDoc, withCommands } from "./builders";

// The fix chips (AC-12, stairdraw.13; spec "Hints and fixes"). The 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9)
// under 3.20, the loft (loft/k0, top 2.15) over x 0.1–1.9: its right edge, x 1.9, catches. From (1.9, 2) a Stair runs
// 2.988 toward +x; its L's landing spans x 3.258–4.158, y 1.55–2.45, the lower flight y 2.45–3.808 (right) or
// 0.192–1.55 (left). Seen from the floor facing the edge (looking −x), the right is +y.
//
//   loft │ ▶ Stair 2.988 ──────────────┤          a box at x 4.2–4.8: 2.30 of free floor, the L still fits
//   x 1.9│ ▶ Storage stair 1.992 ──┤

const base: Command[] = [{ type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.8, name: "Loft" }];
/** The loft room with 0.60 boxes, each given by the middle of its back edge (it faces −y, so it spans y at−0.6 to at). */
function roomWith(...boxes: Point[]): Document {
  const doc = withCommands(
    roomDoc(),
    ...base,
    ...boxes.map((at, i): Command => ({ type: "placeObject", opId: `b${i}`, state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at, rotation: 0, deck: null })),
  );
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  return doc;
}
const ask = (extra: Partial<StairRequest> = {}): StairRequest => ({ state: "s0", kind: "stair", deck: "loft/k0", at: { x: 1.9, y: 2 }, shape: "straight", surface: null, ...extra });
const words = (fixes: readonly StairFix[]): string[] => fixes.map((f) => (f.detail === undefined ? f.label : `${f.label} · ${f.detail}`));
function expectEachFits(doc: Document, fixes: readonly StairFix[]): void {
  for (const f of fixes) {
    const parts = stairOnEdge(doc, f.request);
    if (!parts.ok) throw new Error(`${f.id}: ${parts.error}`);
    expect(stairFits(doc, parts.value, f.request.state)).toEqual({ ok: true, value: null });
    expect(f.request).toMatchObject({ deck: "loft/k0", at: { x: 1.9, y: 2 }, state: "s0", surface: null }); // the same point
  }
}

describe("stairFixes (AC-12)", () => {
  it("a short Stair offers Make it an L, then Storage stair · <run>, …, at most three, each fitting", () => {
    const doc = roomWith({ x: 4.5, y: 2.3 });
    const fixes = stairFixes(doc, ask(), "l-right");
    expect(words(fixes)).toEqual(["Make it an L", "Storage stair · 1.99 m", "Ship's ladder · 1.10 m"]);
    expect(fixes[0]?.request).toEqual(ask({ shape: "l-right" })); // the cursor's side
    expect(fixes.map((f) => f.request.kind)).toEqual(["stair", "storageStair", "shipsLadder"]);
    expect(fixes.length).toBeLessThanOrEqual(MAX_FIXES);
    expectEachFits(doc, fixes);
    // Ids tell the chips apart.
    expect(new Set(fixes.map((f) => f.id)).size).toBe(fixes.length);
  });

  it("› Make it an L takes the other side when the cursor's side doesn't fit", () => {
    // A second box where the right L's lower flight goes (x 3.3–3.9, y 3.0–3.6).
    const doc = roomWith({ x: 4.5, y: 2.3 }, { x: 3.6, y: 3.6 });
    const fixes = stairFixes(doc, ask(), "l-right");
    expect(fixes[0]).toMatchObject({ label: "Make it an L", request: ask({ shape: "l-left" }) });
    expectEachFits(doc, fixes);
  });

  it("› Make it an L prefers the side whose use zones stay free; with both blocked, the cursor's side (stairdraw.60)", () => {
    // Here both L feet end 9 cm from a wall (y 0.192 left, 3.808 right; inner faces y 0.1 and 3.9): both are blocked,
    // so the chip keeps the cursor's side.
    const doc = roomWith({ x: 4.5, y: 2.3 });
    expect(stairFixes(doc, ask(), "l-left")[0]).toMatchObject({ label: "Make it an L", request: ask({ shape: "l-left" }) });
    // A room 1 m taller (inner y 0.1–4.9), the loft over x 0.1–1.9 along its whole left side: the left L's foot is still
    // 9 cm from the bottom wall, the right one's ends at y 3.808 with open floor beyond, so the chip turns right.
    const tall = withCommands(
      clearRoomDoc(5.8, 4.8, "t"),
      { type: "setCeiling", height: 3.2 },
      { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1, y: 2.5 }, w: 1.8, d: 4.8, name: "Loft" },
      { type: "placeObject", opId: "b0", state: "s0", object: { kind: "block", size: { w: 0.6, d: 0.6 } }, at: { x: 4.5, y: 2.3 }, rotation: 0, deck: null },
    );
    expect(validateDocument(tall)).toEqual({ ok: true, value: undefined });
    const fixes = stairFixes(tall, ask(), "l-left");
    expect(fixes[0]).toMatchObject({ label: "Make it an L", request: ask({ shape: "l-right" }) });
    expectEachFits(tall, fixes);
  });

  it("› a kind that doesn't turn offers only other kinds; with 2.00 m of free floor the Stair's own L doesn't fit", () => {
    const doc = roomWith({ x: 4.2, y: 2.3 }); // free floor to x 3.9: the L's landing reaches 4.158
    expect(words(stairFixes(doc, ask(), "l-left"))).toEqual(["Storage stair · 1.99 m", "Ship's ladder · 1.10 m", "Alternating tread · 1.12 m"]);
    const ladder = stairFixes(doc, ask({ kind: "shipsLadder", at: { x: 1.9, y: 2 } }), "l-left");
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((f) => f.request.shape === "straight" && f.request.kind !== "shipsLadder")).toBe(true);
  });

  it("› an L that doesn't fit on the cursor's side offers Turn the other way when the mirror fits", () => {
    // A box at the foot of the right L's lower flight (x 3.6–4.2, y 3.2–3.8), clear of a storage stair's smaller L.
    const doc = roomWith({ x: 3.9, y: 3.8 });
    const fixes = stairFixes(doc, ask({ shape: "l-right" }), "l-right");
    expect(words(fixes)).toEqual(["Turn the other way", "Keep it straight", "Storage stair · L"]);
    expect(fixes.map((f) => f.request.shape)).toEqual(["l-left", "straight", "l-right"]);
    expectEachFits(doc, fixes);
  });

  it("› nothing fits: no chips", () => {
    // A box right at the edge, across the stair's whole width and 2.00 tall, so not even an open stair passes over
    // it: no kind, straight or L, starts there.
    const doc = withCommands(roomWith({ x: 2.2, y: 2.3 }), { type: "setObjectSize", objectId: "b0/o0", w: 0.6, d: { standard: 0.6 }, h: { standard: 2 }, z: { standard: 0 } });
    expect(stairFixes(doc, ask(), "l-right")).toEqual([]);
    expect(stairFixes(doc, ask({ shape: "l-left" }), "l-left")).toEqual([]);
  });
});
