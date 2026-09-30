import type { Document } from "../src/model";

type Spec = {
  joints?: [id: string, x: number, y: number][];
  walls?: [id: string, a: string, b: string][];
  labels?: [id: string, x: number, y: number, name: string][];
};

/** Builds a document from compact tuples; no validation. */
export function docOf(spec: Spec): Document {
  const doc: Document = { joints: {}, walls: {}, zoneLabels: {} };
  for (const [id, x, y] of spec.joints ?? []) doc.joints[id] = { id, x, y };
  for (const [id, a, b] of spec.walls ?? []) doc.walls[id] = { id, a, b };
  for (const [id, x, y, name] of spec.labels ?? []) doc.zoneLabels[id] = { id, at: { x, y }, name };
  return doc;
}

/** A closed rectangle J1(x0,y0) J2(x1,y0) J3(x1,y1) J4(x0,y1), walls W1..W4 counter-clockwise. */
export function rectDoc(x0: number, y0: number, x1: number, y1: number): Document {
  return docOf({
    joints: [["J1", x0, y0], ["J2", x1, y0], ["J3", x1, y1], ["J4", x0, y1]],
    walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"]],
  });
}

/** Freezes a value and everything reachable from it: any write then throws (modules run in strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    const children: unknown[] = Object.values(value);
    for (const child of children) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
