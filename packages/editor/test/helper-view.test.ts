import { describe, expect, it } from "vitest";
import type { Camera } from "../src/camera";
import { COLORS } from "../src/view/colors";
import { helperBox, helperLabelAt, outsideBox } from "../src/view/helper";
import type { Primitive } from "../src/view/scene-types";
import type { Point } from "@fm/protocol";
import { roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

const camera = (zoom: number): Camera => ({ center: { x: 3, y: 2 }, zoom, viewport: { width: 1200, height: 800 }, dpr: 1 });

function layer(shell: FakeShell, name: string): Primitive[] {
  return shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
}
const helperSegments = (shell: FakeShell) =>
  layer(shell, "annotations").flatMap((p) => (p.kind === "segment" && p.color === COLORS.helper ? [p] : []));
/** The helper plate of the selected wall (the box drawn behind the number). */
function plate(shell: FakeShell): { min: Point; max: Point } {
  const ref = shell.state.selection[0];
  const box = ref ? helperBox(shell.state, shell.doc(), ref.id, shell.host) : null;
  if (!box) throw new Error("no helper");
  return box;
}
/** Whether a segment passes through the open interior of the box (sampled; 1e-9 m tolerance at the edges). */
function crossesInterior(a: Point, b: Point, box: { min: Point; max: Point }): boolean {
  const e = 1e-9;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x > box.min.x + e && x < box.max.x - e && y > box.min.y + e && y < box.max.y - e) return true;
  }
  return false;
}
const helperTexts = (shell: FakeShell) =>
  layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []));

describe("helper placement (spec §5.6)", () => {
  it("centres the text 18 px beyond the wall face, on the left of a → b", () => {
    const doc = roomDoc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 }); // a = (6, 0): the left of a → b is −x
    const at80 = helperLabelAt(doc, right, camera(80));
    expect(at80?.x).toBeCloseTo(6 - 0.1 - 18 / 80, 9); // 5.675
    expect(at80?.y).toBeCloseTo(2, 9);
    expect(helperLabelAt(doc, right, camera(160))?.x).toBeCloseTo(6 - 0.1 - 18 / 160, 9); // 5.7875
    const bottom = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(helperLabelAt(doc, bottom, camera(80))?.y).toBeCloseTo(0.1 + 18 / 80, 9); // 0.325
    expect(helperLabelAt(doc, "missing", camera(80))).toBeNull();
  });
});

describe("helper dimension in the Scene", () => {
  it("shows the selected wall's length on a dimension line with end ticks", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    expect(helperTexts(shell)).toEqual(["4.00"]);
    expect(helperSegments(shell)).toHaveLength(4); // the line in two pieces around the plate, and two ticks
  });

  it("marks the fixed endpoint a with a filled handle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    const inner = layer(shell, "overlays").flatMap((p) =>
      p.kind === "disc" && "px" in p.radius && p.radius.px === 3.5 ? [[p.center, p.color]] : [],
    );
    expect(inner).toEqual([
      [{ x: 6, y: 0 }, COLORS.handleFixed],
      [{ x: 6, y: 4 }, COLORS.handle],
    ]);
  });

  it("hides the helper outside the Select tool and during a drag", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    shell.key("w"); // the selection stays, the helper does not
    expect(helperTexts(shell)).toEqual([]);

    const dragging = FakeShell.withDocument(roomDoc());
    dragging.click({ x: 6, y: 1 });
    dragging.moveTo({ x: 6, y: 4 });
    dragging.down({ x: 6, y: 4 });
    dragging.moveTo({ x: 6, y: 4.6 }); // a grid point (0.2 m steps at 80 px/m), so the snapped result is exact
    expect(helperTexts(dragging)).toEqual([]);
    dragging.up({ x: 6, y: 4.6 });
    expect(helperTexts(dragging)).toEqual(["4.60"]);
  });

  it("stops the dimension line at the label plate, so it does not run through the number (vertical wall)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 }); // the line is 8 px out, the plate spans about 3–33 px out: they overlap
    const box = plate(shell);
    const segments = helperSegments(shell);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) expect(crossesInterior(s.a, s.b, box)).toBe(false);
    // The line still covers the wall's length outside the plate: two pieces from y = 0 to the plate and on to y = 4.
    const along = segments.filter((s) => Math.abs(s.a.x - s.b.x) < 1e-9).map((s) => [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)]);
    expect(along).toHaveLength(2);
    expect(along.map(([lo]) => lo).sort()[0]).toBeCloseTo(0, 9);
    expect(Math.max(...along.map(([, hi]) => hi ?? 0))).toBeCloseTo(4, 9);
  });

  it("draws the dimension line whole when the plate clears it (horizontal wall)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 3, y: 0 });
    expect(helperTexts(shell)).toEqual(["6.00"]);
    const segments = helperSegments(shell);
    expect(segments).toHaveLength(3);
    const line = segments.find((s) => Math.abs(s.a.y - s.b.y) < 1e-9);
    expect(line && Math.abs(line.b.x - line.a.x)).toBeCloseTo(6, 9);
  });
});

