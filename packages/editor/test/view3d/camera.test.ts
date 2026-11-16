import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { camera3d, DEFAULT_ANGLES, shellBounds, TILT_MAX, TILT_MIN, toCamera, type Bounds3 } from "../../src/view3d/camera3d";
import { hiddenWalls } from "../../src/view3d/hidden";
import { framedBounds, SURROUNDINGS } from "../../src/view3d/surroundings";
import { roomDoc } from "../builders";

// The 3D camera and hidden walls (heights.19, real3d.03, .05, .06, AC-05, AC-06): orthographic, at any yaw (the
// direction from the drawing to the camera, counter-clockwise from +x) and a tilt from 10° to 90° down, framed on the
// shell's box by its 3D diagonal so the scale and the centre never change; shell walls whose outer face looks toward
// the camera are hidden, interior walls never.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const wall = (opId: string, a: [number, number], b: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: a[0], y: a[1] } }, to: { at: { x: b[0], y: b[1] } } });
const YAWS = Array.from({ length: 360 }, (_, i) => i);
const TILTS = Array.from({ length: 17 }, (_, i) => TILT_MIN + 5 * i);

/** A closed ring of walls through the points, as one chain. */
function ring(points: [number, number][]): Document {
  return points.reduce((d, p, i) => ok(d, wall(`w${i}`, p, points[(i + 1) % points.length] ?? p)), emptyDocument());
}

function corners(b: Bounds3) {
  const out: { x: number; y: number; z: number }[] = [];
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [0, b.top]) out.push({ x, y, z });
  return out;
}

/** The camera's scale: clip units per metre along the screen's x axis. */
const scaleOf = (m: readonly number[]): number => Math.hypot(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0);

