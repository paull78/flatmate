import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { rectangleRoom } from "../src/scripts";

// The sample scene's cabin (stairwell.12, .21): a 4 × 3 room (wall faces x 0.1–3.9, y 0.1–2.9), a 3.05 ceiling and a
// Loft (top 2.15, hollow, underside 2.03) at x 0.1–2.1 over the whole depth; the notch is x 1.40–2.10, y 2.25–2.90.

export const LOFT = "loft/k0";
export const NOTCH = { at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 };

export function run(doc: Document, ...commands: Command[]): Document {
  return commands.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

export function cabinDoc(): Document {
  return run(emptyDocument(),
    ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "cabin"),
    { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 });
}

/** The cabin with the notch cut, hole `notch/h0`. */
export function notchedCabin(): Document {
  return run(cabinDoc(), { type: "addDeckHole", opId: "notch", deck: LOFT, ...NOTCH });
}
