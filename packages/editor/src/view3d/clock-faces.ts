import { localFacer } from "./local-faces";
import type { Style3d } from "./style";
import type { Face3d, PieceItem, Point3 } from "./types";

// A round wall clock in 3D (hangings, the user's review): its own faces, as a plant's, since a disc facing the room is
// no upright prism. A dark rim as deep as the clock, a white dial set back in it, twelve hour marks (longer at 12, 3, 6
// and 9), the hour and minute hands at ten past ten, an orange second hand and a centre cap, each a little proud of the
// one under it. Its parts (`parts/hung.ts`) stay for a section's cut and the parts rules.
//
//      front view           side view (the room on the left)
//      ╭──12──╮             │▌ ← rim, front −d/2 to back d/2
//     │╲  │   │             │▐ ← dial, set back
//    9│  ╲●   │3            │▐▏← marks and hands, proud of the dial
//     │       │
//      ╰──6───╯

const SIDES = 32;
/** Angles clockwise from 12, in degrees: ten past ten and 35 seconds. */
const HOUR = 305;
const MINUTE = 60;
const SECOND = 210;

/** A clock's faces, or null for any other kind. */
export function clockFaces(owner: string, item: PieceItem, style: Style3d): Face3d[] | null {
  if (item.objectKind !== "clock") return null;
  const { face } = localFacer(owner, item);
  const pick = (slot: keyof Style3d["slots"]) => (item.selected ? style.selected : style.slots[slot]);
  const [rimShades, dialShades, markShades, secondShades] = [pick("dark"), pick("ceramic"), pick("dark"), pick("flame")];
  const h = item.top - item.bottom;
  const r = Math.min(item.w, h) / 2;
  const inner = 0.9 * r;
  const cz = h / 2;
  const [front, back] = [-item.d / 2, item.d / 2];
  const dial = front + Math.min(0.008, 0.2 * item.d);
  const proud = (k: number): number => dial - Math.min(0.001, 0.02 * item.d) * k; // k layers in front of the dial

  /** The point `radius` from the centre at `deg` clockwise from 12, at depth `y`. */
  const at = (radius: number, deg: number, y: number): Point3 => {
    const a = (deg * Math.PI) / 180;
    return { x: radius * Math.sin(a), y, z: cz + radius * Math.cos(a) };
  };
  const toRoom: Point3 = { x: 0, y: -1, z: 0 };
  const step = 360 / SIDES;

  const rim: Face3d[] = [];
  for (let k = 0; k < SIDES; k += 1) {
    const [a, b] = [k * step, (k + 1) * step];
    const mid = at(1, a + step / 2, 0);
    rim.push(face([at(r, a, front), at(r, b, front), at(r, b, back), at(r, a, back)], rimShades, { x: mid.x, y: 0, z: mid.z - cz }));
    rim.push({ ...face([at(r, a, front), at(r, b, front), at(inner, b, front), at(inner, a, front)], rimShades, toRoom), outline: false }); // no tile outlines
    rim.push(face([at(inner, a, front), at(inner, b, front), at(inner, b, dial), at(inner, a, dial)], rimShades, { x: -mid.x, y: 0, z: cz - mid.z }));
  }
  const dialFace = face(Array.from({ length: SIDES }, (_, k) => at(inner, k * step, dial)), dialShades, toRoom);

  /** A bar from `from` to `to` along `deg` (negative: past the centre), `w0` wide at its start and `w1` at its end. */
  const bar = (deg: number, from: number, to: number, w0: number, w1: number, y: number): Point3[] => {
    const [p, q] = [at(from, deg, y), at(to, deg, y)];
    const side = at(1, deg + 90, y);
    const [sx, sz] = [side.x, side.z - cz];
    return [
      { x: p.x + (sx * w0) / 2, y, z: p.z + (sz * w0) / 2 },
      { x: q.x + (sx * w1) / 2, y, z: q.z + (sz * w1) / 2 },
      { x: q.x - (sx * w1) / 2, y, z: q.z - (sz * w1) / 2 },
      { x: p.x - (sx * w0) / 2, y, z: p.z - (sz * w0) / 2 },
    ];
  };
  const marks = Array.from({ length: 12 }, (_, i) => {
    const main = i % 3 === 0;
    const w = (main ? 0.05 : 0.028) * inner;
    return face(bar(i * 30, (main ? 0.7 : 0.76) * inner, 0.88 * inner, w, w, proud(1)), markShades, toRoom);
  });
  const hands = [
    face(bar(HOUR, -0.12 * inner, 0.5 * inner, 0.07 * inner, 0.035 * inner, proud(2)), markShades, toRoom),
    face(bar(MINUTE, -0.12 * inner, 0.82 * inner, 0.05 * inner, 0.025 * inner, proud(3)), markShades, toRoom),
    face(bar(SECOND, -0.2 * inner, 0.88 * inner, 0.012 * inner, 0.012 * inner, proud(4)), secondShades, toRoom),
  ];
  const cap = face(Array.from({ length: 8 }, (_, k) => at(0.05 * inner, k * 45, proud(5))), markShades, toRoom);
  return [...rim, dialFace, ...marks, ...hands, cap];
}
