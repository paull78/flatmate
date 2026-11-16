import { describe, expect, it } from "vitest";
import { footprints, type Command, type Document } from "@fm/domain";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { clearRoomDoc, nichesDoc, roomDoc, studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
/** The ghost footprints in the overlays: polygons in the ghost or the refused fill. */
const ghosts = (shell: FakeShell, color: string = COLORS.ghostFill) =>
  overlays(shell).flatMap((p) => (p.kind === "polygon" && p.color === color ? [p.points] : []));
const centreOf = (q: readonly { x: number; y: number }[]) => ({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length });

const placements = (shell: FakeShell) => Object.values(shell.doc().placements);
/** The Object tool's ghost, or null in another tool. */
const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
/** The Object tool's start angle, or null in another tool. */
const startAngle = (shell: FakeShell): number | null => (shell.state.tool.name === "object" ? shell.state.tool.state.rotation : null);

describe("the Object tool (spec: layouts)", () => {
  it("O, then a click inside the room places a bed centred on the click (anchored at its back edge) in the active layout; the tool stays armed; Esc returns to Select", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    expect(shell.view().activeTool).toBe("object");
    shell.click({ x: 3, y: 2 });
    expect(placements(shell)).toEqual([expect.objectContaining({ state: "s0", at: { x: 3, y: 3.05 }, rotation: 0, config: "standard" })]); // 2.10 deep
    expect(Object.values(shell.doc().objects).map((o) => o.kind)).toEqual(["bed"]);
    expect(shell.view().activeTool).toBe("object");
    shell.click({ x: 3, y: 3.5 }); // overlaps the first bed: refused
    expect(placements(shell)).toHaveLength(1);
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("pickKind arms a kind from the palette and picks the Object tool", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "desk" });
    expect(shell.view().activeTool).toBe("object");
    expect(shell.view().objectKind).toBe("desk");
    shell.click({ x: 3, y: 2 });
    expect(Object.values(shell.doc().objects).map((o) => o.kind)).toEqual(["desk"]);
  });

  it("a click over a wall places nothing and toasts the reason (AC-02)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.click({ x: 3, y: 0.6 });
    expect(placements(shell)).toEqual([]);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Layout");
  });

  it("the murphy bed from the palette is placed folded, though its tile shows it down (ux-polish.32)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "murphyBed" });
    shell.click({ x: 3, y: 2 });
    expect(placements(shell)).toEqual([expect.objectContaining({ config: "folded" })]);
  });

  it("places into the layout being looked at", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.click({ x: 4.5, y: 2 });
    expect(placements(shell).filter((p) => p.state === "n/s0")).toHaveLength(1);
  });
});

