import { describe, expect, it } from "vitest";
import { footprints, normalize, quadCentre, sub, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../src/view/colors";
import { liveDistances } from "../src/view/distances";
import { handles, resizeLabelBox } from "../src/view/handles";
import { HELPER_TICK_PX } from "../src/view/helper";
import { sceneDocument } from "../src/view/scene";
import type { Primitive } from "../src/view/scene-types";
import { studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Live distances (direct.12, AC-12). The room is 6 × 4, inner faces at x 0.1 / 5.9 and y 0.1 / 3.9. The bed bed/p0
// spans x 0.7–2.3, y 1–3, centre (1.5, 2); the Layout block blk/p0 spans x 4.0–4.6, y 1.7–2.3; the Night block nb/p0
// spans x 3.4–4.0, y 1.7–2.3 and is ignored in Layout. Zoom 80: the Auto grid is 0.2 m.

const BLOCKS: Command[] = [
  { type: "placeObject", linked: false, deck: null, opId: "blk", state: "s0", object: { kind: "block" }, at: { x: 4.3, y: 2.3 } },
  { type: "placeObject", linked: false, deck: null, opId: "nb", state: "n/s0", object: { kind: "block" }, at: { x: 3.7, y: 2.3 } },
];
const fixture = (...more: Command[]): Document => withCommands(studioDoc(), ...BLOCKS, ...more);
const BED = { x: 1.5, y: 2 };

const annotations = (shell: FakeShell): readonly Primitive[] =>
  shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? [];
const cmTexts = (shell: FakeShell) =>
  annotations(shell).flatMap((p) => (p.kind === "text" && p.color === COLORS.helper && p.text.endsWith(" cm") ? [p] : []));
const labels = (shell: FakeShell): number[] => cmTexts(shell).map((t) => Number(t.text.slice(0, -3))).sort((a, b) => a - b);
const lines = (shell: FakeShell) => liveDistances(shell.state, sceneDocument(shell.state));
const helperSegments = (shell: FakeShell) =>
  annotations(shell).flatMap((p) => (p.kind === "segment" && p.color === COLORS.helper ? [p] : []));

type Box = { min: Point; max: Point };
/** The background plate drawn around each "NN cm" text: the polygon centred on the text. */
function plates(shell: FakeShell): Box[] {
  const ps = annotations(shell);
  return cmTexts(shell).map((t) => {
    for (const p of ps) {
      if (p.kind !== "polygon" || p.color !== COLORS.background) continue;
      const xs = p.points.map((q) => q.x);
      const ys = p.points.map((q) => q.y);
      const box = { min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
      if (Math.abs((box.min.x + box.max.x) / 2 - t.at.x) < 1e-9 && Math.abs((box.min.y + box.max.y) / 2 - t.at.y) < 1e-9) return box;
    }
    throw new Error(`no plate for ${t.text}`);
  });
}
/** Whether a segment passes through the open interior of the box (sampled; 1e-9 m tolerance at the edges). */
function crossesInterior(a: Point, b: Point, box: Box): boolean {
  const e = 1e-9;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > box.min.x + e && x < box.max.x - e && y > box.min.y + e && y < box.max.y - e) return true;
  }
  return false;
}
const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) > 1e-9 && Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > 1e-9;

/** A held drag from `from` to `to`. */
function hold(shell: FakeShell, from: Point, to: Point): void {
  shell.moveTo(from);
  shell.down(from);
  shell.moveTo(to);
}
/** The bed selected, then its right side grip (at the side's middle, (2.3, 2)) dragged to (x, 2) and held. */
function heldResize(x = 2.7): FakeShell {
  const shell = FakeShell.withDocument(fixture());
  shell.click(BED);
  const grip = handles(shell.state, shell.doc()).find((h) => h.kind === "side" && h.side === "right");
  expect(grip?.at.x).toBeCloseTo(2.3, 9);
  expect(grip?.at.y).toBeCloseTo(2, 9);
  hold(shell, grip?.at ?? BED, { x, y: 2 });
  return shell;
}

