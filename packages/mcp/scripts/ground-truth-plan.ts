import { readFileSync } from "node:fs";
import { deserialize, distanceToSegment, emptyDocument, execute, serialize, sortedIds, unwrap, wallEnds, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";

// The ground-truth plan (import.18, AC-15): a small flat built from domain commands with fixed ids, stored as a project
// document in test/fixtures/ground-truth.json. Claude traces its picture; compare-trace.ts scores the trace against it.
//
//   E (0, 9.25) ──────────── D (5.10, 9.25)
//   │  Bath    │  Bedroom      ╲
//   │          │                C (6.85, 6.95)
//   │          │  door          │
//   ├──────────┴────┬───══──────┤ y = 4.40
//   │  Living       │  Kitchen  ║ window
//   │               │ (0.10 m)  │
//   A (0, 0) ───────┴────────── B (6.85, 0)
//                x = 3.95
//
// Taller than wide, off the 0.5 m grid, one chamfered corner (C–D) and one thin wall, so a wrong y flip, a square
// assumption or a rounded reading changes the comparison.

/** The outer centreline corners, in order: a test oracle for the outer walls. */
export const GROUND_TRUTH_SHELL: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 6.85, y: 0 },
  { x: 6.85, y: 6.95 },
  { x: 5.1, y: 9.25 },
  { x: 0, y: 9.25 },
];

export const GROUND_TRUTH_ROOMS: readonly string[] = ["Living", "Kitchen", "Bath", "Bedroom"];

const FIXTURE = new URL("../test/fixtures/ground-truth.json", import.meta.url);

/** The commands on an empty document, in order; a refused command throws with its index. */
export function build(commands: readonly Command[]): Document {
  return commands.reduce((doc, cmd, i) => {
    const r = execute(doc, cmd);
    if (!r.ok) throw new Error(`ground truth command ${i} (${cmd.type}) refused: ${r.error.message}`);
    return r.value.doc;
  }, emptyDocument());
}

export function groundTruthCommands(): Command[] {
  const shell: Command[] = GROUND_TRUTH_SHELL.map((p, i) => ({
    type: "addWall",
    opId: `gt-shell-${i + 1}`,
    from: { at: p },
    to: { at: GROUND_TRUTH_SHELL[(i + 1) % GROUND_TRUTH_SHELL.length] ?? p },
  }));
  const rooms: Command[] = [
    ...shell,
    { type: "addWall", opId: "gt-across", from: { at: { x: 0, y: 4.4 } }, to: { at: { x: 6.85, y: 4.4 } } },
    { type: "addWall", opId: "gt-kitchen", from: { at: { x: 3.95, y: 0 } }, to: { at: { x: 3.95, y: 4.4 } }, thickness: 0.1 },
    { type: "addWall", opId: "gt-bath", from: { at: { x: 2.6, y: 4.4 } }, to: { at: { x: 2.6, y: 9.25 } } },
    { type: "labelZone", id: "gt-living", at: { x: 1.9, y: 2.2 }, name: "Living", finish: null },
    { type: "labelZone", id: "gt-kitchen-room", at: { x: 5.4, y: 2.2 }, name: "Kitchen", finish: null },
    { type: "labelZone", id: "gt-bath-room", at: { x: 1.3, y: 6.8 }, name: "Bath", finish: null },
    { type: "labelZone", id: "gt-bedroom", at: { x: 4.6, y: 6.8 }, name: "Bedroom", finish: null },
  ];
  // Split walls get ids from the splitting command, so the openings' walls are looked up, never guessed.
  const walls = build(rooms);
  return [
    ...rooms,
    // Kitchen to Bedroom, centred at x = 5.40 on y = 4.40; a window centred on the kitchen's outer wall.
    { type: "addOpening", opId: "gt-door", ...centredOn(walls, { x: 5.4, y: 4.4 }, 0.8), kind: "swing" },
    { type: "addOpening", opId: "gt-window", ...centredOn(walls, { x: 6.85, y: 2.2 }, 1.4), kind: "window" },
    // On the outer faces (the walls' corners at A, B and E), offset outwards along a→b's left normal: 7.05 and 9.45 m.
    { type: "addDimension", opId: "gt-dim-bottom", a: { x: -0.1, y: -0.1 }, b: { x: 6.95, y: -0.1 }, offset: -0.6 },
    { type: "addDimension", opId: "gt-dim-left", a: { x: -0.1, y: -0.1 }, b: { x: -0.1, y: 9.35 }, offset: 0.6 },
  ];
}

/** The wall under `centre` and the offset from its joint a that centres an opening of `width` there. */
function centredOn(doc: Document, centre: Point, width: number): { wall: string; offset: number; width: number } {
  for (const id of sortedIds(doc.walls)) {
    const ends = wallEnds(doc, id);
    if (!ends || distanceToSegment(centre, ends.a, ends.b) > 1e-9) continue;
    const along = Math.hypot(centre.x - ends.a.x, centre.y - ends.a.y);
    return { wall: id, offset: Math.round((along - width / 2) * 1e6) / 1e6, width };
  }
  throw new Error(`no wall under (${centre.x}, ${centre.y})`);
}

/** The fixture file's text: the stored project document, 2-space indented, with a trailing newline. */
export function fixtureText(doc: Document): string {
  return `${JSON.stringify(serialize(doc), null, 2)}\n`;
}

/** The committed ground truth. Reads the fixture when called; the module's only I/O. */
export function loadGroundTruth(): Document {
  return unwrap(deserialize(JSON.parse(readFileSync(FIXTURE, "utf8"))));
}

export const GROUND_TRUTH_FILE = FIXTURE;