describe("the Object tool's ghost (ux-polish item 1)", () => {
  it("with Bed armed, a pointer move over the floor draws one ghost centred on the pointer (AC-01)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 2 });
    const [ghost, ...more] = ghosts(shell);
    expect(more).toEqual([]);
    if (!ghost) throw new Error("no ghost");
    expect(centreOf(ghost).x).toBeCloseTo(3, 6);
    expect(centreOf(ghost).y).toBeCloseTo(2, 6);
  });

  it("a pointer that brings the bed's front 0.10 m from a wall face turns its back to that wall and lands it flush; the click places exactly the ghost (AC-01, furnish.16)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 1.25 }); // at 0 the footprint spans y 0.2–2.3, its front 0.10 m above the bottom wall's face (y = 0.1)
    const [ghost] = ghosts(shell);
    if (!ghost) throw new Error("no ghost");
    expect(Math.min(...ghost.map((p) => p.y))).toBeCloseTo(0.1, 6);
    shell.click({ x: 3, y: 1.25 });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 3, y: 0.1 }, rotation: 180 })]);
  });

  it("the reach is 10 px on screen", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 1.27 }); // the front 0.12 m from the face
    expect(ghost(shell)).toMatchObject({ rotation: 180, at: { x: 3, y: 0.1 } });
    shell.moveTo({ x: 3, y: 1.28 }); // 0.13 m: out of reach at zoom 80 (0.125 m)
    expect(ghost(shell)).toMatchObject({ rotation: 0, at: { x: 3, y: 2.33 } });
    shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: 40 } };
    shell.moveTo({ x: 3, y: 1.3 }); // 0.15 m: within 10 px at zoom 40 (0.25 m)
    expect(ghost(shell)).toMatchObject({ rotation: 180, at: { x: 3, y: 0.1 } });
  });

  it("a ghost pushed under 10 px across a wall snaps out flush, turned; pushed deeper it keeps its angle and is red", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 5.1, y: 2 }); // at 0 the bed spans x 4.25–5.95, 0.05 m across the right face
    expect(ghost(shell)).toMatchObject({ rotation: 270, at: { x: 5.9, y: 2 }, fits: true });
    const [turned] = ghosts(shell);
    if (!turned) throw new Error("no ghost");
    expect(Math.min(...turned.map((p) => p.x))).toBeCloseTo(3.8, 6);
    expect(Math.max(...turned.map((p) => p.x))).toBeCloseTo(5.9, 6);
    shell.moveTo({ x: 5.6, y: 2 }); // x 4.75–6.45: 0.55 m across, out of reach
    expect(ghost(shell)).toMatchObject({ rotation: 0, at: { x: 5.6, y: 3.05 }, fits: false });
    const [red, ...more] = ghosts(shell, COLORS.invalidFill);
    expect(more).toEqual([]);
    if (!red) throw new Error("no red ghost");
    const xs = red.map((p) => p.x);
    const ys = red.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.7, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.1, 6);
  });

  it("with Ctrl held the ghost stays axis-aligned and the click keeps rotation 0", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.click({ x: 3, y: 1.2 }, { ctrl: true });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 3, y: 2.25 }, rotation: 0 })]);
  });

  it("R then Ctrl keeps R's angle", () => {
    // At 90 the bed spans y 0.15–1.85: its left side 0.05 m from the bottom face. Without Ctrl it turns onto it.
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.key("r");
    shell.moveTo({ x: 3, y: 1 });
    expect(ghost(shell)).toMatchObject({ rotation: 180, at: { x: 3, y: 0.1 } });
    shell.click({ x: 3, y: 1 }, { ctrl: true });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 1.95, y: 1 }, rotation: 90 })]);
  });

  it("a ghost over a wall or over an object of the active layout is red, and a click there places nothing (AC-02)", () => {
    const shell = FakeShell.withDocument(studioDoc()); // a bed in Layout: x 0.7–2.3, y 1–3
    shell.key("o");
    shell.moveTo({ x: 3.5, y: 0.6 });
    expect(ghosts(shell, COLORS.invalidFill)).toHaveLength(1);
    expect(ghosts(shell)).toEqual([]);
    shell.moveTo({ x: 1.6, y: 2 });
    expect(ghosts(shell, COLORS.invalidFill)).toHaveLength(1);
    shell.click({ x: 1.6, y: 2 });
    expect(placements(shell)).toHaveLength(1);
    expect(shell.view().toast).toMatch(/overlap/);
  });

  it("a bed placed only in Layout does not make the ghost red in Night", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.moveTo({ x: 1.5, y: 2 });
    expect(ghosts(shell)).toHaveLength(1);
  });

  it("the ghost is gone after Esc and when the tool changes", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 2 });
    expect(ghosts(shell)).toHaveLength(1);
    shell.key("Escape");
    expect(ghosts(shell)).toEqual([]);
    shell.key("o");
    shell.moveTo({ x: 3, y: 2 });
    shell.key("w");
    expect(ghosts(shell)).toEqual([]);
  });

  it("the ghost is gone on pointer leave, and an undo does not bring it back (ux-polish.17)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    const all = () => [...ghosts(shell), ...ghosts(shell, COLORS.invalidFill)]; // red over the bed just placed
    shell.click({ x: 3, y: 2 });
    expect(all()).toHaveLength(1);
    shell.send({ type: "pointerLeave" });
    expect(all()).toEqual([]);
    expect(shell.state.pointer).toBeNull();
    shell.key("z", { ctrl: true }); // the undo replays the pointer: there is none
    expect(shell.doc().placements).toEqual({});
    expect(all()).toEqual([]);
    shell.moveTo({ x: 3, y: 2 });
    expect(ghosts(shell)).toHaveLength(1);
  });
});

