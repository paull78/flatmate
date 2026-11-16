import { describe, expect, it } from "vitest";
import { emptyDocument, execute, jointWalls, rectangleRoom, unwrap, wallOutlines, wallRange, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { jointCaps } from "../../src/view3d/joint-caps";
import { view3dItems } from "../../src/view3d/items";
import { sceneFaces } from "../../src/view3d/scene-faces";
import type { WallItem } from "../../src/view3d/types";
import { wallBetween } from "../builders";

// Joint caps (studio.05, .10): where a wall's share of a joint sits below both of its neighbours, the lower neighbour
// carries the share from the shorter wall's top up to its own, so the taller walls show no notch above the shorter one.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const wall = (opId: string, from: Point, to: Point): Command => ({ type: "addWall", opId, from: { at: from }, to: { at: to } });
const top = (wallId: string, height: number): Command => ({ type: "setWallTop", wallId, top: height });

/** A 7 × 2.5 shell under a 3.05 ceiling, as the studio's (decks.20). */
function shell(): Document {
  return run(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "s"), { type: "setCeiling", height: 3.05 });
}

/** The studio's partition: x 1.5 across the shell, 2.03 tall, a T at each end. */
function partitioned(): Document {
  const doc = run(shell(), wall("part", { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }));
  return run(doc, top(wallBetween(doc, { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }), 2.03));
}

const wallItems = (doc: Document): WallItem[] => view3dItems(doc, "s0", null, new Set(), false).flatMap((i) => (i.item === "wall" ? [i] : []));
const allCaps = (doc: Document) => [...jointCaps(doc)].flatMap(([owner, caps]) => caps.map((c) => ({ owner, ...c })));
const area = (ring: readonly Point[]): number => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length] ?? p; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
const inRing = (ring: readonly Point[], p: Point): boolean => {
  let hit = false;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) hit = !hit;
  });
  return hit;
};
/** The highest flat face over `p` among `faces`: what a camera straight above sees first. */
const highestOver = (faces: ReturnType<typeof sceneFaces>, p: Point): number =>
  Math.max(-1, ...faces.filter((f) => f.points.every((q) => Math.abs(q.z - (f.points[0]?.z ?? 0)) < 1e-9) && inRing(f.points, p)).map((f) => f.points[0]?.z ?? -1));

