import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import type { SnapStep } from "../src/types";
import { bed160x200, roomDoc, underlayDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The duplicate's ghost moves like a furniture drag (ghost.02, ghost.07; AC-05 as amended): the snap step from the
// original's place, the alignment guides of the other furniture (the originals included), live distances, and Ctrl
// turning off the step and the guides but not the distances. roomDoc: inner faces at x 0.1 / 5.9, y 0.1 / 3.9. Zoom 80
// unless said: tolerance 10 px = 0.125 m, Auto step 0.2 m. `at` is the middle of a piece's back edge.
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at });

/** bed/p0 at (1.53, 3): x 0.73–2.33, y 1–3, centre (1.53, 2); off the 0.25 and 0.2 lattices on purpose (direct.35). */
const bedDoc = (): Document => withCommands(roomDoc(), place("bed", "bed", { x: 1.53, y: 3 }), bed160x200("bed/o0"));
/** wr/p0 (1.2 × 0.6) at (3, 2.3): x 2.4–3.6, y 1.7–2.3, centre (3, 2). */
const wardrobeDoc = (): Document => withCommands(roomDoc(), place("wr", "wardrobe", { x: 3, y: 2.3 }));
/** c1/p0 at (1, 2.225), c2/p0 at (2, 2.225): x 0.775–1.225 and 1.775–2.225, y 1.775–2.225; box centre (1.5, 2). */
const chairsDoc = (): Document => withCommands(roomDoc(), place("c1", "chair", { x: 1, y: 2.225 }), place("c2", "chair", { x: 2, y: 2.225 }));
/** k1/p0 at (1, 2.3), k2/p0 at (2, 2.3): x 0.7–1.3 and 1.7–2.3, y 1.7–2.3; box centre (1.5, 2). */
const blocksDoc = (): Document => withCommands(roomDoc(), place("k1", "block", { x: 1, y: 2.3 }), place("k2", "block", { x: 2, y: 2.3 }));

const BED = { x: 1.53, y: 2 };
const C1 = { x: 1, y: 2 };
const C2 = { x: 2, y: 2 };

/** A fresh shell on `doc` at `zoom`, with `step` chosen (none: Auto). */
function shellOn(doc: Document, zoom = 80, step?: SnapStep): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom } };
  if (step !== undefined) shell.ui({ type: "setSnapStep", step });
  return shell;
}

/** Selects the pieces under `first` and `more` (Shift-clicks) and picks them up with Cmd+D. */
function pickUp(shell: FakeShell, first: Point, ...more: Point[]): void {
  shell.click(first);
  for (const p of more) shell.click(p, { shift: true });
  shell.key("d", { meta: true });
}

/** The selection's placements as { at, rotation }, sorted by at.x. */
const copies = (shell: FakeShell): { at: Point; rotation: number }[] =>
  shell.state.selection
    .flatMap((r) => {
      const p = r.table === "placements" ? shell.doc().placements[r.id] : undefined;
      return p ? [{ at: p.at, rotation: p.rotation }] : [];
    })
    .sort((a, b) => a.at.x - b.at.x);

const kind = (shell: FakeShell): string | null => (shell.state.tool.name === "select" ? shell.state.tool.state.kind : null);
const s0Count = (shell: FakeShell): number => Object.values(shell.doc().placements).filter((p) => p.state === "s0").length;

function guides(shell: FakeShell): Extract<Primitive, { kind: "segment" }>[] {
  const overlays = shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
  return overlays.flatMap((p) => (p.kind === "segment" && p.color === COLORS.snapGuide ? [p] : []));
}

const round = (v: number): number => +v.toFixed(6);
/** Each guide as "x 2.33 1–3" (vertical) or "y 2 0.73–3.93" (horizontal), its span sorted, all sorted. */
const guideLines = (shell: FakeShell): string[] =>
  guides(shell)
    .map((g) =>
      Math.abs(g.a.x - g.b.x) < 1e-9
        ? `x ${round(g.a.x)} ${round(Math.min(g.a.y, g.b.y))}–${round(Math.max(g.a.y, g.b.y))}`
        : `y ${round(g.a.y)} ${round(Math.min(g.a.x, g.b.x))}–${round(Math.max(g.a.x, g.b.x))}`,
    )
    .sort();