describe("contact plus fit in the Object tool (AC-01–AC-03, furnish.16)", () => {
  // roomDoc's inner faces are x 0.1 / 5.9, y 0.1 / 3.9; zoom 80, so the tolerance is 0.125 m. A bed is 1.7 × 2.1, a
  // wardrobe 1.2 × 0.6. `at` is the middle of the back edge.
  const cm = (v: number): number => Math.round(v * 100) / 100;

  it("AC-01 (double bed): in a room 1.90 m wide the ghost never turns towards the side walls", () => {
    const shell = FakeShell.withDocument(clearRoomDoc(1.9, 2.6, "db")); // faces x 0.1 / 2.0, y 0.1 / 2.7
    shell.ui({ type: "pickKind", kind: "bed" });
    for (let i = 95; i <= 115; i++) {
      shell.moveTo({ x: i / 100, y: 1.4 }); // both sides within 0.125 m of a face; turned, the bed would not fit
      expect(ghost(shell), `x ${i / 100}`).toMatchObject({ rotation: 0, fits: true, at: { x: i / 100, y: 2.45 } });
    }
    shell.moveTo({ x: 1, y: 1.6 }); // the back 0.05 m from the head wall, the left side 0.05 m from the left wall
    expect(ghost(shell)).toMatchObject({ at: { x: 0.95, y: 2.7 }, rotation: 0 });
    const [g] = ghosts(shell);
    if (!g) throw new Error("no ghost");
    expect(Math.abs(Math.max(...g.map((p) => p.y)) - 2.7)).toBeLessThan(1e-3);
    expect(Math.abs(Math.min(...g.map((p) => p.x)) - 0.1)).toBeLessThan(1e-3);
    shell.click({ x: 1, y: 1.6 });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 0.95, y: 2.7 }, rotation: 0 })]);
  });

  it("AC-02: a wardrobe moved along the top wall into the corner and back out never turns", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    const xs: number[] = [];
    for (let x = 200; x >= 58; x--) xs.push(x / 100);
    for (let x = 59; x <= 200; x++) xs.push(x / 100);
    for (const x of xs) {
      shell.moveTo({ x, y: 3.55 }); // the back 0.05 m from the top face
      expect(ghost(shell), `x ${x}`).toMatchObject({ rotation: 0, at: { x: x >= 0.83 ? x : 0.7, y: 3.9 }, fits: true });
    }
    shell.click({ x: 0.75, y: 3.55 });
    const [placed, ...more] = placements(shell);
    expect(more).toEqual([]);
    expect(placed).toMatchObject({ at: { x: 0.7, y: 3.9 }, rotation: 0 });
    const quad = footprints(shell.doc()).get(Object.keys(shell.doc().placements)[0] ?? "") ?? [];
    expect(Math.abs(Math.min(...quad.map((p) => p.x)) - 0.1)).toBeLessThan(1e-3);
    expect(Math.abs(Math.max(...quad.map((p) => p.y)) - 3.9)).toBeLessThan(1e-3);
  });

  it("AC-03: a side reaching a wall in open floor turns the back onto it; after R the ghost keeps 90° through open floor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 0.75, y: 2 }); // the left side 0.05 m from the left face
    expect(ghost(shell)).toMatchObject({ rotation: 90, at: { x: 0.1, y: 2 } });
    shell.moveTo({ x: 0.84, y: 2 }); // 0.14 m: out of reach
    expect(ghost(shell)).toMatchObject({ rotation: 0, at: { x: 0.84, y: 2.3 } });
    shell.moveTo({ x: 3, y: 2 });
    shell.key("r"); // the ghost turns at once, with no move
    expect(ghost(shell)).toMatchObject({ rotation: 90, at: { x: 2.7, y: 2 } });
    for (let i = 10; i <= 54; i++) {
      const x = i / 10;
      shell.moveTo({ x, y: 2 });
      expect(ghost(shell), `x ${x}`).toMatchObject({ rotation: 90, at: { x: cm(x - 0.3), y: 2 } });
    }
  });

  it("a turn onto a wall that would overlap other furniture is refused: the ghost keeps its angle", () => {
    // Turned onto the left face the wardrobe would span x 0.1–0.7, y 1.4–2.6; a block at x 0.1–0.7, y 2.5–3.1 is in the way.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "k", state: "s0", object: { kind: "block" }, at: { x: 0.4, y: 3.1 } }));
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 0.75, y: 2 });
    expect(ghost(shell)).toMatchObject({ rotation: 0, at: { x: 0.75, y: 2.3 }, fits: true });
  });

  it("R turns the ghost 90° per press; four presses give 0 again; arming a kind resets it", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 2 });
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      shell.key("r");
      seen.push(startAngle(shell));
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    shell.key("r");
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(startAngle(shell)).toBe(0);
    shell.key("r");
    shell.key("r", { meta: true });
    expect(startAngle(shell)).toBe(90);

    const fresh = FakeShell.withDocument(roomDoc());
    fresh.key("o");
    fresh.key("r");
    expect(startAngle(fresh)).toBe(90);
    expect(ghost(fresh)).toBeNull();
  });

  it("fuzz (seeded): the click places exactly the ghost, and a turned ghost sits on a wall face", () => {
    const rand = rng(11);
    const pick = <T>(xs: readonly T[]): T => {
      const v = xs[Math.floor(rand() * xs.length)];
      if (v === undefined) throw new Error("empty pick");
      return v;
    };
    const cmIn = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    // The face the back meets at each start angle: its coordinate on the axis across it.
    const face: Record<number, (at: { x: number; y: number }) => number> = { 0: (a) => a.y - 3.9, 90: (a) => a.x - 0.1, 180: (a) => a.y - 0.1, 270: (a) => a.x - 5.9 };
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const shell = FakeShell.withDocument(studioDoc());
      const zoom = pick([20, 40, 80, 160]);
      shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
      const kind = pick(["bed", "wardrobe", "desk", "chair", "block"]);
      shell.ui({ type: "pickKind", kind });
      const n = Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) shell.key("r");
      const p = { x: cmIn(-0.3, 6.3), y: cmIn(-0.3, 4.3) };
      const mods = { ctrl: rand() < 0.2 };
      const tag = `#${i} ${kind} zoom ${zoom} R×${n} at (${p.x}, ${p.y})${mods.ctrl ? " ctrl" : ""}`;
      shell.moveTo(p, mods);
      const g = ghost(shell);
      if (!g) {
        failures.push(`${tag}: no ghost`);
        continue;
      }
      shell.click(p, mods);
      const added = Object.entries(shell.doc().placements).filter(([id, q]) => id !== "bed/p0" && q.state === "s0").map(([, q]) => ({ at: q.at, rotation: q.rotation }));
      const want = g.fits ? [{ at: g.at, rotation: g.rotation }] : [];
      if (JSON.stringify(added) !== JSON.stringify(want)) failures.push(`${tag}: ghost ${JSON.stringify(g)}, placed ${JSON.stringify(added)}`);
      const onFace = face[g.rotation];
      if (g.rotation !== (90 * n) % 360 && (!onFace || Math.abs(onFace(g.at)) > 1e-3)) failures.push(`${tag}: turned to ${g.rotation} off its face, at ${JSON.stringify(g.at)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("the Object tool's ghost aligns to pieces (AC-04)", () => {
  // S, a wardrobe (standing in for a sink unit) flush in the top-left corner: x 0.1–1.3, y 3.3–3.9. The armed block
  // is 0.60 × 0.60, like a kitchen module. Zoom 80: the tolerance is 10 px = 0.125 m.
  const place = (opId: string, kind: string, at: { x: number; y: number }): Command => ({ type: "placeObject", linked: false, deck: null, opId, state: "s0", object: { kind }, at });
  const S = place("s", "wardrobe", { x: 0.7, y: 3.9 });
  const armed = (doc: Document): FakeShell => {
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "pickKind", kind: "block" });
    return shell;
  };
  const guides = (shell: FakeShell) => overlays(shell).flatMap((p) => (p.kind === "segment" && p.color === COLORS.snapGuide ? [p] : []));
  const round = (v: number): number => +v.toFixed(6);
  /** Each guide as "x 1.3 3.3–3.9" (vertical) or "y 3.6 0.1–1.9" (horizontal), its span sorted, all sorted. */
  const guideLines = (shell: FakeShell): string[] =>
    guides(shell)
      .map((g) =>
        Math.abs(g.a.x - g.b.x) < 1e-9
          ? `x ${round(g.a.x)} ${round(Math.min(g.a.y, g.b.y))}–${round(Math.max(g.a.y, g.b.y))}`
          : `y ${round(g.a.y)} ${round(Math.min(g.a.x, g.b.x))}–${round(Math.max(g.a.x, g.b.x))}`,
      )
      .sort();
  /** The placement the click added: the one that isn't S's (or A's). */
  const added = (shell: FakeShell) => Object.entries(shell.doc().placements).filter(([id]) => id !== "s/p0" && id !== "a/p0").map(([, p]) => p);

  it("a click near the unit's side places the block touching it (AC-04)", () => {
    const shell = armed(withCommands(roomDoc(), S));
    shell.moveTo({ x: 1.65, y: 3.58 }); // the ghost's left edge 1.35 is 0.05 from S's right edge 1.30
    expect(ghosts(shell)).toHaveLength(1);
    expect(guideLines(shell)).toEqual(["x 1.3 3.3–3.9", "y 3.3 0.1–1.9", "y 3.6 0.1–1.9", "y 3.9 0.1–1.9"]);
    shell.click({ x: 1.65, y: 3.58 });
    const [p, ...rest] = added(shell);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ at: { x: 1.6, y: 3.9 }, rotation: 0 });
    const quad = p ? footprints(shell.doc()).get(p.id) : undefined;
    expect(Math.min(...(quad ?? []).map((c) => c.x)) - 1.3).toBeLessThan(0.001);
  });

  it("with a Sink unit flush in a corner and Hob unit armed, a click near its side places the hob touching it (AC-04)", () => {
    // The real kitchen modules: the sink unit, 0.80 × 0.60, spans x 0.1–0.9, y 3.3–3.9; the hob unit is 0.60 × 0.60.
    const shell = FakeShell.withDocument(withCommands(roomDoc(), place("s", "sinkUnit", { x: 0.5, y: 3.9 })));
    shell.ui({ type: "pickKind", kind: "hobUnit" });
    shell.click({ x: 1.25, y: 3.58 }); // the ghost's left edge 0.95 is 0.05 from the sink's right edge 0.90
    const [p, ...rest] = added(shell);
    expect(rest).toEqual([]);
    expect(p?.rotation).toBe(0);
    expect(p?.at.x).toBeCloseTo(1.2, 9); // without the alignment, 1.25
    expect(p?.at.y).toBeCloseTo(3.9, 9);
    const quad = p ? footprints(shell.doc()).get(p.id) : undefined;
    expect(Math.min(...(quad ?? []).map((c) => c.x)) - 0.9).toBeLessThan(0.001);
    expect(shell.doc().objects[p?.object ?? ""]?.kind).toBe("hobUnit");
  });

  it("a ghost overlapping the unit by 5 cm snaps out to touching and isn't red", () => {
    const shell = armed(withCommands(roomDoc(), S));
    shell.moveTo({ x: 1.55, y: 3.58 }); // the box x 1.25–1.85
    expect(ghosts(shell, COLORS.invalidFill)).toEqual([]);
    shell.click({ x: 1.55, y: 3.58 });
    expect(added(shell)).toEqual([expect.objectContaining({ at: { x: 1.6, y: 3.9 }, rotation: 0 })]);
  });

  it("sweep: the block takes the unit's edge exactly while its left edge is within 10 px", () => {
    const shell = armed(withCommands(roomDoc(), S));
    for (let i = 150; i <= 180; i++) {
      shell.moveTo({ x: i / 100, y: 3.58 });
      const g = ghost(shell);
      expect(g?.rotation, `i ${i}`).toBe(0);
      expect(g?.at.y, `i ${i}`).toBe(3.9);
      expect(g?.fits, `i ${i}`).toBe(true);
      // Gaps up to 0.12 snap; from 0.13 the pointer's centimetre stands, never the 0.2 step (direct.19, direct.57).
      if (i <= 172) expect(g?.at.x, `i ${i}`).toBe(1.6);
      else expect(g?.at.x, `i ${i}`).toBeCloseTo(i / 100, 6);
    }
  });

  it("the tolerance is 10 px on screen", () => {
    const far = armed(withCommands(roomDoc(), S));
    far.state = { ...far.state, camera: { ...far.state.camera, zoom: 40 } }; // 0.25 m
    far.click({ x: 1.78, y: 3.58 }); // the left edge 1.48 is 0.18 from 1.30
    expect(added(far)).toEqual([expect.objectContaining({ at: { x: 1.6, y: 3.9 } })]);
    const near = armed(withCommands(roomDoc(), S));
    near.click({ x: 1.78, y: 3.58 });
    expect(added(near)).toEqual([expect.objectContaining({ at: { x: 1.78, y: 3.9 } })]);
  });

  it("with Ctrl: no wall flush, no guide, none drawn", () => {
    const shell = armed(withCommands(roomDoc(), S));
    shell.moveTo({ x: 1.6, y: 3.6 }, { ctrl: true }); // the box x 1.3–1.9, y 3.3–3.9 lies exactly on S's lines
    expect(guides(shell)).toEqual([]);
    shell.click({ x: 1.65, y: 3.58 }, { ctrl: true });
    expect(added(shell)).toEqual([expect.objectContaining({ at: { x: 1.65, y: 3.88 }, rotation: 0 })]);
  });

  it("a red ghost draws no guides", () => {
    const shell = armed(withCommands(roomDoc(), S));
    shell.moveTo({ x: 0.7, y: 3.5 }); // the back flushes to 3.9: x 0.4–1.0, y 3.3–3.9, on top of S
    expect(ghosts(shell, COLORS.invalidFill)).toHaveLength(1);
    expect(guides(shell)).toEqual([]);
  });

  it("the wall wins over a guide on its axis", () => {
    // A, a block 0.05 m below the top face: y 3.25–3.85. The ghost's free y lines are 0.03 from A's, but the top wall
    // holds y; a build where the guide won would give y 3.85.
    const shell = armed(withCommands(roomDoc(), place("a", "block", { x: 2.8, y: 3.85 })));
    shell.moveTo({ x: 2, y: 3.58 });
    expect(guideLines(shell)).toEqual([]);
    shell.click({ x: 2, y: 3.58 });
    expect(added(shell)).toEqual([expect.objectContaining({ at: { x: 2, y: 3.9 } })]);
  });
});

describe("drawing a footprint (AC-05)", () => {
  const objects = (shell: FakeShell) => Object.values(shell.doc().objects);
  const armedWith = (doc: Document, kind: string): FakeShell => {
    const shell = FakeShell.withDocument(doc);
    shell.ui({ type: "pickKind", kind });
    return shell;
  };

  it("the Object tool places on release, not on press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("o");
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    expect(placements(shell)).toEqual([]);
    shell.up({ x: 3, y: 2 });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 3, y: 3.05 }, rotation: 0 })]);
    expect(objects(shell).map((o) => o.kind)).toEqual(["bed"]);
  });

  it("AC-05: a drag across the wardrobe niche places one 1.20 × 0.60 wardrobe, back on the niche's back wall; one Undo removes it", () => {
    const shell = armedWith(nichesDoc(), "wardrobe");
    shell.ui({ type: "pickPreset", kind: "wardrobe", preset: "100 × 60" }); // the drawn size wins over the picker
    shell.moveTo({ x: 1.13, y: 3.87 });
    shell.down({ x: 1.13, y: 3.87 }); // snaps to the face corner (1.1, 3.9)
    shell.moveTo({ x: 1.7, y: 3.6 });
    shell.moveTo({ x: 2.27, y: 3.33 }); // snaps to fin t2's end corner (2.3, 3.3)
    expect(ghost(shell)).toEqual({ kind: "wardrobe", config: "standard", w: 1.2, d: 0.6, at: { x: 1.7, y: 3.9 }, rotation: 0, fits: true, surface: null, range: { bottom: 0, top: 2.05 }, drawn: true });
    expect(ghosts(shell)).toHaveLength(1);
    expect(ghosts(shell, COLORS.invalidFill)).toEqual([]);
    shell.up({ x: 2.27, y: 3.33 });
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "wardrobe", w: { standard: 1.2 }, d: { standard: 0.6 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 1.7, y: 3.9 }, rotation: 0, config: "standard" })]);
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { ctrl: true });
    expect(shell.doc().placements).toEqual({});
    expect(shell.doc().objects).toEqual({});
  });

  it("AC-05: a drag filling the bed alcove places a bed 0.90 wide and 2.00 deep, head at the closed end", () => {
    // The 1.70 default can't be clicked into this alcove at all.
    const shell = armedWith(nichesDoc(), "bed");
    shell.drag({ x: 3.13, y: 0.13 }, { x: 3.98, y: 2.07 });
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "bed", w: { standard: 0.9 }, d: { standard: 2 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 3.55, y: 0.1 }, rotation: 180 })]);
  });

  it("a niche in a side wall: the back lands on that wall, turned 90°", () => {
    const shell = armedWith(nichesDoc(), "wardrobe");
    shell.drag({ x: 0.13, y: 1.13 }, { x: 0.67, y: 2.27 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1.2 }, d: { standard: 0.6 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 0.1, y: 1.7 }, rotation: 90 })]);
  });

  it("AC-05: a drag under 4 px places the size picker's size where it is released", () => {
    const shaky = (release: number): FakeShell => {
      const shell = armedWith(roomDoc(), "bed");
      shell.ui({ type: "pickPreset", kind: "bed", preset: "Single 100 × 210" });
      shell.moveTo({ x: 3, y: 2 });
      shell.down({ x: 3, y: 2 });
      shell.moveTo({ x: release, y: 2 });
      shell.up({ x: release, y: 2 });
      return shell;
    };
    const small = shaky(3.04); // 3.2 px
    expect(objects(small)).toEqual([expect.objectContaining({ w: { standard: 1 } })]);
    expect(placements(small)).toEqual([expect.objectContaining({ at: { x: 3.04, y: 3.05 }, rotation: 0 })]);
    const edge = shaky(3.05); // exactly 4 px: still a click
    expect(placements(edge)).toEqual([expect.objectContaining({ at: { x: 3.05, y: 3.05 } })]);
  });

  it("a drag past 4 px that draws a rectangle under 0.02 m is red and places nothing", () => {
    const shell = armedWith(roomDoc(), "bed");
    shell.moveTo({ x: 3, y: 2 });
    shell.down({ x: 3, y: 2 });
    shell.moveTo({ x: 3.06, y: 2 }); // 4.8 px
    expect(ghost(shell)).toMatchObject({ w: 0.06, d: 0, fits: false });
    shell.up({ x: 3.06, y: 2 });
    expect(placements(shell)).toEqual([]);
    expect(shell.view().toast).toBe("Size must be between 0.02 and 10 m");
  });

  it("a rectangle across a wall is red; its release places nothing and toasts the fit message", () => {
    const shell = armedWith(roomDoc(), "wardrobe");
    shell.moveTo({ x: 5, y: 2 });
    shell.down({ x: 5, y: 2 });
    shell.moveTo({ x: 6.3, y: 2.5 });
    expect(ghost(shell)).toMatchObject({ w: 1.3, d: 0.5, rotation: 0, at: { x: 5.65, y: 2.5 }, fits: false });
    expect(ghosts(shell, COLORS.invalidFill)).toHaveLength(1);
    shell.up({ x: 6.3, y: 2.5 });
    expect(placements(shell)).toEqual([]);
    expect(shell.view().toast).toBe("Wardrobe (0.00–2.05) overlaps a wall in Layout");
  });

  it("a kind with two configurations takes the drawn depth in its first", () => {
    const shell = armedWith(nichesDoc(), "murphyBed");
    shell.drag({ x: 1.13, y: 3.87 }, { x: 2.27, y: 3.53 }); // the release snaps onto fin t2's face at (2.3, 3.53)
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { folded: 1.2, down: 1.2 }, d: { folded: 0.37, down: 2.1 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 1.7, y: 3.9 }, rotation: 0, config: "folded" })]);
  });

  it("a corner snapped onto a face lands on a whole centimetre along it", () => {
    const shell = armedWith(nichesDoc(), "murphyBed");
    shell.drag({ x: 1.1312, y: 3.8713 }, { x: 2.2712, y: 3.5313 }); // the release snaps onto fin t2's face
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { folded: 1.2, down: 1.2 }, d: { folded: 0.37, down: 2.1 } })]);
  });

  it("a release past 4 px with no move in between draws", () => {
    const shell = armedWith(roomDoc(), "wardrobe");
    shell.moveTo({ x: 2, y: 1 });
    shell.down({ x: 2, y: 1 });
    shell.up({ x: 3.2, y: 1.6 });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1.2 }, d: { standard: 0.6 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 2.6, y: 1.6 }, rotation: 0 })]);
  });

  it("R while drawing turns the drawn ghost at once, and the release places it", () => {
    const shell = armedWith(roomDoc(), "wardrobe");
    shell.moveTo({ x: 2, y: 1 });
    shell.down({ x: 2, y: 1 });
    shell.moveTo({ x: 3.2, y: 1.6 });
    shell.key("r");
    expect(ghost(shell)).toEqual(expect.objectContaining({ w: 0.6, d: 1.2, at: { x: 2, y: 1.3 }, rotation: 90 }));
    shell.up({ x: 3.2, y: 1.6 });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 2, y: 1.3 }, rotation: 90 })]);
  });

  it("an Undo during a press drops it: the release places nothing", () => {
    const shell = armedWith(roomDoc(), "wardrobe");
    shell.click({ x: 2, y: 3 });
    expect(placements(shell)).toHaveLength(1);
    shell.moveTo({ x: 2, y: 1 });
    shell.down({ x: 2, y: 1 });
    shell.moveTo({ x: 3.2, y: 1.6 });
    shell.key("z", { ctrl: true });
    shell.up({ x: 3.2, y: 1.6 });
    expect(placements(shell)).toEqual([]);
  });

  it("Ctrl turns the corner snaps off", () => {
    // No side lies on a face, so the start angle decides; with Ctrl it is 0.
    const shell = armedWith(nichesDoc(), "wardrobe");
    shell.drag({ x: 1.13, y: 3.87 }, { x: 2.27, y: 3.33 }, { ctrl: true });
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1.14 }, d: { standard: 0.54 } })]);
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 1.7, y: 3.87 }, rotation: 0 })]);
  });

  it("R before the press turns an open-floor footprint", () => {
    const turned = armedWith(roomDoc(), "wardrobe");
    turned.key("r");
    turned.drag({ x: 2, y: 1 }, { x: 3.2, y: 1.6 });
    expect(objects(turned)).toEqual([expect.objectContaining({ w: { standard: 0.6 }, d: { standard: 1.2 } })]);
    expect(placements(turned)).toEqual([expect.objectContaining({ at: { x: 2, y: 1.3 }, rotation: 90 })]);
    const plain = armedWith(roomDoc(), "wardrobe");
    plain.drag({ x: 2, y: 1 }, { x: 3.2, y: 1.6 });
    expect(objects(plain)).toEqual([expect.objectContaining({ w: { standard: 1.2 }, d: { standard: 0.6 } })]);
    expect(placements(plain)).toEqual([expect.objectContaining({ at: { x: 2.6, y: 1.6 }, rotation: 0 })]);
  });

  it("Esc or the pointer leaving during a press places nothing; the tool still clicks afterwards", () => {
    const shell = armedWith(roomDoc(), "wardrobe");
    shell.moveTo({ x: 2, y: 1 });
    shell.down({ x: 2, y: 1 });
    shell.moveTo({ x: 3.2, y: 1.6 });
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    shell.up({ x: 3.2, y: 1.6 });
    expect(placements(shell)).toEqual([]);
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    shell.moveTo({ x: 2, y: 1 });
    shell.down({ x: 2, y: 1 });
    shell.send({ type: "pointerLeave" });
    shell.moveTo({ x: 3.2, y: 1.6 });
    shell.up({ x: 3.2, y: 1.6 });
    expect(placements(shell)).toEqual([]);
    shell.click({ x: 2, y: 1 });
    expect(placements(shell)).toEqual([expect.objectContaining({ at: { x: 2, y: 1.3 } })]);
  });
});

/** mulberry32, as packages/domain/test/helpers.ts `rng`: a failure reproduces from its seed. */
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