describe("jointCaps", () => {
  it("a T: the shorter wall's share gets one cap, on the lower-id neighbour when their tops are equal", () => {
    const doc = partitioned();
    const south = [wallBetween(doc, { x: 0, y: 0 }, { x: 1.5, y: 0 }), wallBetween(doc, { x: 1.5, y: 0 }, { x: 7, y: 0 })].sort();
    const caps = allCaps(doc).filter((c) => c.ring.every((p) => p.y < 0.2));
    expect(caps).toHaveLength(1);
    expect(caps[0]?.owner).toBe(south[0]);
    expect(caps[0]?.bottom).toBeCloseTo(2.03, 9);
    const ring = caps[0]?.ring ?? [];
    expect(Math.abs(area(ring))).toBeCloseTo(0.01, 9); // the triangle (1.4, 0.1), (1.5, 0), (1.6, 0.1)
    expect(wallItems(doc).find((w) => w.wall === south[0])?.top).toBeCloseTo(3.05, 9);
  });

  it("a T whose neighbours differ: the cap goes to the lower one and reaches its top", () => {
    let doc = partitioned();
    const east = wallBetween(doc, { x: 1.5, y: 0 }, { x: 7, y: 0 });
    doc = run(doc, top(east, 2.5));
    const caps = allCaps(doc).filter((c) => c.ring.every((p) => p.y < 0.2));
    expect(caps.map((c) => [c.owner, Number(c.bottom.toFixed(9))])).toEqual([[east, 2.03]]);
    expect(wallItems(doc).find((w) => w.wall === east)?.top).toBeCloseTo(2.5, 9);
  });

  it("a crossing: each lower wall's share is capped", () => {
    // Walls can't cross: a crossing is four walls meeting at one joint.
    let doc = run(shell(), wall("v1", { x: 3, y: 0 }, { x: 3, y: 1.25 }), wall("h1", { x: 0, y: 1.25 }, { x: 3, y: 1.25 }),
      wall("h2", { x: 3, y: 1.25 }, { x: 7, y: 1.25 }), wall("v2", { x: 3, y: 1.25 }, { x: 3, y: 2.5 }));
    for (const [p, q] of [[{ x: 3, y: 0 }, { x: 3, y: 1.25 }], [{ x: 3, y: 1.25 }, { x: 3, y: 2.5 }]] as const) doc = run(doc, top(wallBetween(doc, p, q), 1.1));
    const atCross = allCaps(doc).filter((c) => c.ring.every((p) => Math.abs(p.x - 3) < 0.2 && Math.abs(p.y - 1.25) < 0.2));
    expect(atCross).toHaveLength(2);
    for (const c of atCross) expect(c.bottom).toBeCloseTo(1.1, 9);
  });

  it("no cap when the share is as tall as a neighbour", () => {
    let doc = partitioned();
    const west = wallBetween(doc, { x: 0, y: 0 }, { x: 1.5, y: 0 });
    doc = run(doc, top(west, 2.03));
    expect(allCaps(doc).filter((c) => c.ring.every((p) => p.y < 0.2))).toEqual([]);
  });

  it("no cap at an L or a straight joint", () => {
    let doc = run(emptyDocument(), wall("a", { x: 0, y: 0 }, { x: 3, y: 0 }), wall("b", { x: 3, y: 0 }, { x: 3, y: 3 }), wall("c", { x: 3, y: 3 }, { x: 6, y: 3 }));
    doc = run(doc, top(wallBetween(doc, { x: 3, y: 0 }, { x: 3, y: 3 }), 1.1));
    expect(allCaps(doc)).toEqual([]);
  });

  it("a drawing whose walls all reach the ceiling gets no caps (AC-07)", () => {
    const doc = run(shell(), wall("part", { x: 1.5, y: 0 }, { x: 1.5, y: 2.5 }));
    expect(allCaps(doc)).toEqual([]);
    for (const w of wallItems(doc)) expect(w.caps).toEqual([]);
  });

  it("random drawings: a cap exactly where a share sits below both neighbours, on the lower one, from the share's top (AC-07)", () => {
    let seed = 7;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const tops = [1.1, 2.03, 2.5, "full"] as const;
    let capped = 0;
    for (let n = 0; n < 40; n++) {
      let doc = shell();
      // Fins from the south wall to y 1.25, maybe on to the north wall, maybe a wall across at y 1.25 through their
      // ends: Ts on the shell, crossings and Ts where they meet (walls can't cross, so each meets at a joint).
      const xs = [1 + Math.floor(rand() * 2.5), 4 + Math.floor(rand() * 2.5)];
      for (const [i, x] of xs.entries()) doc = run(doc, wall(`v${i}`, { x, y: 0 }, { x, y: 1.25 }));
      if (rand() < 0.6) {
        const stops = [0, ...xs, 7];
        for (let k = 0; k + 1 < stops.length; k++) doc = run(doc, wall(`h${k}`, { x: stops[k] ?? 0, y: 1.25 }, { x: stops[k + 1] ?? 7, y: 1.25 }));
      }
      for (const [i, x] of xs.entries()) if (rand() < 0.5) doc = run(doc, wall(`u${i}`, { x, y: 1.25 }, { x, y: 2.5 }));
      for (const id of Object.keys(doc.walls).sort()) {
        const t = tops[Math.floor(rand() * tops.length)];
        if (t !== undefined && t !== "full") doc = run(doc, top(id, t));
      }
      // The oracle: neighbours by angle around each joint of three or more walls, computed here.
      const expected: string[] = [];
      for (const [jointId, ids] of jointWalls(doc)) {
        if (ids.length < 3) continue;
        const j = doc.joints[jointId];
        if (!j) continue;
        const angle = (id: string): number => {
          const w = doc.walls[id];
          const o = w && doc.joints[w.a === jointId ? w.b : w.a];
          return o ? Math.atan2(o.y - j.y, o.x - j.x) : 0;
        };
        const sorted = [...ids].sort((a, b) => angle(a) - angle(b) || (a < b ? -1 : 1));
        const topOf = (id: string): number => wallRange(doc, id)?.top ?? 0;
        sorted.forEach((id, i) => {
          const next = sorted[(i + 1) % sorted.length] ?? id;
          const prev = sorted[(i - 1 + sorted.length) % sorted.length] ?? id;
          if (topOf(id) >= Math.min(topOf(next), topOf(prev)) - 1e-9) return;
          const owner = topOf(next) < topOf(prev) - 1e-9 ? next : topOf(prev) < topOf(next) - 1e-9 ? prev : next < prev ? next : prev;
          expected.push(`${owner}@${topOf(id).toFixed(3)}`);
        });
      }
      capped += expected.length;
      const found = allCaps(doc).map((c) => `${c.owner}@${c.bottom.toFixed(3)}`);
      expect(found.sort(), `drawing ${n}`).toEqual(expected.sort());
      // Each cap is a piece of the shorter wall's outline: its points are that outline's points.
      const outlinePoints = [...wallOutlines(doc).values()].flat();
      for (const c of allCaps(doc)) {
        expect(Math.abs(area(c.ring)), `drawing ${n}`).toBeGreaterThan(1e-6);
        for (const p of c.ring) expect(outlinePoints.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9), `drawing ${n}`).toBe(true);
      }
    }
    expect(capped).toBeGreaterThan(20); // the drawings do raise caps
  });
});

describe("caps in the scene", () => {
  it("the studio's T joints are capped to 3.05: straight down, the first surface over each share is at 3.05 (AC-06)", () => {
    const doc = partitioned();
    const faces = sceneFaces({ items: view3dItems(doc, "s0", null, new Set(), false), hidden: new Set() });
    expect(highestOver(faces, { x: 1.5, y: 0.06 })).toBeCloseTo(3.05, 9);
    expect(highestOver(faces, { x: 1.5, y: 2.44 })).toBeCloseTo(3.05, 9);
  });

  it("the cap hides with its owner (AC-08)", () => {
    const doc = partitioned();
    const owner = [wallBetween(doc, { x: 0, y: 0 }, { x: 1.5, y: 0 }), wallBetween(doc, { x: 1.5, y: 0 }, { x: 7, y: 0 })].sort()[0] ?? "";
    const items = view3dItems(doc, "s0", null, new Set(), false);
    expect(highestOver(sceneFaces({ items, hidden: new Set([owner]) }), { x: 1.5, y: 0.06 })).toBeLessThan(3);
    expect(highestOver(sceneFaces({ items, hidden: new Set() }), { x: 1.5, y: 0.06 })).toBeCloseTo(3.05, 9);
  });
});
