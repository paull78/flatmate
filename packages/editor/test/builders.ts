import { EPS, distance, emptyDocument, execute, rectangleRoom, unwrap, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { createLocalDocument } from "../src/document/local-document";
import { initialState, type EditorState } from "../src/state";
import { FakeHost } from "./fake-shell";

/** The demo room (spec §1.4 step 2): 6 × 4 m, corners (0,0) (6,0) (6,4) (0,4), drawn counter-clockwise. */
export function roomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 6, 4)) doc = unwrap(execute(doc, cmd)).doc;
  return doc;
}

/** The demo room with the step 3 divider from (3,0) to (3,4). */
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

/** Demo step 4 as a fixture: the divided room with "Room 1" (L1, left) and "Room 2" (L2, right). */
export function labelledDoc(): Document {
  let doc = dividedRoomDoc();
  doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Room 1" })).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Room 2" })).doc;
}

/** Adds a label outside every room: an orphan (spec §3.6). labelZone refuses this, so it is written directly. */
export function withOrphan(doc: Document, id = "L9", at = { x: 8, y: 6 }, name = "Lost"): Document {
  return { ...doc, zoneLabels: { ...doc.zoneLabels, [id]: { id, at, name } } };
}

/** A 0.15 × 3 m room labelled "Closet" (L1). Too narrow for a 0.20 m wall inset, so its area is unavailable. */
export function narrowRoomDoc(): Document {
  let doc = emptyDocument();
  for (const cmd of rectangleRoom({ x: 0, y: 0 }, 0.15, 3, "narrow")) doc = unwrap(execute(doc, cmd)).doc;
  return unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 0.075, y: 1.5 }, name: "Closet" })).doc;
}