const annotations = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? [];
const labels = (shell: FakeShell): number[] =>
  annotations(shell)
    .flatMap((p) => (p.kind === "text" && p.color === COLORS.helper && p.text.endsWith(" cm") ? [Number(p.text.slice(0, -3))] : []))
    .sort((a, b) => a - b);

describe("ghost parity", () => {
  it("moves in steps from the original's place, not on an absolute lattice, at zooms 20, 80 and 320 (AC-05)", () => {
    for (const zoom of [20, 80, 320]) {
      const shell = shellOn(bedDoc(), zoom, 0.25);
      pickUp(shell, BED);
      shell.click({ x: 4, y: 2.1 });
      expect(copies(shell)).toEqual([{ at: { x: 4.03, y: 3 }, rotation: 0 }]); // offset (2.5, 0); the lattice gives 4.0
      expect(shell.state.undo.past).toHaveLength(1);
      expect(shell.doc().placements["bed/p0"]?.at).toEqual({ x: 1.53, y: 3 });
    }
    // Auto at zoom 80 is not a pure pin: the raw y of 0.1 is a step tie that alone rounds to 3.2; the original's y
    // lines (within 0.125 m) take it to 3.
    const auto: [number, Point][] = [[20, { x: 3.53, y: 3 }], [80, { x: 3.93, y: 3 }], [320, { x: 3.98, y: 3.1 }]];
    for (const [zoom, at] of auto) {
      const shell = shellOn(bedDoc(), zoom);
      pickUp(shell, BED);
      shell.click({ x: 4, y: 2.1 });
      expect(copies(shell)).toEqual([{ at, rotation: 0 }]);
    }
    const free = shellOn(bedDoc(), 80, 0.25);
    pickUp(free, BED);
    free.click({ x: 4, y: 2.1 }, { ctrl: true });
    expect(copies(free)).toEqual([{ at: { x: 4, y: 3.1 }, rotation: 0 }]);
  });

  it("snaps edge to edge to its own original, which counts as other furniture (AC-05, ghost.02)", () => {
    const shell = shellOn(bedDoc());
    pickUp(shell, BED);
    shell.moveTo({ x: 3.24, y: 2.03 });
    expect(guideLines(shell)).toEqual(["x 2.33 1–3", "y 1 0.73–3.93", "y 2 0.73–3.93", "y 3 0.73–3.93"]);
    shell.click({ x: 3.24, y: 2.03 });
    expect(copies(shell)).toEqual([{ at: { x: 3.13, y: 3 }, rotation: 0 }]); // the step alone gives 3.33
  });

  it("with Ctrl: no step and no guide (AC-05)", () => {
    const shell = shellOn(bedDoc());
    pickUp(shell, BED);
    shell.moveTo({ x: 3.24, y: 2.03 }, { ctrl: true });
    expect(guides(shell)).toEqual([]);
    shell.moveTo({ x: 4, y: 2 }, { ctrl: true }); // the copy's y lines on the original's: still no guide
    expect(guides(shell)).toEqual([]);
    shell.click({ x: 3.24, y: 2.03 }, { ctrl: true });
    expect(copies(shell)).toEqual([{ at: { x: 3.24, y: 3.03 }, rotation: 0 }]);
  });

  it("after R the guide box is the turned box (AC-05, direct.55)", () => {
    const shell = shellOn(wardrobeDoc());
    pickUp(shell, { x: 3, y: 2 });
    shell.key("r");
    shell.moveTo({ x: 3.97, y: 2.03 });
    expect(guideLines(shell)).toEqual(["x 3.6 1.4–2.6", "y 2 2.4–4.2"]);
    shell.click({ x: 3.97, y: 2.03 });
    expect(copies(shell)).toEqual([{ at: { x: 3.6, y: 2 }, rotation: 90 }]); // the unturned box would give 3.7
  });

  it("after R a group's guide box is its turned bounding box (AC-05, direct.55)", () => {
    // The chairs' 1.45 × 0.45 box turns to 0.45 × 1.45 about its centre: its top edge lines up with the originals' top.
    const shell = shellOn(chairsDoc());
    pickUp(shell, C1, C2);
    shell.key("r");
    shell.moveTo({ x: 3.62, y: 1.52 });
    expect(guideLines(shell)).toEqual(["y 2.225 0.775–3.925"]);
    shell.click({ x: 3.62, y: 1.52 });
    // the unturned box would give y 1.05 and 2.05, the step alone 1.1 and 2.1
    expect(copies(shell)).toEqual([{ at: { x: 3.475, y: 1 }, rotation: 90 }, { at: { x: 3.475, y: 2 }, rotation: 90 }]);
  });

  it("a group moves by one step multiple (AC-05)", () => {
    const cases: [SnapStep | undefined, boolean, number, number][] = [
      [0.25, false, 2.75, 3.475],
      [undefined, false, 2.8, 3.425],
      [undefined, true, 2.87, 3.375],
    ];
    for (const [step, ctrl, x, y] of cases) {
      const shell = shellOn(chairsDoc(), 80, step);
      pickUp(shell, C1, C2);
      shell.click({ x: 3.37, y: 3.15 }, { ctrl });
      expect(copies(shell)).toEqual([{ at: { x, y }, rotation: 0 }, { at: { x: x + 1, y }, rotation: 0 }]);
    }
  });

  it("a group's bounding box snaps to an original's edge (AC-05)", () => {
    const shell = shellOn(chairsDoc());
    pickUp(shell, C1, C2);
    shell.moveTo({ x: 3.02, y: 2.03 });
    expect(guideLines(shell)).toEqual(["x 2.225 1.775–2.225", "y 1.775 0.775–3.675", "y 2 0.775–3.675", "y 2.225 0.775–3.675"]);
    shell.click({ x: 3.02, y: 2.03 });
    expect(copies(shell)).toEqual([{ at: { x: 2.45, y: 2.225 }, rotation: 0 }, { at: { x: 3.45, y: 2.225 }, rotation: 0 }]); // the step alone: 2.6, 3.6
  });

  it("live distances follow the ghost, measured to the walls and to its original (AC-05)", () => {
    const shell = shellOn(bedDoc(), 80, 0.25);
    pickUp(shell, BED);
    shell.moveTo({ x: 4, y: 2.1 });
    expect(labels(shell)).toEqual([90, 90, 90, 107]); // the left 90 is the gap to the original
    shell.moveTo({ x: 3.6, y: 2.1 });
    expect(labels(shell)).toEqual([40, 90, 90, 157]);
    expect(s0Count(shell)).toBe(1);
    shell.click({ x: 3.6, y: 2.1 });
    expect(labels(shell)).toEqual([]);

    const group = shellOn(blocksDoc());
    pickUp(group, { x: 1, y: 2 }, { x: 2, y: 2 });
    group.moveTo({ x: 3.9, y: 1.0 });
    expect(labels(group)).toEqual([60, 120, 260, 300]); // one set of lines for the bounding box
  });

  it("with Ctrl, distances are still drawn, as on a Ctrl drag (AC-05 as amended)", () => {
    const shell = shellOn(bedDoc());
    pickUp(shell, BED);
    shell.moveTo({ x: 3.24, y: 2.03 }, { ctrl: true });
    expect(labels(shell)).toEqual([11, 87, 93, 186]);
    expect(guides(shell)).toEqual([]);

    const drag = shellOn(bedDoc());
    drag.moveTo(BED);
    drag.down(BED);
    drag.moveTo({ x: 2.4, y: 2 }, { ctrl: true });
    drag.moveTo({ x: 3.24, y: 2.03 }, { ctrl: true });
    expect(labels(drag)).toEqual([87, 93, 186, 234]);
  });

  it("a refused place draws no guides and no distances; a valid move brings them back (AC-05, AC-06)", () => {
    const shell = shellOn(bedDoc());
    pickUp(shell, BED);
    shell.moveTo({ x: 2, y: 2 }); // the copy would cover x 1.13–2.73, on top of the original
    expect(guides(shell)).toEqual([]);
    expect(labels(shell)).toEqual([]);
    expect(s0Count(shell)).toBe(1);
    shell.moveTo({ x: 4, y: 2.1 });
    expect(guideLines(shell)).toEqual(["y 1 0.73–4.73", "y 2 0.73–4.73", "y 3 0.73–4.73"]);
    expect(labels(shell)).toEqual([80, 90, 90, 117]);
    shell.moveTo({ x: 2, y: 2 }); // refused again: nothing measured from the last valid place
    expect(guides(shell)).toEqual([]);
    expect(labels(shell)).toEqual([]);
  });

  it("Shift keeps the larger axis, as on a drag (direct.19)", () => {
    const locked = shellOn(bedDoc());
    pickUp(locked, BED);
    locked.click({ x: 4, y: 2.6 }, { shift: true });
    expect(copies(locked)).toEqual([{ at: { x: 3.93, y: 3 }, rotation: 0 }]);
    const free = shellOn(bedDoc());
    pickUp(free, BED);
    free.click({ x: 4, y: 2.6 });
    expect(copies(free)).toEqual([{ at: { x: 3.93, y: 3.6 }, rotation: 0 }]);
  });

  it("shared drawing: a piece added by another editor while the ghost is up becomes a guide at once (direct.26)", () => {
    const r = FakeRemote.open(bedDoc());
    expect(r.shell.state.camera.zoom).toBe(80);
    r.shell.click(BED);
    r.shell.key("d", { meta: true });
    r.shell.moveTo({ x: 4, y: 2.1 });
    expect(guideLines(r.shell)).toEqual(["y 1 0.73–4.73", "y 2 0.73–4.73", "y 3 0.73–4.73"]);
    r.remote({ type: "placeObject", deck: null, opId: "bob", state: "s0", object: { kind: "block" }, at: { x: 5.15, y: 3.9 } }); // x 4.85–5.45, y 3.3–3.9
    expect(kind(r.shell)).toBe("copying");
    expect(guideLines(r.shell).filter((g) => g.startsWith("x"))).toEqual(["x 4.85 1–3.9"]);
    r.shell.click({ x: 4, y: 2.1 });
    expect(r.submits()).toHaveLength(1);
    const puts = r.last().patch.puts.filter((p) => p.table === "placements");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.entity).toMatchObject({ at: { x: 4.05, y: 3 } }); // without the block: 3.93
  });
});

