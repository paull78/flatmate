import type { OutsideDoor } from "@fm/domain";
import { orient, sideShade } from "./prism";
import type { Shades } from "./style";
import type { Face3d, Point3 } from "./types";

// Steps down from each outside door on wheels (trailer.06): from the floor to the ground `below` it in four equal
// risers, three treads TREAD deep out from the wall's outer face, as wide as the opening plus SIDE a side, solid, in
// wood. Built as one stepped solid, a column per tread, so no two faces lie in one plane:
//
//   floor ─┐ wall's outer face
//          │▔▔▔▔│ tread 1
//          │    │▔▔▔▔│ tread 2
//          │    │    │▔▔▔▔│ tread 3
//   ground ┴────┴────┴────┘
//
// Only drawn: nothing is checked against the trailer or anything else.

const TREADS = 3;
const TREAD = 0.28; // deep
const SIDE = 0.1; // past the opening on each side

/** The steps at each of `doors`, the ground `below` the floor, in `wood`'s shades. */
export function doorSteps(doors: readonly OutsideDoor[], below: number, wood: Shades): Face3d[] {
  return doors.flatMap((d) => stepsAt(d, below, wood));
}

function stepsAt(door: OutsideDoor, below: number, wood: Shades): Face3d[] {
  const owner = `trailer/steps-${door.id}`;
  const len = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y);
  if (len < 1e-9) return [];
  const along = { x: (door.b.x - door.a.x) / len, y: (door.b.y - door.a.y) / len };
  const rise = below / (TREADS + 1);
  /** A point `t` along the door's span (from SIDE before `a`), `o` out from the face, at height `z`. */
  const at = (t: number, o: number, z: number): Point3 => ({ x: door.a.x + along.x * (t - SIDE) + door.out.x * o, y: door.a.y + along.y * (t - SIDE) + door.out.y * o, z });
  const w = len + 2 * SIDE;
  const out: Point3 = { x: door.out.x, y: door.out.y, z: 0 };
  const start: Point3 = { x: -along.x, y: -along.y, z: 0 };
  const end: Point3 = { x: along.x, y: along.y, z: 0 };
  const face = (points: Point3[], n: Point3, color: string, outline = true): Face3d => ({ points: orient(points, n), holes: [], color, owner, ...(outline ? {} : { outline: false }) });
  return Array.from({ length: TREADS }, (_, k): Face3d[] => {
    const i = k + 1;
    const [o0, o1] = [k * TREAD, i * TREAD];
    const top = -i * rise;
    const front = i === TREADS ? -below : -(i + 1) * rise; // the next tread's top hides the rest of this column's front
    return [
      face([at(0, o0, top), at(w, o0, top), at(w, o1, top), at(0, o1, top)], { x: 0, y: 0, z: 1 }, wood.top),
      face([at(0, o1, front), at(w, o1, front), at(w, o1, top), at(0, o1, top)], out, sideShade(out, wood)),
      // The ends, a rectangle per column: no outline, or the columns' seams would draw down each end.
      face([at(0, o0, -below), at(0, o1, -below), at(0, o1, top), at(0, o0, top)], start, sideShade(start, wood), false),
      face([at(w, o0, -below), at(w, o1, -below), at(w, o1, top), at(w, o0, top)], end, sideShade(end, wood), false),
    ];
  }).flat();
}
