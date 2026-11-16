import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { snapStep } from "../src/snapping/snap";
import type { SnapStep } from "../src/types";
import { jointAt, pointOf, roomDoc, studioDoc, underlayCommand, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The tracing step (furnish.08, AC-10): on Auto, while the drawing has a plan picture and this viewer shows it, every
// snapped gesture rounds to 1 cm instead of the zoom grid (0.2 m at zoom 80). The picture (underlayCommand) spans
// x −1.373…1.627, y 4.017…5.217, away from every gesture below.

type Mode = "shown" | "hidden" | "fixed" | "fixedHidden";

/** A shell at zoom 80 on `doc` plus the picture: shown or hidden on Auto, or on the 50 cm step. */
function tracing(doc: Document, mode: Mode): FakeShell {
  const shell = FakeShell.withDocument(withCommands(doc, underlayCommand()));
  if (mode === "fixed" || mode === "fixedHidden") shell.ui({ type: "setSnapStep", step: 0.5 satisfies SnapStep });
  if (mode === "hidden" || mode === "fixedHidden") shell.ui({ type: "toggleUnderlay" });
  return shell;
}

function closeTo(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

/** A swing door d/d0 on roomDoc's bottom wall (0, 0)–(6, 0), offset 2.6: span x 2.6–3.4 (as snap-step.test.ts). */
const doorDoc = (): Document => {
  const doc = roomDoc();
  return withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6, side: "left" });
};