describe("helper editing looks like a text field (spec §5.6, U2)", () => {
  /** The plate polygon's fill and the blue outline segments around it. */
  function field(shell: FakeShell) {
    const box = plate(shell);
    const annotations = layer(shell, "annotations");
    const fills = annotations.flatMap((p) =>
      p.kind === "polygon" && p.points.length === 4 && p.points[0]?.x === box.min.x && p.points[0]?.y === box.min.y ? [p.color] : [],
    );
    const outline = annotations.flatMap((p) => (p.kind === "segment" && p.color === COLORS.wallSelected ? [p] : []));
    return { fills, outline };
  }
  function editRight(): FakeShell {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 1 });
    const at = helperLabelAt(shell.doc(), right, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    return shell;
  }

  it("a selected wall's helper is a plain plate with no outline", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 1 });
    expect(field(shell)).toEqual({ fills: [COLORS.background], outline: [] });
  });

  it("before the first key: blue outline, selection fill, the current length", () => {
    const shell = editRight();
    const { fills, outline } = field(shell);
    expect(fills).toEqual([COLORS.fieldSelection]);
    expect(outline).toHaveLength(4);
    expect(helperTexts(shell)).toEqual(["4.00"]);
  });

  it("after a key: blue outline, white fill, the typed value; Esc restores the plain plate", () => {
    const shell = editRight();
    shell.key("3");
    const { fills, outline } = field(shell);
    expect(fills).toEqual([COLORS.field]);
    expect(outline).toHaveLength(4);
    expect(helperTexts(shell)).toEqual(["3"]);
    shell.key("Escape");
    expect(field(shell)).toEqual({ fills: [COLORS.background], outline: [] });
  });

  it("the outline is the plate's four sides", () => {
    const shell = editRight();
    const box = plate(shell);
    const corners = field(shell).outline.map((s) => [s.a, s.b]);
    const c = { bl: box.min, br: { x: box.max.x, y: box.min.y }, tr: box.max, tl: { x: box.min.x, y: box.max.y } };
    expect(corners).toEqual([[c.bl, c.br], [c.br, c.tr], [c.tr, c.tl], [c.tl, c.bl]]);
  });
});

describe("outsideBox", () => {
  const min = { x: 0, y: 0 };
  const max = { x: 2, y: 2 };
  it("returns the pieces of a segment outside an axis-aligned box", () => {
    expect(outsideBox({ x: -1, y: 1 }, { x: 3, y: 1 }, min, max)).toEqual([
      [{ x: -1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 2, y: 1 }, { x: 3, y: 1 }],
    ]); // through: two pieces
    expect(outsideBox({ x: 1, y: 1 }, { x: 3, y: 1 }, min, max)).toEqual([[{ x: 2, y: 1 }, { x: 3, y: 1 }]]); // from inside: one
    expect(outsideBox({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 }, min, max)).toEqual([]); // inside: none
    expect(outsideBox({ x: -1, y: 3 }, { x: 3, y: 3 }, min, max)).toEqual([[{ x: -1, y: 3 }, { x: 3, y: 3 }]]); // clear: whole
    expect(outsideBox({ x: -1, y: 2 }, { x: 3, y: 2 }, min, max)).toEqual([[{ x: -1, y: 2 }, { x: 3, y: 2 }]]); // on an edge: whole
  });
});