describe("camera3d", () => {
  const doc = roomDoc();
  const bounds = shellBounds(doc);
  if (!bounds) throw new Error("no bounds");

  it("starts at today's view: from the south-west, 35° down; the tilt runs 10° to 90°", () => {
    expect(DEFAULT_ANGLES).toEqual({ yaw: 225, tilt: 35 });
    expect([TILT_MIN, TILT_MAX]).toEqual([10, 90]);
    const d = toCamera(225);
    expect([d.x, d.y]).toEqual([-Math.SQRT1_2, -Math.SQRT1_2].map((v) => Math.round(v * 1e12) / 1e12));
  });

  it("project equals the matrix times the point, for random points and angles", () => {
    let seed = 3;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 20; k++) {
      const cam = camera3d(bounds, { yaw: 360 * random(), tilt: TILT_MIN + (TILT_MAX - TILT_MIN) * random() });
      for (let i = 0; i < 20; i++) {
        const p = { x: -2 + 10 * random(), y: -2 + 8 * random(), z: 3 * random() };
        const m = cam.matrix;
        const row = (r: number): number => (m[4 * r] ?? 0) * p.x + (m[4 * r + 1] ?? 0) * p.y + (m[4 * r + 2] ?? 0) * p.z + (m[4 * r + 3] ?? 0);
        const q = cam.project(p);
        expect([q.x, q.y, q.z].map((v, r) => Math.abs(v - row(r)) < 1e-9)).toEqual([true, true, true]);
      }
    }
  });

  it("the scale and the box centre's place on screen are the same at every yaw (1° steps) and tilt (5° steps), and every corner lands inside the frame, for a long shell and a square one (AC-05)", () => {
    for (const shell of [bounds, { min: { x: 0, y: 0 }, max: { x: 12, y: 3 }, top: 2.5 }, { min: { x: -1, y: -1 }, max: { x: 4, y: 4 }, top: 3.05 }]) {
      const centre = { x: (shell.min.x + shell.max.x) / 2, y: (shell.min.y + shell.max.y) / 2, z: shell.top / 2 };
      const scale = scaleOf(camera3d(shell, DEFAULT_ANGLES).matrix);
      for (const yaw of YAWS) {
        for (const tilt of TILTS) {
          const cam = camera3d(shell, { yaw, tilt });
          expect(scaleOf(cam.matrix)).toBeCloseTo(scale, 12);
          const c = cam.project(centre);
          expect(Math.abs(c.x) + Math.abs(c.y)).toBeLessThan(1e-9);
          for (const p of corners(shell)) {
            const q = cam.project(p);
            expect(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1).toBe(true);
          }
        }
      }
    }
  });

  it("looks from the yaw's side and down: at yaw 45° the north-east corner is nearest; a higher point projects higher unless straight down", () => {
    const cam = camera3d(bounds, { yaw: 45, tilt: 35 });
    const depths = corners(bounds).filter((p) => p.z === 0).map((p) => ({ p, z: cam.project(p).z }));
    const nearest = depths.reduce((a, b) => (b.z < a.z ? b : a));
    expect([nearest.p.x, nearest.p.y]).toEqual([bounds.max.x, bounds.max.y]);
    for (const tilt of [10, 35, 89]) {
      const c = camera3d(bounds, { yaw: 200, tilt });
      expect(c.project({ x: 3, y: 2, z: 2 }).y).toBeGreaterThan(c.project({ x: 3, y: 2, z: 0 }).y);
    }
  });

  it("at tilt 90° looks straight down, the screen's up still turning with the yaw", () => {
    const a = camera3d(bounds, { yaw: 225, tilt: 90 });
    const b = camera3d(bounds, { yaw: 315, tilt: 90 });
    for (const cam of [a, b]) {
      expect(cam.project({ x: 3, y: 2, z: 2 }).x).toBeCloseTo(cam.project({ x: 3, y: 2, z: 0 }).x, 12);
      expect(cam.project({ x: 3, y: 2, z: 2 }).y).toBeCloseTo(cam.project({ x: 3, y: 2, z: 0 }).y, 12);
      expect(cam.project({ x: 3, y: 2, z: 2 }).z).toBeLessThan(cam.project({ x: 3, y: 2, z: 0 }).z); // higher is nearer
    }
    // North goes to the screen's left from the south-west and to its right from the south-east.
    const north = (cam: typeof a) => cam.project({ x: 3, y: 3, z: 0 }).x - cam.project({ x: 3, y: 2, z: 0 }).x;
    expect(north(a)).toBeLessThan(0);
    expect(north(b)).toBeGreaterThan(0);
  });

  const studio: Bounds3 = { min: { x: -0.1, y: -0.1 }, max: { x: 7.1, y: 2.6 }, top: 3.05 };
  const shells: Bounds3[] = [studio, { min: { x: 0, y: 0 }, max: { x: 12, y: 3 }, top: 2.5 }, { min: { x: -1, y: -1 }, max: { x: 0, y: 0 }, top: 2.5 }];

  it("camera3d with no pull or bottom gives today's exact matrix: the studio's shell, scale 1.88 over the diagonal (AC-01)", () => {
    expect(1.88 / Math.hypot(7.2, 2.7, 3.05)).toBe(0.22726190679747893);
    expect(camera3d(studio, { yaw: 225, tilt: 35 }).matrix).toEqual([
      0.16069843540198536, -0.16069843540198536, 0, -0.36157147965446707,
      0.09217283590505954, 0.09217283590505954, 0.18616205554240747, -0.7217181052512042,
      0.5792279653399398, 0.5792279653399398, -0.573576436351046, 0,
    ]);
    expect(camera3d(studio, { yaw: 270, tilt: 10 }).matrix).toEqual([
      0.22726190679747899, -0, 0, -0.7954166737911764,
      0, 0.039463615968493994, 0.22380928777849513, -0.3906386838228225,
      0, 0.984807753012208, -0.17364817766693033, 0,
    ]);
    expect(camera3d(studio, { yaw: 300, tilt: 90 }).matrix).toEqual([
      0.1968145845990085, 0.11363095339873949, 0, -0.8308897378449541,
      -0.11363095339873949, 0.1968145845990085, 1.3915778336372262e-17, 0.15169010614682757,
      -3.061616997868383e-17, 5.302876193621848e-17, -1, 0,
    ]);
  });

  it("a pull of 0.88 gives 0.88 of the scale about the same centre at every yaw and tilt step (AC-03)", () => {
    for (const shell of shells) {
      for (const yaw of YAWS) {
        for (const tilt of TILTS) {
          const today = camera3d(shell, { yaw, tilt });
          const pulled = camera3d({ ...shell, pull: 0.88 }, { yaw, tilt });
          expect(scaleOf(pulled.matrix) / scaleOf(today.matrix)).toBeCloseTo(0.88, 12);
          for (const p of [...corners(shell), { x: -5, y: 9, z: -2 }]) {
            const [a, b] = [today.project(p), pulled.project(p)];
            expect([b.x - 0.88 * a.x, b.y - 0.88 * a.y, b.z - a.z].map((v) => Math.abs(v) < 1e-12)).toEqual([true, true, true]);
          }
        }
      }
    }
  });

  it("with a bottom, the box from bottom to top stays inside the frame at every step, its centre still and its scale unchanged by the turn (AC-03)", () => {
    for (const shell of shells) {
      for (const pull of [undefined, 0.88]) {
        const box: Bounds3 = { ...shell, bottom: -0.75, ...(pull === undefined ? {} : { pull }) };
        const centre = { x: (shell.min.x + shell.max.x) / 2, y: (shell.min.y + shell.max.y) / 2, z: (shell.top - 0.75) / 2 };
        const scale = ((pull ?? 1) * 1.88) / Math.hypot(shell.max.x - shell.min.x, shell.max.y - shell.min.y, shell.top + 0.75);
        for (const yaw of YAWS) {
          for (const tilt of TILTS) {
            const cam = camera3d(box, { yaw, tilt });
            expect(scaleOf(cam.matrix)).toBeCloseTo(scale, 12);
            const c = cam.project(centre);
            expect(Math.abs(c.x) + Math.abs(c.y)).toBeLessThan(1e-9);
            for (const p of corners(shell)) {
              const q = cam.project({ ...p, z: p.z === 0 ? -0.75 : p.z });
              expect(Math.hypot(q.x, q.y)).toBeLessThanOrEqual((pull ?? 1) * 0.94 + 1e-9);
            }
          }
        }
      }
    }
  });

  it("the shell's scale on the studio matches the framed box, about 0.849 of None, and doesn't change as the view turns", () => {
    const framed = framedBounds(SURROUNDINGS.wheels, studio);
    // The box from the ground at −0.75 to the ceiling, its diagonal 8.272 → 8.577, then pulled (surroundings.14).
    const scale = (0.88 * 1.88) / Math.hypot(7.2, 2.7, 3.05 + 0.75);
    const centre = { x: 3.5, y: 1.25, z: (3.05 - 0.75) / 2 };
    for (const yaw of YAWS) {
      for (const tilt of TILTS) {
        const [none, wheeled] = [camera3d(studio, { yaw, tilt }), camera3d(framed, { yaw, tilt })];
        expect(scaleOf(wheeled.matrix), `yaw ${yaw}, tilt ${tilt}`).toBeCloseTo(scale, 12);
        expect(scaleOf(wheeled.matrix) / scaleOf(none.matrix), `yaw ${yaw}, tilt ${tilt}`).toBeCloseTo(0.849, 3);
        const c = wheeled.project(centre);
        expect(Math.abs(c.x) + Math.abs(c.y), `yaw ${yaw}, tilt ${tilt}: the framed box's centre`).toBeLessThan(1e-9);
      }
    }
  });

  it("the frame ignores pieces: placing and moving a bed leaves the bounds unchanged", () => {
    const bed = ok(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } });
    expect(shellBounds(bed)).toEqual(bounds);
    expect(shellBounds(ok(bed, { type: "movePlacement", placementId: "b/p0", at: { x: 2, y: 3.9 }, rotation: 0 }))).toEqual(bounds);
  });
});