describe("the tracing step (AC-10)", () => {
  it.each([
    ["shown", { x: 1.23, y: 2.35 }, { x: 3.52, y: 2.35 }],
    ["hidden", { x: 1.2, y: 2.4 }, { x: 3.6, y: 2.4 }],
    ["fixed", { x: 1, y: 2.5 }, { x: 3.5, y: 2.5 }],
    ["fixedHidden", { x: 1, y: 2.5 }, { x: 3.5, y: 2.5 }],
  ] as const)("AC-10: wall drawing starts and ends on whole centimetres (%s)", (mode, start, end) => {
    const shell = tracing(roomDoc(), mode);
    shell.key("w");
    shell.click({ x: 1.234, y: 2.345 });
    shell.click({ x: 3.517, y: 2.351 });
    const fresh = Object.values(shell.doc().joints).filter((j) => j.x > 0.5 && j.x < 5.5 && j.y > 0.5 && j.y < 3.5);
    expect(fresh).toHaveLength(2);
    const [a, b] = [...fresh].sort((p, q) => p.x - q.x);
    if (!a || !b) throw new Error("no new joints");
    closeTo(a, start);
    closeTo(b, end);
  });

  it.each([
    ["shown", { x: 6.64, y: 4 }], // across only (straight.03): the drag's 5 cm along the wall is dropped
    ["hidden", { x: 6.6, y: 4 }],
    ["fixed", { x: 6.5, y: 4 }],
  ] as const)("AC-10: a wall body drag moves by whole centimetres (%s)", (mode, expected) => {
    const shell = tracing(roomDoc(), mode);
    shell.drag({ x: 6, y: 2 }, { x: 6.637, y: 2.05 });
    closeTo(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 })), expected);
  });

  it.each([
    ["shown", { x: 2.37, y: 0.6 }, { x: 2.37, y: 3 }, 2.97],
    ["hidden", { x: 2.4, y: 0.6 }, { x: 2.3, y: 3 }, 3],
    ["fixed", { x: 2.5, y: 0.5 }, { x: 2.5, y: 3 }, 3.1],
  ] as const)("AC-10: a joint drag, a furniture drag and an opening slide use 1 cm (%s)", (mode, joint, bed, offset) => {
    const single = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 });
    const j = tracing(single, mode);
    j.drag({ x: 2, y: 0 }, { x: 2.37, y: 0.6 });
    closeTo(pointOf(j.doc(), jointAt(single, { x: 2, y: 0 })), joint);

    const f = tracing(studioDoc(), mode);
    f.drag({ x: 1.5, y: 2 }, { x: 2.37, y: 2 });
    const p = f.doc().placements["bed/p0"];
    if (!p) throw new Error("no bed");
    closeTo(p.at, bed);
    expect(p.rotation).toBe(0);

    const d = tracing(doorDoc(), mode);
    d.drag({ x: 3, y: 0 }, { x: 3.374, y: 0 });
    expect(d.doc().openings["d/d0"]?.offset).toBeCloseTo(offset, 9);
  });

  it.each([
    ["shown", 1.87, { a: { x: 1.23, y: 2.35 }, b: { x: 3.52, y: 2.35 }, offset: 0.66 }, 1.14, { x: 3.94, y: 3 }],
    ["hidden", 1.8, { a: { x: 1.2, y: 2.4 }, b: { x: 3.6, y: 2.4 }, offset: 0.6 }, 1.2, { x: 3.9, y: 3 }],
    ["fixed", 2.1, { a: { x: 1, y: 2.5 }, b: { x: 3.5, y: 2.5 }, offset: 0.5 }, 1, { x: 4, y: 3 }],
  ] as const)("AC-10: a resize, the Dimension tool, a dimension's offset drag and the duplicate's ghost use 1 cm (%s)", (mode, width, dim, dragged, copyAt) => {
    // The bed (studioDoc) spans x 0.7–2.3, y 1–3; its right grip is at (2.3, 2).
    const r = tracing(studioDoc(), mode);
    r.click({ x: 1.5, y: 2 });
    r.drag({ x: 2.3, y: 2 }, { x: 2.57, y: 2 });
    expect(r.doc().objects["bed/o0"]?.w.standard).toBeCloseTo(width, 9);

    const m = tracing(roomDoc(), mode);
    m.key("m");
    m.click({ x: 1.234, y: 2.345 });
    m.click({ x: 3.517, y: 2.345 });
    m.click({ x: 2.4, y: 3.013 });
    const [placed, ...more] = Object.values(m.doc().dimensions);
    expect(more).toHaveLength(0);
    if (!placed) throw new Error("no dimension");
    // Off every joint, so both ends are free points.
    expect(placed.a).toEqual({ x: expect.closeTo(dim.a.x, 9), y: expect.closeTo(dim.a.y, 9) });
    expect(placed.b).toEqual({ x: expect.closeTo(dim.b.x, 9), y: expect.closeTo(dim.b.y, 9) });
    expect(placed.offset).toBeCloseTo(dim.offset, 9);

    // A placed dimension (1, 1)–(4, 1) at offset 0.5: its line is at y 1.5.
    const d = tracing(withCommands(roomDoc(), { type: "addDimension", opId: "m", a: { x: 1, y: 1 }, b: { x: 4, y: 1 }, offset: 0.5 }), mode);
    d.drag({ x: 2.5, y: 1.5 }, { x: 2.5, y: 2.137 });
    expect(Object.values(d.doc().dimensions)[0]?.offset).toBeCloseTo(dragged, 9);

    // Cmd+D: the ghost starts on the bed's centre (1.5, 2); the click moves it by (2.437, 0).
    const g = tracing(studioDoc(), mode);
    g.click({ x: 1.5, y: 2 });
    g.key("d", { meta: true });
    g.click({ x: 3.937, y: 2 });
    const copies = Object.entries(g.doc().placements).filter(([id]) => id !== "bed/p0");
    expect(copies).toHaveLength(1);
    closeTo(copies[0]?.[1].at ?? { x: Number.NaN, y: Number.NaN }, copyAt);
  });

  it("AC-10: the corner chip still names the zoom grid", () => {
    const shell = tracing(roomDoc(), "shown");
    expect(shell.view().gridStep).toBe(0.2);
    expect(snapStep(shell.state)).toBe(0.01);
  });
});
