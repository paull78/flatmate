import { EPS, distance, emptyDocument, execute, rectangleRoom, sheetsOf, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { createLocalDocument } from "../src/document/local-document";
import { initialState, type EditorState } from "../src/state";
import { FakeHost } from "./fake-shell";

/** The sample room (docs/try-it.md step 2): 6 × 4 m, corners (0,0) (6,0) (6,4) (0,4), drawn counter-clockwise. */
export function roomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 6, 4)) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

/**
 * The sample room with four niches cut by pairs of 0.20 m fins, each fin a T off a room wall's centre line (still one
 * room): T, a wardrobe niche x 1.1–2.3, y 3.3–3.9 open at the bottom; L x 0.1–0.7, y 1.1–2.3 open at the right;
 * R x 5.3–5.9, y 1.1–2.3 open at the left; B, a bed alcove x 3.1–4.0, y 0.1–2.1 open at the top.
 */
export function nichesDoc(): Document {
  const fin = (opId: string, from: Point, to: Point): Command => ({ type: "addWall", opId, from: { at: from }, to: { at: to } });
  return withCommands(
    roomDoc(),
    fin("t1", { x: 1, y: 4 }, { x: 1, y: 3.3 }), fin("t2", { x: 2.4, y: 4 }, { x: 2.4, y: 3.3 }),
    fin("l1", { x: 0, y: 1 }, { x: 0.7, y: 1 }), fin("l2", { x: 0, y: 2.4 }, { x: 0.7, y: 2.4 }),
    fin("r1", { x: 6, y: 1 }, { x: 5.3, y: 1 }), fin("r2", { x: 6, y: 2.4 }, { x: 5.3, y: 2.4 }),
    fin("b1", { x: 3, y: 0 }, { x: 3, y: 2.1 }), fin("b2", { x: 4.1, y: 0 }, { x: 4.1, y: 2.1 }),
  );
}

/**
 * A room whose clear floor is `w` × `h`: a rectangle of `w + 0.2` × `h + 0.2` from the origin with 0.20 m walls, so its
 * inner faces are x 0.1 / w + 0.1 and y 0.1 / h + 0.1. Walls `${prefix}-1/w0` bottom, `-2/w0` right, `-3/w0` top, `-4/w0` left.
 */
export function clearRoomDoc(w: number, h: number, prefix: string): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, w + 0.2, h + 0.2, prefix)) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

/** The sample room with the step 3 divider from (3,0) to (3,4). */
export function dividedRoomDoc(): Document {
  return unwrap(execute(roomDoc(), { type: "addWall", opId: "div", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } })).doc;
}

/** One free-standing wall. */
export function wallDoc(from: Point, to: Point): Document {
  return unwrap(execute(emptyDocument(), { type: "addWall", opId: "w", from: { at: from }, to: { at: to } })).doc;
}

export function jointAt(doc: Document, p: Point): string {
  const found = Object.values(doc.joints).find((j) => distance(j, p) < EPS);
  if (!found) throw new Error(`No joint at (${p.x}, ${p.y})`);
  return found.id;
}

export function wallBetween(doc: Document, p: Point, q: Point): string {
  const a = jointAt(doc, p);
  const b = jointAt(doc, q);
  const found = Object.values(doc.walls).find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  if (!found) throw new Error(`No wall between (${p.x}, ${p.y}) and (${q.x}, ${q.y})`);
  return found.id;
}

export function pointOf(doc: Document, jointId: string): Point {
  const j = doc.joints[jointId];
  if (!j) throw new Error(`No joint ${jointId}`);
  return { x: j.x, y: j.y };
}

/** A local-mode editor state (viewport 1200 × 800) whose unsaved document starts as `doc`; takes no ID from `host`. */
export function localState(host: FakeHost, doc: Document = emptyDocument()): EditorState {
  const s = initialState({ mode: "local", me: { clientId: "tab1", name: "Alice" }, viewport: { width: 1200, height: 800 }, dpr: 1 }, new FakeHost());
  return { ...s, document: createLocalDocument({ id: "local", name: "Untitled" }, "open1", doc) };
}

/** A server-mode editor state: no document, project list loading. */
export function serverState(host: FakeHost): EditorState {
  return initialState({ mode: "server", me: { clientId: "tab1", name: "Alice" }, viewport: { width: 1200, height: 800 }, dpr: 1 }, host);
}

/** Try it step 4 as a fixture: the divided room with "Room 1" (L1, left) and "Room 2" (L2, right). */
export function labelledDoc(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1", finish: null })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2", finish: null })).doc;
}

/** The wall on `loftWallDoc`'s loft. */
export const LOFT_WALL = "lw/w0";

/**
 * labelledDoc under a 5.20 m ceiling with "Room 1"'s walls sage, a Loft at 2.45 over Room 1 (x 0.1–2.9, y 0.1–3.9) and
 * a wall standing on the loft at x 1.5 (spec: levels): the editor's small copy of the domain's levels fixture, whose test
 * folder another package may not import.
 */
export function loftWallDoc(): Document {
  return withCommands(labelledDoc(),
    { type: "setRoomWallFinishes", labelId: "L1", part: "finish", finish: { motif: "plain", colour: "#a8b59a", strength: 0, size: 0, angle: 0 } },
    { type: "setCeiling", height: 5.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.5, y: 2 }, w: 2.8, d: 3.8, top: 2.45 },
    { type: "addWall", opId: "lw", from: { at: { x: 1.5, y: 0.1 } }, to: { at: { x: 1.5, y: 3.9 } }, base: "loft/k0" });
}

