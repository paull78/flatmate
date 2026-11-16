import { assertNever, type Point } from "@fm/protocol";
import { placer, turner } from "../local-frame";
import { prism, sideShade } from "../prism";
import type { Shades, Style3d } from "../style";
import type { Face3d, PieceItem, Point3, Ring } from "../types";
import { appearanceOf } from "./index";
import type { Box3, Panel, Part } from "./types";

// A furniture piece's parts placed in the world (parts.09): each part a convex prism with its panels after it, every
// face wound from outside (real3d.09). Every face keeps the piece's owner.

/** One placed part: its plan ring and absolute range, its faces (the prism's sides, its top, its panels), and the panels apart. */
export type PartSolid = { key: string; ring: Ring; bottom: number; top: number; faces: Face3d[]; panels: Face3d[] };

const CYLINDER_SIDES = 12;
/** m: how far a panel stands off its face, well inside AC-01's 1 mm (the stairs' cubby doors stand 2 mm off theirs). */
const PANEL_PROUD = 0.0005;
/** m: each further panel a panel stands on adds this much, so two stacked panels stay under 1 mm (real3d.16). */
const PANEL_STEP = 0.00025;

function ringOf(part: Part, item: PieceItem, at: (x: number, y: number) => Point): Ring {
  switch (part.shape) {
    case "box": {
      const b = part.at;
      return [at(b.x0, b.y0), at(b.x1, b.y0), at(b.x1, b.y1), at(b.x0, b.y1)];
    }
    case "cylinder": {
      const b = part.at;
      const [cx, cy, rx, ry] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2];
      return Array.from({ length: CYLINDER_SIDES }, (_, k) => {
        const t = (2 * Math.PI * k) / CYLINDER_SIDES;
        return at(cx + rx * Math.cos(t), cy + ry * Math.sin(t));
      });
    }
    case "outline":
      return item.ring;
    case "ring":
      return part.ring.map((p) => at(p.x, p.y));
    default:
      return assertNever(part);
  }
}

const defaultParts = (item: PieceItem): readonly Part[] =>
  appearanceOf(item.objectKind)(item.config, item.w, item.d, item.top - item.bottom, item.options, item.arms, item.flueTop === undefined ? undefined : item.flueTop - item.bottom);

const range = (part: Part): [number, number] => (part.shape === "outline" || part.shape === "ring" ? [part.z0, part.z1] : [part.at.z0, part.at.z1]);

/**
 * How many panels a panel stands on: 1 plus one for each earlier panel of the same face it overlaps, so a window in a
 * door's surround stands one step prouder than the surround and a depth buffer never ties them (real3d.16).
 */
function stepsProud(panels: readonly Panel[], i: number): number {
  const p = panels[i];
  if (!p) return 1;
  const overlaps = (q: Panel): boolean => q.normal === p.normal && q.at.x0 < p.at.x1 && p.at.x0 < q.at.x1 && (p.normal === "+z" ? q.at.y0 < p.at.y1 && p.at.y0 < q.at.y1 : q.at.z0 < p.at.z1 && p.at.z0 < q.at.z1);
  return 1 + panels.slice(0, i).filter(overlaps).length;
}

/** A panel's face, `steps` panels proud of its face. */
function panelFace(owner: string, panel: Panel, steps: number, bottom: number, at: (x: number, y: number) => Point, turn: (x: number, y: number) => Point, shades: Shades): Face3d {
  const b: Box3 = panel.at;
  const proud = PANEL_PROUD + (steps - 1) * PANEL_STEP;
  // Off its face toward its normal, so WebGL's depth test never ties it with the face (parts.31).
  if (panel.normal === "+z") {
    const p = (x: number, y: number): Point3 => ({ ...at(x, y), z: bottom + b.z1 + proud });
    return { points: [p(b.x0, b.y0), p(b.x1, b.y0), p(b.x1, b.y1), p(b.x0, b.y1)], holes: [], color: shades.top, owner };
  }
  const n = turn(0, -1);
  const y = b.y0 - proud;
  const p = (x: number, z: number): Point3 => ({ ...at(x, y), z: bottom + z });
  return { points: [p(b.x0, b.z0), p(b.x1, b.z0), p(b.x1, b.z1), p(b.x0, b.z1)], holes: [], color: sideShade(n, shades), owner };
}

/**
 * A piece's parts as placed solids, in the order the appearance lists them; `parts` defaults to the kind's appearance,
 * with the item's computer.
 */
export function partSolids(owner: string, item: PieceItem, style: Style3d, parts: readonly Part[] = defaultParts(item)): PartSolid[] {
  const at = placer(item);
  const turn = turner(item);
  const shadesOf = (slot: Part["slot"]): Shades => (item.selected ? style.selected : style.slots[slot]);
  return parts.map((part, i) => {
    const [z0, z1] = range(part);
    const ring = ringOf(part, item, at);
    const shades = shadesOf(part.slot);
    const given = part.panels ?? [];
    const panels = given.map((panel, k) => panelFace(owner, panel, stepsProud(given, k), item.bottom, at, turn, shadesOf(panel.slot)));
    return { key: `${owner}#${i}`, ring, bottom: item.bottom + z0, top: item.bottom + z1, faces: [...prism(owner, ring, item.bottom + z0, item.bottom + z1, shades), ...panels], panels };
  });
}
