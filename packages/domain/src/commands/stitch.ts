import type { EntityKey } from "@fm/protocol";
import { domainError, type DomainError } from "../errors";
import { metres } from "../format";
import { incidentWalls } from "../graph";
import type { Document, Opening, Wall } from "../model";
import { isStraightJoint, kinkAngle } from "../queries/runs";
import { sideFinishes, type ShownSide } from "../queries/side-finishes";
import { sameSide } from "../wall-sides";
import { rehost, runFrom } from "./split-openings";

// Stitching (straight.05, .17): a straight joint (exactly two walls, in line) between walls that match becomes one wall.
// `deleteEntities` stitches the joints a deleted wall left behind, and joins a selected straight joint instead of
// deleting its walls. Matching compares what each side shows (`sideFinishes`), face to face, on the document after
// the delete; the piece that keeps its joint a survives (the original wall after a T split; the lower id on a tie) with
// its id, sense and stored sides, and every opening keeps its place in the world. A survivor that keeps its a means a
// door added on it meanwhile stays put, and one added on the other piece makes the server refuse the stitch (straight.35).

/** Joints at most this far out of line still name their angle when refused (spec M2). */
const NEAR_STRAIGHT_DEG = 1;

/** The two walls at a straight joint, the survivor first: the one whose joint b is the joint (its a stays), else the lower id. */
function straightPair(doc: Document, jointId: string): [Wall, Wall] | null {
  if (!isStraightJoint(doc, jointId)) return null;
  const [p, q] = incidentWalls(doc, jointId).map((id) => doc.walls[id]);
  if (!p || !q || p.column || q.column) return null;
  return q.b === jointId && p.b !== jointId ? [q, p] : [p, q];
}

/** The shown side of `wall` facing the same way as `side` of `survivor`: swapped when the walls run opposite ways. */
function facing(doc: Document, survivor: Wall, other: Wall, jointId: string, side: "left" | "right"): ShownSide | null {
  const sameSense = (survivor.a === jointId) === (other.b === jointId); // survivor leaves the joint as the other arrives
  const shown = sideFinishes(doc, other.id);
  return (sameSense ? shown?.[side] : shown?.[side === "left" ? "right" : "left"]) ?? null;
}

/** Why two walls at a straight joint don't match, in people's words, or null when they do. */
export function stitchMismatch(doc: Document, jointId: string): string | null {
  const pair = straightPair(doc, jointId);
  if (!pair) return null;
  const [p, q] = pair;
  if (Math.abs(p.thickness - q.thickness) > 1e-9) return `The walls differ in thickness (${metres(p.thickness)} and ${metres(q.thickness)} m)`;
  if (p.top !== q.top || p.base !== q.base) return "The walls differ in height";
  const own = sideFinishes(doc, p.id);
  for (const side of ["left", "right"] as const) {
    const mine = own?.[side] ?? null;
    if (!sameSide(mine, facing(doc, p, q, jointId, side))) {
      const label = mine?.room === null || mine?.room === undefined ? undefined : doc.zoneLabels[mine.room];
      return `The walls differ in finish on the ${label ? `${label.name} side` : "outside"}`;
    }
  }
  return null;
}

/** The refusal for Delete on a joint with two walls up to 1° out of line, or null. */
export function nearStraightRefusal(doc: Document, jointId: string): DomainError | null {
  const apart = kinkAngle(doc, jointId);
  if (apart === null || isStraightJoint(doc, jointId) || apart > NEAR_STRAIGHT_DEG || apart === 0) return null;
  const text = apart < 0.01 ? "less than 0.01°" : `${apart.toFixed(2)}°`;
  return domainError("invalid", `These walls are ${text} out of line: move one side to line them up`);
}

/**
 * `doc` with the straight joint `jointId` stitched: one wall (the lower id, keeping its sense and sides), the joint
 * and its dimensions gone, the openings of both rehosted at their world places. Null when the joint isn't straight or
 * the walls don't match. Dependencies: both walls, their far joints and the openings on them.
 */
export function stitchJoint(doc: Document, jointId: string, deps: EntityKey[]): Document | null {
  const pair = straightPair(doc, jointId);
  if (!pair || stitchMismatch(doc, jointId) !== null) return null;
  const [p, q] = pair;
  const farP = p.a === jointId ? p.b : p.a;
  const farQ = q.a === jointId ? q.b : q.a;
  const merged: Wall = p.a === jointId ? { ...p, a: farQ } : { ...p, b: farQ };
  const [ma, mb] = [doc.joints[merged.a], doc.joints[merged.b]];
  if (!ma || !mb) return null;
  const to = runFrom(ma, mb);
  const openings: Record<string, Opening> = { ...doc.openings };
  for (const o of Object.values(doc.openings)) {
    const host = o.wall === p.id ? p : o.wall === q.id ? q : null;
    const [a, b] = host ? [doc.joints[host.a], doc.joints[host.b]] : [];
    if (!host || !a || !b) continue;
    openings[o.id] = rehost(o, runFrom(a, b), to, p.id);
    deps.push({ table: "openings", id: o.id });
  }
  const walls = { ...doc.walls, [p.id]: merged };
  delete walls[q.id];
  const joints = { ...doc.joints };
  delete joints[jointId];
  const dimensions = { ...doc.dimensions };
  for (const d of Object.values(doc.dimensions)) {
    if ([d.a, d.b].some((end) => "joint" in end && end.joint === jointId)) {
      delete dimensions[d.id];
      deps.push({ table: "dimensions", id: d.id });
    }
  }
  deps.push({ table: "walls", id: p.id }, { table: "walls", id: q.id }, { table: "joints", id: jointId }, { table: "joints", id: farP }, { table: "joints", id: farQ });
  return { ...doc, walls, joints, openings, dimensions };
}
