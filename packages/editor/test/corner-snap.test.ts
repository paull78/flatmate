import { describe, expect, it } from "vitest";
import { emptyDocument, execute, footprintFit, footprintQuad, levelOf, rectangleRoom, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { contactPlace } from "../src/snapping/contact";
import type { ObjectGhost } from "../src/tools/types";
import { roomDoc, wallBetween, withCommands, ON_FLOOR } from "./builders";
import { FakeShell } from "./fake-shell";

// Shape-aware corner snap (furnish.18, .22; AC-14): a corner kind (outline quarter or corner) that touch to turn leaves
// touching two wall faces at a right angle takes the one turn that puts its back-left corner, the shape's right angle,
// on the faces' corner. roomDoc's inner faces are x 0.1 / 5.9, y 0.1 / 3.9; zoom 80 gives a tolerance of 0.125 m.
// `at` is the middle of the back edge; footprintQuad gives [front-left q0, front-right q1, back-right q2, back-left q3].

const T = 0.125;
const ROOM = roomDoc();
const TOP = wallBetween(ROOM, { x: 0, y: 4 }, { x: 6, y: 4 });
const LEFT = wallBetween(ROOM, { x: 0, y: 0 }, { x: 0, y: 4 });
const BOTTOM = wallBetween(ROOM, { x: 0, y: 0 }, { x: 6, y: 0 });
const RIGHT = wallBetween(ROOM, { x: 6, y: 0 }, { x: 6, y: 4 });

type CornerName = "TL" | "BL" | "BR" | "TR";
type Corner = { name: CornerName; c: Point; rotation: number; inward: Point; walls: string[] };
const CORNERS: readonly Corner[] = [
  { name: "TL", c: { x: 0.1, y: 3.9 }, rotation: 0, inward: { x: 1, y: -1 }, walls: [TOP, LEFT] },
  { name: "BL", c: { x: 0.1, y: 0.1 }, rotation: 90, inward: { x: 1, y: 1 }, walls: [LEFT, BOTTOM] },
  { name: "BR", c: { x: 5.9, y: 0.1 }, rotation: 180, inward: { x: -1, y: 1 }, walls: [BOTTOM, RIGHT] },
  { name: "TR", c: { x: 5.9, y: 3.9 }, rotation: 270, inward: { x: -1, y: -1 }, walls: [RIGHT, TOP] },
];
const SIZE: Readonly<Record<string, number>> = { cornerShower: 0.8, cornerBasin: 0.45, cornerBlock: 0.6 };
const sizeOf = (kind: string): number => {
  const s = SIZE[kind];
  if (s === undefined) throw new Error(`no size for ${kind}`);
  return s;
};

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r2 = (v: number): number => Math.round(v * 100) / 100;
/** The centre of a square piece of side `s` sitting exactly in `k`. */
const exactCentre = (k: Corner, s: number): Point => ({ x: r3(k.c.x + (k.inward.x * s) / 2), y: r3(k.c.y + (k.inward.y * s) / 2) });
/** The anchor of a square piece of side `s` sitting exactly in `k` at the corner's rotation: C + (s/2)(cos r, sin r). */
const exactAt = (k: Corner, s: number): Point => {
  const a = (k.rotation * Math.PI) / 180;
  return { x: r3(k.c.x + (s / 2) * Math.cos(a)) + 0, y: r3(k.c.y + (s / 2) * Math.sin(a)) + 0 };
};
/** The table's pointer: the exact centre moved 0.03 (shower) or 0.035 (basin) into the room on both axes. */
const pointer = (k: Corner, kind: string): Point => {
  const e = exactCentre(k, sizeOf(kind));
  const m = kind === "cornerShower" ? 0.03 : 0.035;
  return { x: r3(e.x + k.inward.x * m), y: r3(e.y + k.inward.y * m) };
};

/** q3 (back-left) on C, the back edge on one face and the left side on the other (each within 1 mm). */
function onCorner(at: Point, w: number, d: number, r: number, c: Point): boolean {
  const [q0, , q2, q3] = footprintQuad(at, w, d, r);
  if (!q0 || !q2 || !q3) return false;
  if (Math.hypot(q3.x - c.x, q3.y - c.y) >= 0.001) return false;
  const shares = (q: Point): { x: boolean; y: boolean } => ({ x: Math.abs(q.x - c.x) < 0.001, y: Math.abs(q.y - c.y) < 0.001 });
  const s2 = shares(q2);
  const s0 = shares(q0);
  return s2.x !== s2.y && s0.x !== s0.y && s2.x !== s0.x;
}

function cp(doc: Document, kind: string | undefined, size: { w: number; d: number }, centre: Point, start: number, free = false) {
  return contactPlace(doc, "s0", size, centre, start, { tolerance: T, free, ignore: [], riser: null, heights: ON_FLOOR, surface: null, land: false, level: levelOf(doc, null), ...(kind === undefined ? {} : { kind }) });
}

describe("cornerTurn", () => {
  it("each corner has one turn, whatever the start angle (AC-14)", () => {
    for (const kind of ["cornerShower", "cornerBasin"]) {
      const s = sizeOf(kind);
      for (const k of CORNERS) {
        for (const start of [0, 90, 180, 270]) {
          const got = cp(ROOM, kind, { w: s, d: s }, pointer(k, kind), start);
          const msg = `${kind} ${k.name} start ${start}: ${JSON.stringify(got)}`;
          expect(got.rotation, msg).toBe(k.rotation);
          expect(got.at, msg).toEqual(exactAt(k, s));
          expect(onCorner(got.at, s, s, got.rotation, k.c), msg).toBe(true);
          expect(new Set(got.flushWalls), msg).toEqual(new Set(k.walls));
        }
      }
    }
  });

  it("the table's landings, spelled out", () => {
    expect(cp(ROOM, "cornerShower", { w: 0.8, d: 0.8 }, { x: 5.47, y: 3.47 }, 0)).toMatchObject({ at: { x: 5.9, y: 3.5 }, rotation: 270 });
    expect(cp(ROOM, "cornerShower", { w: 0.8, d: 0.8 }, { x: 0.53, y: 3.47 }, 90)).toMatchObject({ at: { x: 0.5, y: 3.9 }, rotation: 0 });
    expect(cp(ROOM, "cornerBasin", { w: 0.45, d: 0.45 }, { x: 5.64, y: 0.36 }, 0)).toMatchObject({ at: { x: 5.675, y: 0.1 }, rotation: 180 });
    expect(cp(ROOM, "cornerBasin", { w: 0.45, d: 0.45 }, { x: 0.36, y: 0.36 }, 270)).toMatchObject({ at: { x: 0.1, y: 0.325 }, rotation: 90 });
  });

  it("rect and round kinds keep step 03's tie-break", () => {
    const wardrobe = { at: { x: 5.3, y: 3.9 }, rotation: 0 };
    expect(cp(ROOM, "wardrobe", { w: 1.2, d: 0.6 }, { x: 5.27, y: 3.57 }, 0)).toMatchObject(wardrobe);
    expect(cp(ROOM, undefined, { w: 1.2, d: 0.6 }, { x: 5.27, y: 3.57 }, 0)).toMatchObject(wardrobe);
    expect(cp(ROOM, "roundBlock", { w: 0.6, d: 0.6 }, { x: 5.57, y: 3.57 }, 0)).toMatchObject({ at: { x: 5.6, y: 3.9 }, rotation: 0 });
  });

  it("a non-square corner piece turns its long side along the second face", () => {
    const got = cp(ROOM, "cornerBlock", { w: 1.2, d: 0.6 }, { x: 5.27, y: 3.57 }, 0);
    expect(got).toMatchObject({ at: { x: 5.9, y: 3.3 }, rotation: 270 });
    const xs = footprintQuad(got.at, 1.2, 0.6, got.rotation).map((p) => p.x);
    const ys = footprintQuad(got.at, 1.2, 0.6, got.rotation).map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(r3)).toEqual([5.3, 5.9, 2.7, 3.9]);
    expect(onCorner(got.at, 1.2, 0.6, got.rotation, { x: 5.9, y: 3.9 })).toBe(true);
  });

  it("a corner turn that doesn't fit keeps the generic result", () => {
    let small = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 1.7, 1.2)) small = unwrap(execute(small, cmd)).doc;
    // At 270 the 1.2 m side would run y −0.1 to 1.1, through the bottom wall.
    expect(cp(small, "cornerBlock", { w: 1.2, d: 0.6 }, { x: 0.97, y: 0.77 }, 0)).toMatchObject({ at: { x: 1, y: 1.1 }, rotation: 0 });
  });

  it("in a niche exactly the piece's width, the face behind the back picks the corner", () => {
    const stub: Command = { type: "addWall", opId: "stub", from: { at: { x: 0.65, y: 4 } }, to: { at: { x: 0.65, y: 3 } } };
    const niche = withCommands(roomDoc(), stub); // faces x 0.55 / 0.75 for y 3.0–3.9: the niche is x 0.1–0.55
    const size = { w: 0.45, d: 0.45 };
    const a = cp(niche, "cornerBasin", size, { x: 0.33, y: 3.64 }, 0);
    expect(a).toMatchObject({ at: { x: 0.325, y: 3.9 }, rotation: 0 });
    expect(onCorner(a.at, 0.45, 0.45, a.rotation, { x: 0.1, y: 3.9 })).toBe(true);
    const b = cp(niche, "cornerBasin", size, { x: 0.33, y: 3.64 }, 270);
    expect(b).toMatchObject({ at: { x: 0.55, y: 3.675 }, rotation: 270 });
    expect(onCorner(b.at, 0.45, 0.45, b.rotation, { x: 0.55, y: 3.9 })).toBe(true);
  });

  it("a piece already in the corner at its turn keeps touch to turn's anchor, faces off the millimetre included", () => {
    // 0.125 m walls: the inner faces x 1.1125 and y 3.8975 lie between millimetres. Touch to turn rounds the anchor
    // to (1.573, 3.898); the corner's own C + w/2 would round to 1.572 and nudge the piece 1 mm for nothing.
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 1.05, y: 2.42 }, 3.83, 1.54, "r", 0.125)) doc = unwrap(execute(doc, cmd)).doc;
    const opts = { tolerance: 0.0625, free: false, ignore: [], riser: null, heights: ON_FLOOR, surface: null, land: false as const, level: levelOf(doc, null) };
    const generic = contactPlace(doc, "s0", { w: 0.92, d: 0.92 }, { x: 1.63, y: 3.44 }, 270, opts);
    expect(generic).toMatchObject({ at: { x: 1.573, y: 3.898 }, rotation: 0 });
    expect(contactPlace(doc, "s0", { w: 0.92, d: 0.92 }, { x: 1.63, y: 3.44 }, 270, { ...opts, kind: "cornerBasin" })).toMatchObject({ at: generic.at, rotation: 0 });
  });

  it("in a room drawn at 30°, a corner piece lands in each corner from any start (faces 1 mm off, as touch to turn)", () => {
    const a = Math.PI / 6;
    const turn = (p: Point): Point => ({ x: r3(p.x * Math.cos(a) - p.y * Math.sin(a)) + 0, y: r3(p.x * Math.sin(a) + p.y * Math.cos(a)) + 0 });
    const ps = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }].map(turn);
    const doc = withCommands(emptyDocument(), ...ps.map((p, i): Command => ({ type: "addWall", opId: `s${i}`, from: { at: p }, to: { at: ps[(i + 1) % 4] ?? p } })));
    const local = [{ c: { x: 0.1, y: 0.1 }, inward: { x: 1, y: 1 } }, { c: { x: 3.9, y: 0.1 }, inward: { x: -1, y: 1 } }, { c: { x: 3.9, y: 2.9 }, inward: { x: -1, y: -1 } }, { c: { x: 0.1, y: 2.9 }, inward: { x: 1, y: -1 } }];
    for (const { c, inward } of local) {
      for (const start of [30, 120, 210, 300]) {
        const centre = turn({ x: c.x + inward.x * 0.43, y: c.y + inward.y * 0.43 }); // 0.03 off both faces
        const got = cp(doc, "cornerShower", { w: 0.8, d: 0.8 }, { x: r2(centre.x), y: r2(centre.y) }, start);
        const corner = turn(c);
        const q3 = footprintQuad(got.at, 0.8, 0.8, got.rotation)[3];
        const msg = `corner ${JSON.stringify(c)} start ${start}: ${JSON.stringify(got)}`;
        expect(q3 && Math.hypot(q3.x - corner.x, q3.y - corner.y), msg).toBeLessThan(0.003);
        expect(footprintFit(doc, footprintQuad(got.at, 0.8, 0.8, got.rotation), "s0", ON_FLOOR, null).fits, msg).toBe(true);
      }
    }
  });

  it("Ctrl (free) applies no corner turn", () => {
    expect(cp(ROOM, "cornerShower", { w: 0.8, d: 0.8 }, { x: 5.47, y: 3.47 }, 0, true)).toEqual({ at: { x: 5.47, y: 3.87 }, rotation: 0, flushWalls: [] });
  });

  it("stateless", () => {
    const size = { w: 0.8, d: 0.8 };
    const first = cp(ROOM, "cornerShower", size, { x: 5.47, y: 3.47 }, 0);
    cp(ROOM, "cornerShower", size, { x: 0.53, y: 0.53 }, 0);
    expect(cp(ROOM, "cornerShower", size, { x: 5.47, y: 3.47 }, 0)).toEqual(first);
  });
});