/** Adds a label outside every room: an orphan (spec: walls-rooms). labelZone refuses this, so it is written directly. */
export function withOrphan(doc: Document, id = "L9", at = { x: 8, y: 6 }, name = "Lost"): Document {
  return { ...doc, zoneLabels: { ...doc.zoneLabels, [id]: { id, at, name, finish: null } } };
}

/** A 0.15 × 3 m room labelled "Closet" (L1). Too narrow for a 0.20 m wall inset, so its area is unavailable. */
export function narrowRoomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 0.15, 3, "narrow")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 0.075, y: 1.5 }, name: "Closet", finish: null })).doc;
}

/**
 * The sample room (6 × 4) with two layouts: "Layout" (s0) holds a bed anchored at (1.5, 3), the middle of its back
 * edge — x 0.7–2.3, y 1–3, centre (1.5, 2) — and "Night" (n/s0) is empty. Built through domain commands.
 */
export function studioDoc(): Document {
  let doc = roomDoc();
  doc = unwrap(execute(doc, { type: "addState", opId: "n", name: "Night" })).doc;
  return withCommands(
    doc,
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 1.5, y: 3 }, linked: false }, // in Layout only (review.11)
    bed160x200("bed/o0"),
  );
}

/** Resizes a bed to 1.60 × 2.00, the default before smart's presets: pins fixtures whose numbers assume it. */
export function bed160x200(objectId: string): Command {
  return { type: "setObjectSize", objectId, w: 1.6, d: { standard: 2 } };
}

/** Resizes a sofa bed to 2.00 wide in both configurations (0.90 / 1.60 deep), the default before smart's presets. */
export function sofaBed200(objectId: string): Command {
  return { type: "setObjectSize", objectId, w: 2, d: { sofa: 0.9, bed: 1.6 } };
}

/**
 * A 300 × 120 px picture, so 3.00 × 1.20 m at the provisional 0.01 m/px, with its top-left at the off-grid point
 * (-1.373, 5.217); the data is fake base64. Its rectangle is x −1.373 to 1.627, y 4.017 to 5.217.
 */
export function underlayCommand(overrides: Partial<Extract<Command, { type: "placeUnderlay" }>> = {}): Command {
  return { type: "placeUnderlay", pictureId: "pic1", data: "QUFB", width: 300, height: 120, at: { x: -1.373, y: 5.217 }, ...overrides };
}

/** `doc` with underlayCommand()'s picture. */
export function underlayDoc(doc: Document = roomDoc()): Document {
  return withCommands(doc, underlayCommand());
}

/** The loft of `loftRoomDoc`. */
export const LOFT_ROOM_LOFT = "loft/k0";

/**
 * A room with a loft (pillars): roomDoc's 6 × 4 shell (faces x 0.1–5.9, y 0.1–3.9) under a 3.05 ceiling (the floor's cut
 * 1.20), with a hollow Loft at 2.15 over x 1.3–3.7, y 1.4–3.8 (underside 2.03; its level's cut 2.60).
 */
export function loftRoomDoc(): Document {
  return withCommands(roomDoc(), { type: "setCeiling", height: 3.05 }, { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 });
}

/** Runs domain commands on `doc` in order; a fixture helper. */
export function withCommands(doc: Document, ...cmds: Command[]): Document {
  return cmds.reduce((d, cmd) => unwrap(execute(d, cmd)).doc, doc);
}

/** The sample room with a Night layout (n/s0) and a bed placed only in Night, anchored at (5, 3): x 4.2–5.8, y 1–3. */
export function nightBedDoc(): Document {
  return withCommands(
    roomDoc(),
    { type: "addState", opId: "n", name: "Night" },
    { type: "placeObject", linked: false, deck: null, opId: "bed", state: "n/s0", object: { kind: "bed" }, at: { x: 5, y: 3 } },
    bed160x200("bed/o0"),
  );
}


/** Apartment A (10 × 8 m, 0.20 m walls) with Core C, a free-standing 3 × 3 m group at (3.5, 2.5)–(6.5, 5.5): net area 66.20 m², core interior 7.84 m² (holes contract). */
export function donutDoc(): Document {
  return withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 10, 8, "apt"), ...rectangleRoom({ x: 3.5, y: 2.5 }, 3, 3, "core"));
}

/** Heights that collide like the 2D fit did: a 1.00 m box on the floor meets every floor piece and wall (heights.12). */
export const ON_FLOOR = { h: 1, z: 0 } as const;

/**
 * The sample scene's cabin (stairwell.12, .21): a 4 × 3 room (wall faces x 0.1–3.9, y 0.1–2.9), a 3.05 ceiling and a
 * Loft (2.15, hollow) loft/k0 at x 0.1–2.1 over the whole depth.
 */
export function cabinDoc(): Document {
  return withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 4, 3, "cabin"), { type: "setCeiling", height: 3.05 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.1, y: 1.5 }, w: 2, d: 2.8, top: 2.15 });
}

/** The cabin with the notch notch/h0 cut in the loft's north-east corner: x 1.40–2.10, y 2.25–2.90. */
export function notchedCabinDoc(): Document {
  return withCommands(cabinDoc(), { type: "addDeckHole", opId: "notch", deck: "loft/k0", at: { x: 1.75, y: 2.575 }, w: 0.7, d: 0.65 });
}

/** Every sheet with its Floor finishes off: the PDF's finishes are each sheet's own (sheetset.21). */
export function withoutSheetFinishes(doc: Document): Document {
  return withCommands(doc, ...sheetsOf(doc).map((s): Command => ({ type: "setSheet", sheetId: s.id, finishes: false })));
}
