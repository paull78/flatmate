import { describe, expect, it } from "vitest";
import { emptyDocument, execute, motifDefaults, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { faces3d } from "../../src/view3d/faces";
import { view3dItems } from "../../src/view3d/items";
import { sceneFaces } from "../../src/view3d/scene-faces";
import { STYLE_3D } from "../../src/view3d/style";
import type { Face3d, Point3 } from "../../src/view3d/types";
import { wallSeams } from "../../src/view3d/wall-seams";
import { wallBetween } from "../builders";

// Seams on 3D walls (snags.09, .10, AC-04): a wall split at a joint reads as one flat wall. Step 04's half: a wall face
// lying against other wall faces (in its plane, facing the other way), so its edges lie on the visible wall, draws no
// outline. Only wall faces take part.

const quad = (owner: string, points: Point3[], color = "#b9b7b1"): Face3d => ({ points, holes: [], color, owner });
/** An upright rectangle in the plane y = `y`, x from x0 to x1, z from z0 to z1, facing +y or −y. */
const upright = (owner: string, y: number, [x0, x1]: [number, number], [z0, z1]: [number, number], facing: 1 | -1, color?: string): Face3d =>
  quad(owner, facing === 1
    ? [{ x: x1, y, z: z0 }, { x: x0, y, z: z0 }, { x: x0, y, z: z1 }, { x: x1, y, z: z1 }]
    : [{ x: x0, y, z: z0 }, { x: x1, y, z: z0 }, { x: x1, y, z: z1 }, { x: x0, y, z: z1 }], color);
const outlined = (faces: readonly Face3d[]): boolean[] => faces.map((f) => f.outline !== false);

describe("wallSeams: faces lying against other wall faces (step 04)", () => {
  it("two faces back to back in one plane both lose their outline, and keep their fills", () => {
    const a = upright("wall/a", 0.1, [0, 1], [0, 3], 1);
    const b = upright("wall/b", 0.1, [0, 1], [0, 3], -1, "#8f8d88");
    const out = wallSeams([a, b]);
    expect(outlined(out)).toEqual([false, false]);
    expect(out.map((f) => f.points)).toEqual([a.points, b.points]);
  });

  it("a face covered in two pieces (the meeting wall below 2.03, the cap above) loses its outline", () => {
    const end = upright("wall/half", 0.1, [1.4, 1.5], [0, 3.05], 1);
    const below = upright("wall/part", 0.1, [1.4, 1.5], [0, 2.03], -1);
    const above = upright("wall/cap", 0.1, [1.4, 1.5], [2.03, 3.05], -1);
    expect(outlined(wallSeams([end, below, above]))[0]).toBe(false);
  });

  it("a face covered only in part keeps its outline (an L corner with mixed tops, out of scope)", () => {
    const end = upright("wall/half", 0.1, [1.4, 1.5], [0, 3.05], 1);
    const below = upright("wall/part", 0.1, [1.4, 1.5], [0, 2.03], -1);
    expect(outlined(wallSeams([end, below]))[0]).toBe(true);
  });

  it("a face 1 mm off the plane, or one facing the same way, doesn't cover it", () => {
    const a = upright("wall/a", 0.1, [0, 1], [0, 3], 1);
    expect(outlined(wallSeams([a, upright("wall/b", 0.101, [0, 1], [0, 3], -1)]))[0]).toBe(true);
    expect(outlined(wallSeams([a, upright("wall/b", 0.1, [0, 1], [0, 3], 1, "#8f8d88")]))[0]).toBe(true); // another colour: no shared stretch either
    // In a plane through the origin too, where both offsets are 0.
    expect(outlined(wallSeams([upright("wall/a", 0, [0, 1], [0, 3], 1), upright("wall/b", 0, [0, 1], [0, 3], 1, "#8f8d88")]))).toEqual([true, true]);
  });

  it("a piece or deck against a wall neither covers nor is covered", () => {
    const wallFace = upright("wall/a", 0.1, [0, 1], [0, 3], 1);
    const piece = upright("piece/o1/p0", 0.1, [0, 1], [0, 3], -1);
    const deck = upright("deck/k1", 0.1, [0, 1], [0, 3], -1);
    expect(outlined(wallSeams([wallFace, piece, deck]))).toEqual([true, true, true]);
  });

  it("a window counts: a full face isn't covered by a holed one, which it does cover", () => {
    const window = [{ x: 0.3, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 2 }, { x: 0.3, y: 0.1, z: 2 }];
    const holed = (owner: string, facing: 1 | -1) => ({ ...upright(owner, 0.1, [0, 1], [0, 3], facing), holes: [window] });
    expect(outlined(wallSeams([holed("wall/a", 1), holed("wall/b", -1)]))).toEqual([false, false]);
    // The full face shows through the window, where the holed face doesn't cover it; the window's own sides keep their edges.
    expect(outlined(wallSeams([holed("wall/a", 1), upright("wall/b", 0.1, [0, 1], [0, 3], -1)]))).toEqual([false, true]);
  });
});

// Step 05's half: the stretch two wall faces share, in one plane, of one colour, facing the same way, isn't drawn. A face
// that loses any stretch has no outline and carries what's left as lines in the edge colour.
const EDGE = STYLE_3D.edge;
type Seg = { a: Point3; b: Point3 };
/** The edge-colour segments a face draws: its rings when outlined, else its lines in the edge colour. */
const drawnEdges = (f: Face3d): Seg[] =>
  f.outline !== false
    ? [f.points, ...f.holes].flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] ?? a })))
    : (f.lines ?? []).filter((l) => l.color === EDGE).map(({ a, b }) => ({ a, b }));