// ---- gestures ----

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const s0 = (shell: FakeShell) => Object.values(shell.doc().placements).filter((p) => p.state === "s0");

function shellOn(doc: Document, zoom = 80): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  return shell;
}

/** A fresh shell on roomDoc with `kind` armed and R pressed `n` times. */
function armed(kind: string, n: number, zoom = 80): FakeShell {
  const shell = shellOn(roomDoc(), zoom);
  shell.ui({ type: "pickKind", kind });
  for (let i = 0; i < n; i++) shell.key("r");
  return shell;
}

/** Selects the piece under `first` and picks it up with Cmd+D (as ghost-parity.test.ts). */
function pickUp(shell: FakeShell, first: Point): void {
  shell.click(first);
  shell.key("d", { meta: true });
}

const copies = (shell: FakeShell): { at: Point; rotation: number }[] =>
  shell.state.selection
    .flatMap((r) => {
      const p = r.table === "placements" ? shell.doc().placements[r.id] : undefined;
      return p ? [{ at: p.at, rotation: p.rotation }] : [];
    })
    .sort((a, b) => a.at.x - b.at.x);

const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at });

describe("corner pieces in the editor (AC-14)", () => {
  it("the Object tool drops a corner shower and a corner basin into all four corners with no key held", () => {
    for (const kind of ["cornerShower", "cornerBasin"]) {
      const s = sizeOf(kind);
      for (const k of CORNERS) {
        for (let n = 0; n < 4; n++) {
          const shell = armed(kind, n);
          const p = pointer(k, kind);
          shell.moveTo(p);
          const g = ghost(shell);
          const msg = `${kind} ${k.name} R×${n}: ${JSON.stringify(g)}`;
          expect(g, msg).toMatchObject({ rotation: k.rotation, at: exactAt(k, s), fits: true });
          shell.click(p);
          const placed = s0(shell);
          expect(placed.length, msg).toBe(1);
          const [only] = placed;
          if (!only || !g) throw new Error(msg);
          expect({ at: only.at, rotation: only.rotation }, msg).toEqual({ at: g.at, rotation: g.rotation });
          expect(onCorner(only.at, s, s, only.rotation, k.c), msg).toBe(true);
        }
      }
    }
  });

  it("along the top wall into the top-right corner the shower turns once, at the corner", () => {
    const shell = armed("cornerShower", 0);
    for (let i = 300; i <= 547; i++) {
      const x = i / 100;
      shell.moveTo({ x, y: 3.47 });
      const g = ghost(shell);
      const msg = `x ${x}: ${JSON.stringify(g)}`;
      expect(g?.fits, msg).toBe(true);
      if (x <= 5.37) {
        expect(g?.rotation, msg).toBe(0);
        expect(g?.at.y, msg).toBe(3.9);
      } else {
        expect(g, msg).toMatchObject({ rotation: 270, at: { x: 5.9, y: 3.5 } });
      }
    }
  });

  it("down the right wall out of the corner the angle never changes", () => {
    const shell = armed("cornerShower", 0);
    for (let i = 347; i >= 200; i--) {
      const y = i / 100;
      shell.moveTo({ x: 5.47, y });
      const g = ghost(shell);
      const msg = `y ${y}: ${JSON.stringify(g)}`;
      expect(g?.rotation, msg).toBe(270);
      expect(g?.at.x, msg).toBe(5.9);
      expect(g?.at.y, msg).toBe(y >= 3.38 ? 3.5 : y);
    }
  });

  it("a Select drag into a corner takes the corner turn", () => {
    const shell = shellOn(withCommands(roomDoc(), place("cb", "cornerBasin", { x: 3, y: 2.225 })));
    // Pressed 5 cm in from the long side (the footprint's centre lies on it, outside the triangle's hit, shapefit.01).
    shell.drag({ x: 2.95, y: 2.05 }, { x: 5.55, y: 3.65 }); // stepped centre (5.6, 3.6): both gaps 0.075
    expect(shell.doc().placements["cb/p0"]).toMatchObject({ at: { x: 5.9, y: 3.675 }, rotation: 270 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a Select drag's corner turn ignores the piece's own old footprint", () => {
    // cb/p0 sits in the top-right corner at rotation 0: x 5.45–5.9, y 3.45–3.9. At zoom 40 (tolerance 0.25 m) a drag
    // 0.2 m to the left keeps the right gap within reach; the corner turn lands on the old footprint, which must not count.
    const shell = shellOn(withCommands(roomDoc(), place("cb", "cornerBasin", { x: 5.675, y: 3.9 })), 40);
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.drag({ x: 5.625, y: 3.725 }, { x: 5.425, y: 3.725 }); // pressed inside the triangle (shapefit.01)
    expect(shell.doc().placements["cb/p0"]).toMatchObject({ at: { x: 5.9, y: 3.675 }, rotation: 270 });
  });

  it("a duplicate's ghost takes the corner turn", () => {
    const shell = shellOn(withCommands(roomDoc(), place("cb", "cornerBasin", { x: 2.775, y: 3.9 })));
    pickUp(shell, { x: 2.725, y: 3.725 }); // inside the triangle (shapefit.01)
    shell.moveTo({ x: 5.58, y: 3.68 }); // raw delta (2.805, 0.005) steps to (2.8, 0): centre (5.575, 3.675), right gap 0.1
    shell.click({ x: 5.58, y: 3.68 });
    expect(copies(shell)).toEqual([{ at: { x: 5.9, y: 3.675 }, rotation: 270 }]);
  });

  it("Ctrl keeps the start angle", () => {
    const shell = armed("cornerShower", 0);
    shell.click({ x: 5.47, y: 3.47 }, { ctrl: true });
    expect(s0(shell).map((p) => ({ at: p.at, rotation: p.rotation }))).toEqual([{ at: { x: 5.47, y: 3.87 }, rotation: 0 }]);
  });
});

// ---- fuzz ----

/** mulberry32, as look.test.ts `rng`: a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["cornerShower", "cornerBasin", "cornerBlock"];
const ZOOMS = [40, 80, 160];
const pick = <T,>(random: () => number, xs: readonly T[]): T => {
  const x = xs[Math.floor(random() * xs.length)];
  if (x === undefined) throw new Error("empty pick");
  return x;
};

/** The room corner whose two faces `quad`'s bounding box lies within 1 mm of, or null. */
function flushCorner(quad: readonly Point[]): Corner | null {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  for (const k of CORNERS) {
    const xFace = k.c.x < 3 ? box.minX : box.maxX;
    const yFace = k.c.y < 2 ? box.minY : box.maxY;
    if (Math.abs(xFace - k.c.x) <= 0.001 && Math.abs(yFace - k.c.y) <= 0.001) return k;
  }
  return null;
}

describe("corner snap fuzz", () => {
  it("dropped near any corner, from any quarter turn, at zooms 40/80/160, a corner kind lands on the corner", () => {
    const seed = 1414;
    const random = rng(seed);
    let drops = 0;
    for (const kind of KINDS) {
      const s = sizeOf(kind);
      for (const k of CORNERS) {
        for (let n = 0; n < 4; n++) {
          for (let i = 0; i < 6; i++) {
            const zoom = pick(random, ZOOMS);
            const tol = 10 / zoom;
            const u = r2(-0.3 * tol + random() * tol);
            const v = r2(-0.3 * tol + random() * tol);
            const e = exactCentre(k, s);
            const p = { x: r3(e.x + k.inward.x * u), y: r3(e.y + k.inward.y * v) };
            const shell = armed(kind, n, zoom);
            shell.moveTo(p);
            const g = ghost(shell);
            const msg = `seed ${seed}: ${kind} ${k.name} R×${n} zoom ${zoom} P ${JSON.stringify(p)}: ${JSON.stringify(g)}`;
            if (!g) throw new Error(msg);
            expect(g.fits, msg).toBe(true);
            expect(g.rotation, msg).toBe(k.rotation);
            expect(onCorner(g.at, s, s, g.rotation, k.c), msg).toBe(true);
            shell.click(p);
            expect(s0(shell).map((q) => ({ at: q.at, rotation: q.rotation })), msg).toEqual([{ at: g.at, rotation: g.rotation }]);
            drops++;
          }
        }
      }
    }
    expect(drops).toBe(288);
  });

  it("approach paths: never flush in a corner with the wrong turn, and path-independent", () => {
    const seed = 2718;
    const random = rng(seed);
    for (let path = 0; path < 40; path++) {
      const kind = pick(random, KINDS);
      const k = pick(random, CORNERS);
      const n = Math.floor(random() * 4);
      const zoom = pick(random, ZOOMS);
      const s = sizeOf(kind);
      const e = exactCentre(k, s);
      const dist = 1 + random() * 0.5;
      const theta = random() * (Math.PI / 2);
      const from = { x: e.x + k.inward.x * dist * Math.cos(theta), y: e.y + k.inward.y * dist * Math.sin(theta) };
      const to = { x: e.x + k.inward.x * 0.02, y: e.y + k.inward.y * 0.02 };
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.02);
      const shell = armed(kind, n, zoom);
      let last: ObjectGhost | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        shell.moveTo(p);
        const g = ghost(shell);
        const msg = `seed ${seed} path ${path}: ${kind} ${k.name} R×${n} zoom ${zoom} step ${i} P ${JSON.stringify(p)}: ${JSON.stringify(g)}`;
        if (!g) throw new Error(msg);
        last = g;
        if (g.fits) {
          const quad = footprintQuad(g.at, s, s, g.rotation);
          const flush = flushCorner(quad);
          const q3 = quad[3];
          if (flush && q3) expect(Math.hypot(q3.x - flush.c.x, q3.y - flush.c.y), `${msg} flush in ${flush.name}`).toBeLessThan(0.001);
        }
        if (i % 10 === 0) {
          const fresh = armed(kind, n, zoom);
          fresh.moveTo(p);
          expect(ghost(fresh), msg).toEqual(g);
        }
      }
      expect(last?.rotation, `seed ${seed} path ${path}: ${kind} ${k.name} R×${n} zoom ${zoom}`).toBe(k.rotation);
    }
  });
});
