import { anchorAt, footprints, placementRange, quadCentre, sortedIds, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";

// The Day/Night flip's poses (spec: layouts, layout-states.06, .20, heights.29): one tween for the plan and the 3D view.
// Plain data from the document and the flip alone, never editor state, so the 3D view and a native shell can use it.

/**
 * One object during a flip, eased with t²(3 − 2t). An object in both layouts glides: centre, angle (the shorter arc),
 * width, depth, bottom and top move from one configuration's to the other's, and it shows the target configuration.
 * An object in one layout stays in its pose; `only` says which, and `e` lets the plan fade it and the 3D view pop it
 * at e = 0.5. `at` is the back edge's middle, as stored.
 */
export type FlipPose = {
  objectId: string;
  /** The placements the pose runs between: one for a piece in a single layout, both ends otherwise. */
  placementIds: readonly string[];
  kind: string;
  config: string;
  at: Point;
  centre: Point;
  rotation: number;
  w: number;
  d: number;
  bottom: number;
  top: number;
  only: "from" | "to" | null;
  e: number;
};

export type Flip = { from: string; to: string; t: number };

/** The flip's poses, by object id. */
export function flipPoses(doc: Document, flip: Flip): FlipPose[] {
  const e = flip.t * flip.t * (3 - 2 * flip.t);
  const byObject = new Map<string, { from?: Placement; to?: Placement }>();
  for (const id of sortedIds(doc.placements)) {
    const p = doc.placements[id];
    if (!p || (p.state !== flip.from && p.state !== flip.to)) continue;
    const entry = byObject.get(p.object) ?? {};
    if (p.state === flip.from) entry.from = p;
    else entry.to = p;
    byObject.set(p.object, entry);
  }
  const out: FlipPose[] = [];
  for (const objectId of [...byObject.keys()].sort()) {
    const { from, to } = byObject.get(objectId) ?? {};
    const a = from ? still(doc, from) : null;
    const b = to ? still(doc, to) : null;
    if (a && b) {
      const lerp = (x: number, y: number): number => x + (y - x) * e;
      const turn = ((b.rotation - a.rotation + 540) % 360) - 180;
      const centre = { x: lerp(a.centre.x, b.centre.x), y: lerp(a.centre.y, b.centre.y) };
      const rotation = a.rotation + turn * e;
      const d = lerp(a.d, b.d);
      out.push({ ...b, placementIds: [...a.placementIds, ...b.placementIds], centre, rotation, w: lerp(a.w, b.w), d, at: anchorAt(centre, d, rotation), bottom: lerp(a.bottom, b.bottom), top: lerp(a.top, b.top), only: null, e });
    } else if (a) {
      out.push({ ...a, only: "from", e });
    } else if (b) {
      out.push({ ...b, only: "to", e });
    }
  }
  return out;
}

/** A placement's own pose, or null when its object, size or range is missing. */
function still(doc: Document, p: Placement): Omit<FlipPose, "only" | "e"> | null {
  const object = doc.objects[p.object];
  const quad = footprints(doc).get(p.id);
  const centre = quad ? quadCentre(quad) : null;
  const w = object?.w[p.config];
  const d = object?.d[p.config];
  const range = placementRange(doc, p.id);
  if (!object || !centre || w === undefined || d === undefined || !range) return null;
  return { objectId: object.id, placementIds: [p.id], kind: object.kind, config: p.config, at: p.at, centre, rotation: p.rotation, w, d, bottom: range.bottom, top: range.top };
}
