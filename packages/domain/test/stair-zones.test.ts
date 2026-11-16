import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { stairZonesFree } from "../src/commands/place-stair";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { stairOnEdge, type StairRequest } from "../src/queries/stair-edge";
import { rectangleRoom } from "../src/scripts";

// Whether an L keeps its use zones free (stairdraw.40, .60): a 5 × 5 room (inner x 0.1–4.9, y 0.1–4.9) under 3.20 with
// a loft at +2.15 across its top, y 3.3–4.9, so its bottom edge y 3.3 runs wall to wall. A Stair's L at x 2.00 splits
// 12 risers 6 + 6: its lower flight is 1.358 long. Turned left it runs from the landing's left side (x 1.55) to x 0.19,
// its foot 9 cm from the wall, so its front zone runs into the wall; turned right it ends at x 3.81, in open floor.
//
//   ═════════ loft edge y 3.3 ═════════
//   |▓▓ zone │ UP ◄ │LAND│     l-left: the zone is in the wall
//   x 0.1                    │LAND│ ► UP │ zone    l-right: free

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const room = (): Document =>
  run(emptyDocument(), [
    ...rectangleRoom({ x: 0, y: 0 }, 5, 5, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 4.1 }, w: 4.8, d: 1.6, name: "Loft" },
    { type: "addState", opId: "n", name: "Night" },
  ]);
const ask = (shape: StairRequest["shape"], x = 2): StairRequest => ({ state: "s0", kind: "stair", deck: "loft/k0", at: { x, y: 3.3 }, shape, surface: null });
const free = (doc: Document, req: StairRequest): boolean => stairZonesFree(doc, unwrap(stairOnEdge(doc, req)), req.state);

describe("stairZonesFree (stairdraw.60)", () => {
  it("an L whose lower flight ends by a wall has its zone blocked; the other way it is free", () => {
    const doc = room();
    expect(free(doc, ask("l-left"))).toBe(false);
    expect(free(doc, ask("l-right"))).toBe(true);
  });

  it("a straight flight whose foot is 21 cm from the wall has its front zone blocked", () => {
    expect(free(room(), ask("straight"))).toBe(false); // its 2.988 run ends at y 0.312
  });

  it("leaves the document as it was", () => {
    const doc = room();
    const before = JSON.stringify(doc);
    free(doc, ask("l-left"));
    expect(JSON.stringify(doc)).toBe(before);
  });
});