describe("contact plus fit on a one-piece duplicate (AC-04, furnish.16)", () => {
  // wardrobeDoc: wr/p0 (1.2 × 0.6) centred on (3, 2). The ghost's centre is (3, 2) plus the stepped delta.
  it("into the top-left corner", () => {
    const shell = shellOn(wardrobeDoc());
    pickUp(shell, { x: 3, y: 2 });
    shell.moveTo({ x: 0.75, y: 3.55 }); // raw (−2.25, 1.55) steps to (−2.2, 1.6): centre (0.8, 3.6), the back on the top face
    const t = shell.state.tool;
    const offset = t.name === "select" && t.state.kind === "copying" ? t.state.offset : null;
    expect(offset?.x).toBeCloseTo(-2.3, 6); // the flushed footprint's centre (0.7, 3.6) minus (3, 2)
    expect(offset?.y).toBeCloseTo(1.6, 6);
    shell.click({ x: 0.75, y: 3.55 });
    expect(copies(shell)).toEqual([{ at: { x: 0.7, y: 3.9 }, rotation: 0 }]); // the left side 0.10 m from its face snaps in
  });

  it("left side onto the left wall turns it", () => {
    const shell = shellOn(wardrobeDoc());
    pickUp(shell, { x: 3, y: 2 });
    shell.click({ x: 0.83, y: 2 }); // centre (0.8, 2): the left side 0.10 m from the face
    expect(copies(shell)).toEqual([{ at: { x: 0.1, y: 2 }, rotation: 90 }]);
  });

  it("after R, in open floor it keeps 90", () => {
    const shell = shellOn(wardrobeDoc());
    pickUp(shell, { x: 3, y: 2 });
    shell.key("r");
    shell.click({ x: 1.57, y: 2 }); // centre (1.6, 2): x 1.3–1.9
    expect(copies(shell)).toEqual([{ at: { x: 1.3, y: 2 }, rotation: 90 }]);
  });

  it("the turn's fit counts the original: a copy whose turn would overlap it keeps its angle (ghost.15)", () => {
    // wr/p0 at (0.9, 3): x 0.3–1.5, y 2.4–3, centre (0.9, 2.7). Raw (−0.13, −0.73) steps to (−0.2, −0.8): centre
    // (0.7, 1.9), the left side on the face. Turned to 90 and flushed (x 0.1–0.7, y 1.3–2.5) it would cover the original.
    const shell = shellOn(withCommands(roomDoc(), place("wr", "wardrobe", { x: 0.9, y: 3 })));
    pickUp(shell, { x: 0.9, y: 2.7 });
    shell.click({ x: 0.77, y: 1.97 });
    expect(copies(shell)).toEqual([{ at: { x: 0.7, y: 2.2 }, rotation: 0 }]);
  });

  it("the Object tool's ghost, a one-piece drag and a one-piece duplicate land the same place (AC-04)", () => {
    // W (1.2 × 0.6) centred on (3, 2); T at (1.78, 3.5): x 1.18–2.38, y 2.9–3.5. At P each turns onto the left wall and
    // flushes (x 0.1–0.7), the wall holds x, and y aligns +0.03: to T (the drag, the Object tool) or to T or the
    // original W (the duplicate).
    const P = { x: 0.81, y: 2.87 };
    const doc = () => withCommands(roomDoc(), place("w", "wardrobe", { x: 3, y: 2.3 }), place("t", "wardrobe", { x: 1.78, y: 3.5 }));
    const want = { at: { x: 0.1, y: 2.9 }, rotation: 90 };

    const drag = shellOn(doc());
    drag.drag({ x: 3, y: 2 }, P);
    const dragged = drag.doc().placements["w/p0"];
    expect({ at: dragged?.at, rotation: dragged?.rotation }).toEqual(want);

    const dup = shellOn(doc());
    pickUp(dup, { x: 3, y: 2 });
    dup.click(P);
    expect(copies(dup)).toEqual([want]);

    const tool = shellOn(doc());
    tool.ui({ type: "pickKind", kind: "wardrobe" });
    tool.click(P);
    const placed = Object.entries(tool.doc().placements).filter(([id]) => id !== "w/p0" && id !== "t/p0").map(([, p]) => ({ at: p.at, rotation: p.rotation }));
    expect(placed).toEqual([want]); // without the guide stage, y 2.87
  });

  it("one piece: a wall within the tolerance wins over a guide on that axis (furnish.16)", () => {
    // A, a block 0.05 m below the top face: y 3.25–3.85. K, a block centred on (4.03, 2), off the 0.2 lattice. The
    // raw delta (−2.03, 1.58) steps to (−2, 1.6): centre (2.03, 3.6), the back flush on 3.9. The free box's y lines
    // are 0.03 from A's, but the top wall holds y; no x line is within 0.125 of A's or K's.
    const shell = shellOn(withCommands(roomDoc(), place("a", "block", { x: 2.8, y: 3.85 }), place("k", "block", { x: 4.03, y: 2.3 })));
    pickUp(shell, { x: 4.03, y: 2 });
    shell.moveTo({ x: 2, y: 3.58 });
    shell.click({ x: 2, y: 3.58 });
    expect(copies(shell)).toEqual([{ at: { x: 2.03, y: 3.9 }, rotation: 0 }]);
  });

  it("one piece: a guide measured from the unstepped box can't push the piece into a side wall", () => {
    // B, a bathroom block at rotation 180: x 3.81–5.61, y 1.3–2.8. The block centred on (1.8, 2.7) moved to P steps
    // to (5.4, 0.4), turns to 180 and flushes on the bottom wall: x 5.1–5.7, 0.20 from the face x 5.9, so the placed
    // box doesn't hold x. The unstepped box (centre x 5.49) is 0.11 from that face, and its centre line is 0.12 from
    // B's edge 5.61: taken, it would give x 5.31–5.91, 1 cm into the wall. The wall holds x and the step's place stands.
    const doc = () => withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bathroomBlock" }, at: { x: 4.71, y: 1.3 }, rotation: 180 }, place("k", "block", { x: 1.8, y: 3 }));
    const P = { x: 5.49, y: 0.5 };
    const want = { at: { x: 5.4, y: 0.1 }, rotation: 180 };

    const drag = shellOn(doc());
    drag.drag({ x: 1.8, y: 2.7 }, P);
    const dragged = drag.doc().placements["k/p0"];
    expect({ at: dragged?.at, rotation: dragged?.rotation }).toEqual(want);

    const dup = shellOn(doc());
    pickUp(dup, { x: 1.8, y: 2.7 });
    dup.moveTo(P);
    dup.click(P);
    expect(copies(dup)).toEqual([want]);
  });

  it("while a plan picture shows, the 1 cm step decides the turn (furnish.23)", () => {
    // At x 0.83 the 0.2 m step's centre 0.8 is 0.10 m from the left face (it turns); the 1 cm step's 0.83 is 0.13 m away.
    const shell = shellOn(underlayDoc(wardrobeDoc()));
    pickUp(shell, { x: 3, y: 2 });
    shell.click({ x: 0.83, y: 2 });
    expect(copies(shell)).toEqual([{ at: { x: 0.83, y: 2.3 }, rotation: 0 }]);
  });
});