const key = (s: Seg): string => [s.a, s.b].map((p) => `${+p.x.toFixed(6)},${+p.y.toFixed(6)},${+p.z.toFixed(6)}`).sort().join(" ");
const edgeKeys = (f: Face3d): string[] => drawnEdges(f).map(key).sort();
const seg = (a: [number, number, number], b: [number, number, number]): string => key({ a: { x: a[0], y: a[1], z: a[2] }, b: { x: b[0], y: b[1], z: b[2] } });

describe("wallSeams: stretches two coplanar wall faces of one colour share (step 05)", () => {
  it("two faces side by side lose the edge they share, and keep their other edges as lines", () => {
    const [a, b] = wallSeams([upright("wall/a", 0.1, [0, 1], [0, 3], 1), upright("wall/b", 0.1, [1, 2], [0, 3], 1)]);
    expect(a?.outline).toBe(false);
    expect(edgeKeys(a!)).toEqual([seg([0, 0.1, 0], [1, 0.1, 0]), seg([0, 0.1, 0], [0, 0.1, 3]), seg([0, 0.1, 3], [1, 0.1, 3])].sort());
    expect(edgeKeys(b!)).toEqual([seg([1, 0.1, 0], [2, 0.1, 0]), seg([2, 0.1, 0], [2, 0.1, 3]), seg([1, 0.1, 3], [2, 0.1, 3])].sort());
  });

  it("a stretch shared in part goes, and the rest of that edge stays: a cap's 2.03–3.05 against a wall's 0–3.05", () => {
    const [wall, cap] = wallSeams([upright("wall/half", 0.1, [0.1, 1.4], [0, 3.05], 1), upright("wall/cap", 0.1, [1.4, 1.6], [2.03, 3.05], 1)]);
    expect(edgeKeys(wall!)).toContain(seg([1.4, 0.1, 0], [1.4, 0.1, 2.03]));
    expect(edgeKeys(wall!).filter((k) => k.includes("1.4,0.1,3.05") && k.includes("1.4,0.1,2.03"))).toEqual([]);
    expect(edgeKeys(cap!)).toEqual([seg([1.4, 0.1, 2.03], [1.6, 0.1, 2.03]), seg([1.6, 0.1, 2.03], [1.6, 0.1, 3.05]), seg([1.4, 0.1, 3.05], [1.6, 0.1, 3.05])].sort());
  });

  it("an edge at a fold, between two colours, or between faces facing apart stays", () => {
    const a = upright("wall/a", 0.1, [0, 1], [0, 3], 1);
    const side = quad("wall/b", [{ x: 1, y: 0.1, z: 0 }, { x: 1, y: 0.1, z: 3 }, { x: 1, y: 1, z: 3 }, { x: 1, y: 1, z: 0 }]);
    for (const other of [side, upright("wall/b", 0.1, [1, 2], [0, 3], 1, "#8f8d88"), upright("wall/b", 0.1, [1, 2], [0, 3], -1)]) {
      expect(wallSeams([a, other])[0]).toEqual(a);
    }
    // Facing apart in a plane through the origin too, where both offsets are 0.
    const atOrigin = upright("wall/a", 0, [0, 1], [0, 3], 1);
    expect(wallSeams([atOrigin, upright("wall/b", 0, [1, 2], [0, 3], -1)])[0]).toEqual(atOrigin);
  });

  it("a face that shares nothing comes back as it was, its own lines and holes included", () => {
    const window = [{ x: 0.3, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 2 }, { x: 0.3, y: 0.1, z: 2 }];
    const lined = { ...upright("wall/a", 0.1, [0, 1], [0, 3], 1), holes: [window], lines: [{ a: { x: 0, y: 0.1, z: 1 }, b: { x: 1, y: 0.1, z: 1 }, color: "#123456" }] };
    expect(wallSeams([lined, upright("wall/b", 0.1, [3, 4], [0, 3], 1)])[0]).toEqual(lined);
  });

  it("a face that loses a stretch keeps its own lines first, and its window's edges", () => {
    const window = [{ x: 0.3, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 1 }, { x: 0.7, y: 0.1, z: 2 }, { x: 0.3, y: 0.1, z: 2 }];
    const own = { a: { x: 0, y: 0.1, z: 1 }, b: { x: 1, y: 0.1, z: 1 }, color: "#123456" };
    const [a] = wallSeams([{ ...upright("wall/a", 0.1, [0, 1], [0, 3], 1), holes: [window], lines: [own] }, upright("wall/b", 0.1, [1, 2], [0, 3], 1)]);
    expect(a?.lines?.[0]).toEqual(own);
    expect(edgeKeys(a!)).toContain(seg([0.3, 0.1, 1], [0.7, 0.1, 1]));
    expect(edgeKeys(a!)).toHaveLength(7); // three of the ring's four edges, and the window's four
  });

  it("a door's or window's frame and leaf keep every line, though they share the wall's owner (frozen pictures, step 06)", () => {
    const white = STYLE_3D.joinery.lit;
    const frame = upright("wall/a", 0.1, [1, 1.06], [0, 2.1], 1, white);
    const leaf = upright("wall/a", 0.1, [1.06, 1.86], [0, 2.04], 1, white);
    expect(wallSeams([frame, leaf])).toEqual([frame, leaf]);
    // In the selected wall's shades, a wall still loses its seams.
    const [a] = wallSeams([upright("wall/a", 0.1, [0, 1], [0, 3], 1, STYLE_3D.selected.lit), upright("wall/b", 0.1, [1, 2], [0, 3], 1, STYLE_3D.selected.lit)]);
    expect(a?.outline).toBe(false);
  });

  it("a piece coplanar with a wall, in the wall's colour, keeps its outline and takes none of the wall's", () => {
    const [w, piece] = wallSeams([upright("wall/a", 0.1, [0, 1], [0, 3], 1), upright("piece/o1/p0", 0.1, [1, 2], [0, 3], 1)]);
    expect(w?.outline).not.toBe(false);
    expect(piece?.outline).not.toBe(false);
  });
});

