import { localFacer } from "./local-faces";
import { washerMachines } from "./parts/bathroom";
import { partSolids } from "./parts/solids";
import type { Style3d } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// A washing machine's round doors (hangings, the user's review): its parts' faces (`parts/bathroom.ts`), then per
// machine a silver ring round dark glass on the front, centred on the front under the control strip. A stack (the
// Washer-dryer preset) has two.
//
//   ╭──────╮   ring: RING_IN to 1 of the door's radius, 32 quads
//  │ ╭──╮ │   glass: one 32-sided face
//  │ ╰──╯ │
//   ╰──────╯

const SIDES = 32;
const RING_IN = 0.76;

export function washerFaces(owner: string, item: PieceItem, style: Style3d): Face3d[] | null {
  if (item.objectKind !== "washingMachine") return null;
  const { face } = localFacer(owner, item);
  const [ring, glass] = item.selected ? [style.selected, style.selected] : [style.slots.metal, style.slots.dark];
  const front = -item.d / 2;
  const toRoom: Point3 = { x: 0, y: -1, z: 0 };
  const doors = washerMachines(item.top - item.bottom).machines.flatMap(({ z0, z1, strip }): Face3d[] => {
    const height = z1 - strip - z0;
    const r = Math.min(0.4 * item.w, 0.4 * height);
    const zc = z0 + height / 2;
    const at = (radius: number, k: number): Point3 => {
      const a = (2 * Math.PI * k) / SIDES;
      return { x: radius * Math.sin(a), y: front, z: zc + radius * Math.cos(a) };
    };
    // The ring's segments draw no outline, or it reads as 32 tiles; the glass's edge and the front show its shape.
    const band = Array.from({ length: SIDES }, (_, k): Face3d => ({ ...face([at(r, k), at(r, k + 1), at(RING_IN * r, k + 1), at(RING_IN * r, k)], ring, toRoom), outline: false }));
    return [...band, face(Array.from({ length: SIDES }, (_, k) => at(RING_IN * r, k)), glass, toRoom)];
  });
  return [...partSolids(owner, item, style).flatMap((p) => p.faces), ...doors];
}