describe("live distances (AC-12)", () => {
  it("a dragged piece shows four distances to the wall faces and the nearest furniture of its layout (AC-12)", () => {
    const shell = FakeShell.withDocument(fixture());
    hold(shell, BED, { x: 2.5, y: 2 }); // the bed at x 1.7–3.3
    const got = labels(shell);
    expect(got).toEqual([70, 90, 90, 160]); // right: 70 to the Layout block, not 10 to Night's or 260 to the wall
    const ls = lines(shell);
    expect(ls).toHaveLength(4);
    const gaps = ls.map((l) => l.gap * 100).sort((a, b) => a - b);
    gaps.forEach((g, i) => expect(Math.abs(g - (got[i] ?? NaN))).toBeLessThanOrEqual(1));
  });

  it("each line runs along the piece's own axes, with ticks, and stops at its plate", () => {
    const doc = fixture({ type: "placeObject", linked: false, deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.5 }, rotation: 45 });
    const quad = footprints(doc).get("ch/p0");
    const centre = quad ? quadCentre(quad) : null;
    if (!centre) throw new Error("no chair");
    const shell = FakeShell.withDocument(doc);
    hold(shell, centre, { x: centre.x + 0.2, y: centre.y }); // its centre's y (2.34) lines up with the block's top edge (2.3, AC-13)
    const ls = lines(shell);
    expect(labels(shell)).toEqual([46, 105, 181, 181]);
    const r = Math.SQRT1_2;
    for (const l of ls) {
      const u = normalize(sub(l.to, l.from));
      if (!u) throw new Error("a zero line");
      const along = [{ x: r, y: r }, { x: -r, y: r }].some((d) => Math.abs(Math.abs(u.x * d.x + u.y * d.y) - 1) < 1e-6);
      expect(along).toBe(true);
      // A tick at each end: across the line, centred on the end, HELPER_TICK_PX each way.
      for (const end of [l.from, l.to]) {
        const tick = helperSegments(shell).find((s) => {
          const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
          return Math.hypot(mid.x - end.x, mid.y - end.y) < 1e-9;
        });
        if (!tick) throw new Error("no tick");
        const d = sub(tick.b, tick.a);
        expect(Math.abs(d.x * u.x + d.y * u.y)).toBeLessThan(1e-6);
        expect(Math.hypot(d.x, d.y)).toBeCloseTo((2 * HELPER_TICK_PX) / 80, 9);
      }
    }
    expect(labels(shell)).toEqual(ls.map((l) => Math.round(l.gap * 100)).sort((a, b) => a - b));
    const boxes = plates(shell);
    for (const s of helperSegments(shell)) for (const box of boxes) expect(crossesInterior(s.a, s.b, box)).toBe(false);
    for (const t of cmTexts(shell)) expect(t.rotation).toBe(0);
  });

  it("a group measures from its bounding box along the screen axes (direct.12)", () => {
    const shell = FakeShell.withDocument(fixture());
    shell.click(BED);
    shell.click({ x: 4.3, y: 2 }, { shift: true });
    hold(shell, BED, { x: 2.1, y: 2 }); // the box: x 0.7–4.6 → x 1.3–5.2, y 1–3
    expect(labels(shell)).toEqual([70, 90, 90, 120]);
  });

  it("a resize shows the distances of the resized piece", () => {
    expect(labels(heldResize())).toEqual([60, 90, 90, 130]); // the bed at x 0.7–2.7
  });

  // The right side's line runs from the grip to the Layout block at x 4.0 and passes the size label 28 px beyond the
  // side. The nearer the block, the less of the line is left outside the label: at x 3.6 the size snaps to 3.0, the
  // label spans x 3.75–4.35 and covers the line's whole length and its tick at 4.0.
  it.each([2.7, 3.0, 3.2, 3.3, 3.5, 3.6, 3.8])("a resize's distances stay clear of the size label (grip at x %s)", (x) => {
    const shell = heldResize(x);
    const box = resizeLabelBox(shell.state);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(labels(shell)).toHaveLength(4);
    for (const s of helperSegments(shell)) expect(crossesInterior(s.a, s.b, box)).toBe(false);
    for (const plate of plates(shell)) expect(overlaps(plate, box)).toBe(false);
  });

  it("a nudge run shows distances from its preview at once, and none after it commits", () => {
    const shell = FakeShell.withDocument(fixture());
    shell.click(BED);
    for (let i = 0; i < 3; i++) shell.key("ArrowRight"); // the bed at x 0.73–2.33
    expect(labels(shell)).toEqual([63, 90, 90, 167]);
    shell.host.advance(400);
    shell.fireTimer("nudge");
    expect(shell.doc().placements["bed/p0"]?.at.x).toBeCloseTo(1.53, 9);
    expect(labels(shell)).toEqual([]);
  });

  it("a refused drag measures the last valid preview, where the piece is drawn", () => {
    const shell = FakeShell.withDocument(fixture());
    hold(shell, BED, { x: 5.5, y: 2 });
    const t = shell.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && !t.state.attempt.ok).toBe(true);
    expect(labels(shell)).toEqual([60, 90, 90, 170]);
  });

  it("no distances when nothing is moving", () => {
    const idle = FakeShell.withDocument(fixture());
    idle.click(BED);
    expect(labels(idle)).toEqual([]);

    const joint = FakeShell.withDocument(fixture());
    joint.click({ x: 6, y: 1 });
    hold(joint, { x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(joint.state.tool.name === "select" && joint.state.tool.state.kind).toBe("moving");
    expect(labels(joint)).toEqual([]);

    const turn = FakeShell.withDocument(fixture());
    turn.click(BED);
    const grip = handles(turn.state, turn.doc()).find((h) => h.kind === "rotate");
    if (!grip) throw new Error("no rotation grip");
    hold(turn, grip.at, { x: grip.at.x + 0.6, y: grip.at.y - 0.2 });
    const t = turn.state.tool;
    expect(t.name === "select" && t.state.kind === "moving" && t.state.target.kind).toBe("rotate");
    expect(labels(turn)).toEqual([]);

    const ghost = FakeShell.withDocument(fixture());
    ghost.key("o");
    ghost.moveTo({ x: 3, y: 2 });
    expect(ghost.state.tool.name === "object" && ghost.state.tool.state.ghost !== null).toBe(true);
    expect(labels(ghost)).toEqual([]);
  });

  it("a gap that rounds to 0 cm draws no line", () => {
    // The block fl/p0 spans x 0.1–0.7, y 3.3–3.9. Dragged 0.2 m, its back stays flush with the y 3.9 face, which holds
    // y (furnish.16); on x its centre (0.6) lines up with the bed's left edge (0.7, AC-13), so it lands at x 0.4–1.0.
    const shell = FakeShell.withDocument(fixture({ type: "placeObject", linked: false, deck: null, opId: "fl", state: "s0", object: { kind: "block" }, at: { x: 0.4, y: 3.9 } }));
    hold(shell, { x: 0.4, y: 3.6 }, { x: 0.6, y: 3.6 });
    expect(lines(shell)).toHaveLength(3);
    expect(labels(shell)).toEqual([30, 30, 490]); // front: 30 to the bed's back at y 3, which it overlaps over x 0.7–1.0
  });
});