// The studio's T-joints (studio.05, .10, .21): a 7 × 2.5 shell under 3.05, its 2.03 partition across at x 1.5.
const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
function partitioned(): Document {
  const shell = run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "s"), { type: "setCeiling", height: 3.05 });
  const doc = run(shell, { type: "addWall", opId: "part", from: { at: { x: 1.5, y: 0 } }, to: { at: { x: 1.5, y: 2.5 } } });
  return run(doc, { type: "setWallTop", wallId: wallBetween(doc, { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }), top: 2.03 });
}
const scene = (doc: Document, hidden: ReadonlySet<string> = new Set()) => sceneFaces({ items: view3dItems(doc, "s0", null, new Set(), false), hidden });
/** The faces with a corner at the south T's 45° ends: the joint's (1.4, 0.1)–(1.5, 0)–(1.6, 0.1). */
const atSouthJoint = (faces: readonly Face3d[]): Face3d[] => faces.filter((f) => {
  const near = (p: Point3, q: Point) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  const diagonal = f.points.length === 4 && f.points.every((p) => near(p, { x: 1.5, y: 0 }) || near(p, { x: 1.4, y: 0.1 }) || near(p, { x: 1.6, y: 0.1 }));
  return diagonal && f.points.some((p) => near(p, { x: 1.5, y: 0 })) && new Set(f.points.map((p) => `${p.x},${p.y}`)).size === 2;
});

