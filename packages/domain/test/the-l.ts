import { rectangleRoom } from "../src/scripts";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";

// The L (AC-07, stairs.49), as commands so every package's tests can build it: a 4.8 × 2.3 room (inner faces x 0.1 and
// 4.9, y 0.1 and 2.4) under a 3.20 ceiling, so the floor's cut is 1.20.
//   loft      loft/k0  hollow, top 2.15, x 3.0–4.9, y 0.1–2.4
//   platform  plat/k0  solid, 0.90 × 0.90, top 1.08, x 0.73–1.63, y 1.5–2.4: the landing, below the cut, not a level
//   flight 1  f1/o0    a stair on the floor rising +y (rotation 0), 0.90 × 1.35, x 0.73–1.63, y 0.15–1.5: its back edge
//                      on the platform's bottom edge, placed reaching the platform: 6 risers of 0.180
//   flight 2  f2/o0    a stair rising +x (rotation 270), 0.90 × 1.37, x 1.63–3.0, y 1.5–2.4: its front edge on the
//                      platform's right edge and its back edge on the loft's left edge, placed reaching the loft;
//                      `startingAtPlatform` makes it start at the platform: a rise of 1.07, 6 risers of 0.178, going 0.274
// Links are explicit (stairdraw.08): touching an edge sets none. Only placeStair's L sets startsAt, and this hand-built
// L isn't one, so the fixture writes it directly. PLACED_L is the L placeStair makes in the same room.
export const LOFT = "loft/k0";
export const PLATFORM = "plat/k0";

export const L_ROOM: readonly Command[] = [
  ...rectangleRoom({ x: 0, y: 0 }, 5, 2.5, "lr"),
  { type: "setCeiling", height: 3.2 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 3.95, y: 1.25 }, w: 1.9, d: 2.3, name: "Loft" },
  { type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.18, y: 1.95 }, w: 0.9, d: 0.9, top: 1.08, name: "Platform" },
];

export const FLIGHT_1: Command = { type: "placeObject", opId: "f1", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 1.35 } }, at: { x: 1.18, y: 1.5 }, rotation: 0, deck: null, reaches: PLATFORM };

/** Flight 2 of `kind` (a stair by default). */
export const flight2 = (kind = "stair"): Command => ({ type: "placeObject", opId: "f2", state: "s0", object: { kind, size: { w: 0.9, d: 1.37 } }, at: { x: 3, y: 1.95 }, rotation: 270, deck: null, reaches: LOFT });

/** `doc` with flight 2 (or `objectId`) starting at the platform, written directly. */
export function startingAtPlatform(doc: Document, objectId = "f2/o0"): Document {
  const o = doc.objects[objectId];
  if (!o) throw new Error(`no ${objectId}`);
  return { ...doc, objects: { ...doc.objects, [objectId]: { ...o, startsAt: PLATFORM } } };
}

/** The whole L: the room, the decks and both flights; `startingAtPlatform` completes it. */
export const THE_L: readonly Command[] = [...L_ROOM, FLIGHT_1, flight2()];

/**
 * The L placeStair makes (stairdraw step 05) in L_ROOM without the platform: l-right at (3.00, 1.93) on the loft's left
 * edge. The upper flight ps/s0/o0 rises +x (x 1.642–3.0, 6 risers from the landing), the landing ps/k0 is 0.90 square
 * at +1.075 (x 0.742–1.642), and the lower flight ps/s1/o0 runs −y off the landing's bottom edge (6 risers).
 */
export const PLACED_L: readonly Command[] = [
  ...L_ROOM.filter((c) => !(c.type === "addDeck" && c.opId === "plat")),
  { type: "placeStair", opId: "ps", state: "s0", kind: "stair", deck: LOFT, at: { x: 3, y: 1.93 }, shape: "l-right", surface: null },
];
