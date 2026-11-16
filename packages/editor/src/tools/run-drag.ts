import { dot, incidentWalls, normalize, perpLeft, roundMm, scale, sub, wallRunOf, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roundTo } from "../snapping/policies";
import { acrossSnap, type ViewBox } from "../snapping/across";
import type { Mods, SnapResult } from "../types";
import type { DragTarget } from "./types";

// A wall drag moves the wall's straight run (straight.02); a connected run only across itself (straight.03), Ctrl
// dropping the snaps but keeping the axis and the millimetre (straight.04). A free run moves like an object.

/** The walls target for a press on wall `wallId`: its run, and the run's unit normal when the run is connected. */
export function wallsTarget(doc: Document, wallId: string): DragTarget {
  const wallIds = wallRunOf(doc, wallId);
  return { kind: "walls", wallIds, placementIds: [], across: connected(doc, wallIds) ? runNormal(doc, wallIds) : null };
}

/** Whether any joint of the run has a wall outside it. */
function connected(doc: Document, wallIds: readonly string[]): boolean {
  const run = new Set(wallIds);
  return wallIds.some((id) => {
    const w = doc.walls[id];
    return w !== undefined && [w.a, w.b].some((j) => incidentWalls(doc, j).some((other) => !run.has(other)));
  });
}

/** The left normal of the run's line, from its first wall's far end to its last wall's far end. */
function runNormal(doc: Document, wallIds: readonly string[]): Point | null {
  const first = doc.walls[wallIds[0] ?? ""];
  const a = first ? doc.joints[first.a] : undefined;
  const b = first ? doc.joints[first.b] : undefined;
  const dir = a && b ? normalize(sub(b, a)) : null;
  return dir ? perpLeft(dir) : null;
}

/** A point rounded to the millimetre. */
export function mmPoint(p: Point): Point {
  return { x: roundMm(p.x), y: roundMm(p.y) };
}

/**
 * What a walls drag tries for the pointer's movement `raw`: a connected run without Ctrl lines up with a parallel
 * wall in range (snapping/across.ts) before the grid; else `wallsDelta`.
 */
export function wallsTry(doc: Document, target: Extract<DragTarget, { kind: "walls" }>, raw: Point, step: number, mods: Mods, tolerance: number, box: ViewBox): { by: Point; snap: SnapResult | null } {
  const lined = target.across && !mods.ctrl ? acrossSnap(doc, target.wallIds, target.across, dot(raw, target.across), tolerance, box) : null;
  if (lined && target.across) return { by: scale(target.across, lined.distance), snap: lined.snap };
  return { by: wallsDelta(target, raw, step, mods), snap: null };
}

/**
 * The delta a walls drag tries for the pointer's movement `raw`: along `across` only, rounded to the step (to the
 * millimetre with Ctrl); with no `across`, the larger axis with Shift and each axis rounded to the step.
 */
export function wallsDelta(target: Extract<DragTarget, { kind: "walls" }>, raw: Point, step: number, mods: Mods): Point {
  if (target.across) {
    const along = dot(raw, target.across);
    return mmPoint(scale(target.across, mods.ctrl ? along : roundTo(along, step)));
  }
  const constrained = !mods.shift ? raw : Math.abs(raw.x) >= Math.abs(raw.y) ? { x: raw.x, y: 0 } : { x: 0, y: raw.y }; // the larger axis
  return mods.ctrl ? mmPoint(constrained) : { x: roundTo(constrained.x, step), y: roundTo(constrained.y, step) };
}

/**
 * The delta for a distance typed during a walls drag (straight.20): `metres` along the run's normal on the side the
 * pointer moved to, or, for a free run or a group, along the larger axis of the pointer's movement `raw`. Null while
 * the pointer hasn't moved that way yet: the value waits.
 */
export function typedDelta(target: Extract<DragTarget, { kind: "walls" }>, raw: Point, metres: number): Point | null {
  if (target.across) {
    const side = Math.sign(dot(raw, target.across));
    return side === 0 ? null : mmPoint(scale(target.across, side * metres));
  }
  if (raw.x === 0 && raw.y === 0) return null;
  return Math.abs(raw.x) >= Math.abs(raw.y) ? { x: Math.sign(raw.x) * metres, y: 0 } : { x: 0, y: Math.sign(raw.y) * metres };
}