describe("sceneFaces on the studio's T-joint (step 04)", () => {
  it("the halves' 45° ends, and the partition's and cap's that lie against them, draw no outline", () => {
    const joint = atSouthJoint(scene(partitioned()));
    expect(joint.length).toBeGreaterThanOrEqual(6); // two half ends, two partition ends, two cap ends
    expect(joint.filter((f) => f.outline !== false).map((f) => f.owner)).toEqual([]);
  });

  it("with the long wall hidden, the partition's end is open to view and keeps its outline", () => {
    const doc = partitioned();
    const south = wallBetween(doc, { x: 1.5, y: 0 }, { x: 7, y: 0 });
    const west = wallBetween(doc, { x: 0, y: 0 }, { x: 1.5, y: 0 });
    const joint = atSouthJoint(scene(doc, new Set([south, west])));
    expect(joint.length).toBeGreaterThan(0);
    expect(joint.every((f) => f.outline !== false)).toBe(true);
  });

  it("no edge is drawn on the south wall's inside above the partition, and the partition's corners below 2.03 stay (step 05)", () => {
    const faces = scene(partitioned());
    const onSeam = (s: Seg, x: number, z0: number, z1: number) =>
      [s.a, s.b].every((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - 0.1) < 1e-9 && p.z > z0 - 1e-9 && p.z < z1 + 1e-9) && Math.abs(s.a.z - s.b.z) > 1e-9;
    const drawn = faces.flatMap(drawnEdges);
    for (const x of [1.4, 1.6]) {
      expect(drawn.filter((s) => onSeam(s, x, 2.03, 3.05)).map(key), `x ${x} above 2.03`).toEqual([]);
      expect(drawn.some((s) => onSeam(s, x, 0, 2.03)), `x ${x} below 2.03`).toBe(true);
    }
  });

  it("a scene with no walls gives exactly today's faces", () => {
    const items = view3dItems(partitioned(), "s0", null, new Set(), false).filter((i) => i.item !== "wall");
    expect(sceneFaces({ items, hidden: new Set() })).toEqual(items.flatMap((i) => faces3d(i)));
  });
});

// A finished side (knownbugs AC-09): two halves of a split wall whose side shows one finish read as one flat wall too.
// The studio's south wall is split at x 1.5 by the partition's T; its outside face lies in y = −0.1.
describe("sceneFaces on a split wall with a finish", () => {
  const SAGE = { ...motifDefaults("plain"), colour: "#a8b59a" };
  const NAVY = { ...motifDefaults("plain"), colour: "#2f3e57" };
  const finished = (doc: Document) => sceneFaces({ items: view3dItems(doc, "s0", null, new Set(), true), hidden: new Set() });
  const atSplit = (faces: readonly Face3d[]): string[] => faces.flatMap(drawnEdges)
    .filter((e) => [e.a, e.b].every((p) => Math.abs(p.x - 1.5) < 1e-9 && Math.abs(p.y + 0.1) < 1e-9) && Math.abs(e.a.z - e.b.z) > 1e-9).map(key);
  const outside = run(partitioned(), { type: "setOutsideFinish", part: "finish", finish: SAGE });

  it("the fixture shows the finish on both halves' outside faces", () => {
    const sides = finished(outside).filter((f) => f.owner.startsWith("wall/") && f.color.toLowerCase() !== STYLE_3D.wall.lit && f.points.every((p) => Math.abs(p.y + 0.1) < 1e-9));
    expect(sides.length).toBeGreaterThanOrEqual(2);
  });

  it("draws no line at the split on the finished side", () => {
    expect(atSplit(finished(outside))).toEqual([]);
  });

  it("with the Finishes switch off the plain halves draw none either, as before", () => {
    expect(atSplit(scene(outside))).toEqual([]);
  });

  it("halves in different colours keep the line between them", () => {
    const west = wallBetween(outside, { x: 0, y: 0 }, { x: 1.5, y: 0 });
    const two = run(outside, { type: "setWallSide", wallId: west, side: "left", finish: NAVY, lower: null }, { type: "setWallSide", wallId: west, side: "right", finish: NAVY, lower: null });
    expect(atSplit(finished(two)).length).toBeGreaterThan(0);
  });
});

describe("wallSeams with finished colours", () => {
  it("two wall faces side by side in a finish's colour lose the edge they share only when the colour is named as a wall's", () => {
    const pair = [upright("wall/a", 0.1, [0, 1], [0, 3], 1, "#a8b59a"), upright("wall/b", 0.1, [1, 2], [0, 3], 1, "#a8b59a")];
    expect(wallSeams(pair)).toEqual(pair);
    const [a] = wallSeams(pair, STYLE_3D, ["#a8b59a"]);
    expect(a?.outline).toBe(false);
    expect(edgeKeys(a!)).not.toContain(seg([1, 0.1, 0], [1, 0.1, 3]));
  });
});
