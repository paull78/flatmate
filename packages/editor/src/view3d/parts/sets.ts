import { CHAIR_SIZE, OBJECT_KINDS, configOf, outlineOf, rotateAbout, shapeRing } from "@fm/domain";
import { assertNever, type Point } from "@fm/protocol";
import { aggregateLayout } from "../../view/aggregate";
import { SIT_AND_EAT, chair, roundChair } from "./sit-and-eat";
import type { Appearance, AppearanceTable, Box3, Part } from "./types";

// The aggregates in 3D (seating.15, AC-04): the table's own parts sized to the table, and each chair's own parts turned
// and moved to its pose, from the one layout (`aggregateLayout`, footprint space: y from −d to 0). The local frame here
// is the piece's, centred: y from the front (−d/2) to the back (+d/2), so a footprint point (x, y) is (x, y + d/2).

type Pose = { at: Point; rotation: number };

/** A box's extent turned a quarter counter-clockwise about the origin: (x, y) → (−y, x). */
const quarter = (b: Box3): Box3 => ({ ...b, x0: -b.y1, x1: -b.y0, y0: b.x0, y1: b.x1 });

/**
 * Parts turned by `pose.rotation` (degrees, counter-clockwise) about their own origin, then moved to `pose.at`. A box
 * turned by a multiple of 90° stays a box (its panels stay only unturned: the chair has none); at any other turn it
 * becomes a ring. A cylinder keeps its extent about its turned centre (exact for a round one). An outline becomes `own`,
 * the ring it stands for, turned and moved like a ring.
 */
function posed(parts: readonly Part[], pose: Pose, own: readonly Point[]): Part[] {
  const turn = (p: Point): Point => rotateAbout(p, { x: 0, y: 0 }, pose.rotation);
  const move = (p: Point): Point => ({ x: p.x + pose.at.x, y: p.y + pose.at.y });
  const steps = pose.rotation / 90;
  const quarters = Math.abs(steps - Math.round(steps)) < 1e-9 ? ((Math.round(steps) % 4) + 4) % 4 : null;
  const shift = (b: Box3, by: Point): Box3 => ({ ...b, x0: b.x0 + by.x, x1: b.x1 + by.x, y0: b.y0 + by.y, y1: b.y1 + by.y });
  const ring = (points: readonly Point[], z0: number, z1: number, slot: Part["slot"]): Part => ({ shape: "ring", ring: points.map((p) => move(turn(p))), z0, z1, slot });
  return parts.map((part): Part => {
    switch (part.shape) {
      case "box": {
        const b = part.at;
        if (quarters === null) return ring([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }], b.z0, b.z1, part.slot);
        const turned = Array.from({ length: quarters }).reduce<Box3>((q) => quarter(q), b);
        const panels = quarters === 0 && part.panels ? { panels: part.panels.map((p) => ({ ...p, at: shift(p.at, pose.at) })) } : {};
        return { shape: "box", at: shift(turned, pose.at), slot: part.slot, ...panels };
      }
      case "cylinder": {
        const b = part.at;
        const c = move(turn({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }));
        return { shape: "cylinder", at: shift(b, { x: c.x - (b.x0 + b.x1) / 2, y: c.y - (b.y0 + b.y1) / 2 }), slot: part.slot };
      }
      case "outline":
        return ring(own, part.z0, part.z1, part.slot);
      case "ring":
        return ring(part.ring, part.z0, part.z1, part.slot);
      default:
        return assertNever(part);
    }
  });
}

/**
 * A set's parts: its table's, then each chair's (a chair is as tall as the set, the table's top at most its own height).
 * The table takes the object's options: the desk with chair's computer stands on its desk; the chairs are round chairs
 * with the set's round chairs (library.07).
 */
const setParts = (kind: string): Appearance => (_config, w, d, h, options) => {
  const l = aggregateLayout(kind, w, d);
  if (!l) return [];
  const { w: tw, d: td } = l.tableSize;
  const tableH = Math.min(h, configOf({ kind: l.tableKind }, l.tableConfig)?.h ?? h);
  const table = SIT_AND_EAT.get(l.tableKind)?.(l.tableConfig, tw, td, tableH, options) ?? []; // the desk's computer (seating.12)
  const own = shapeRing(outlineOf(l.tableKind), tw, td).map((p) => ({ x: p.x, y: p.y + td / 2 }));
  const local = (p: Point): Point => ({ x: p.x, y: p.y + d / 2 });
  const one = (options?.roundChairs === true ? roundChair : chair)(CHAIR_SIZE.w, CHAIR_SIZE.d, h);
  const chairs = l.chairs.flatMap((c) => {
    const centre = rotateAbout({ x: c.at.x, y: c.at.y - CHAIR_SIZE.d / 2 }, c.at, c.rotation);
    return posed(one, { at: local(centre), rotation: c.rotation }, []);
  });
  return [...posed(table, { at: local({ x: l.tableAt.x, y: l.tableAt.y - td / 2 }), rotation: 0 }, own), ...chairs];
};

/** Every aggregate kind's appearance, keyed by kind like the other groups' tables. */
export const SETS: AppearanceTable = new Map(OBJECT_KINDS.flatMap((k): [string, Appearance][] => (k.aggregate ? [[k.id, setParts(k.id)]] : [])));