describe("hiddenWalls (AC-06)", () => {
  it("rectangle shell: at a corner yaw two walls are hidden, a different pair at each of the four", () => {
    const doc = roomDoc();
    const pairs = [225, 315, 45, 135].map((yaw) => [...hiddenWalls(doc, yaw)].sort().join(","));
    for (const p of pairs) expect(p.split(",")).toHaveLength(2);
    expect(new Set(pairs).size).toBe(4);
  });

  it("at any yaw, an L's shell wall is hidden exactly when its outer normal faces the camera's side; interior walls never", () => {
    // An L: (0,0) (6,0) (6,2) (3,2) (3,4) (0,4); each wall's outer normal by hand.
    const l = ring([[0, 0], [6, 0], [6, 2], [3, 2], [3, 4], [0, 4]]);
    const outer: Record<string, [number, number]> = { "w0/w0": [0, -1], "w1/w0": [1, 0], "w2/w0": [0, 1], "w3/w0": [1, 0], "w4/w0": [0, 1], "w5/w0": [-1, 0] };
    const divided = ok(roomDoc(), wall("div", [3, 0], [3, 4]));
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const yaw of [...[0, 90, 180, 270].map((y) => y + 0.5), ...Array.from({ length: 40 }, () => 360 * random())]) {
      const d = toCamera(yaw);
      const want = Object.entries(outer).filter(([, n]) => n[0] * d.x + n[1] * d.y > 1e-9).map(([id]) => id).sort();
      expect({ yaw, hidden: [...hiddenWalls(l, yaw)].sort() }).toEqual({ yaw, hidden: want });
      expect(hiddenWalls(divided, yaw).has("div/w0")).toBe(false);
    }
  });
});
