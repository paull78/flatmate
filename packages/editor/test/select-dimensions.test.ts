import { describe, expect, it } from "vitest";
import { add, dimensionPoints, distanceToSegment, scale, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { dimensionLayout } from "../src/view/dimension-layout";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Placed dimensions in the Select tool (spec §Editing, dims.17; AC-09). Each fixture is roomDoc (6 × 4, 0.20 m walls)
// plus one dimension m/m0. At zoom 80 the hit tolerance is 6/80 = 0.075 m and the snap step is 0.20 m.

const P = (x: number, y: number): Point => ({ x, y });
const ID = "m/m0";
const DIM = { table: "dimensions", id: ID };
const CHAIR = { table: "placements", id: "c1/p0" };

const withDimension = (a: Point, b: Point, offset: number, doc: Document = roomDoc()): Document =>
  withCommands(doc, { type: "addDimension", opId: "m", a, b, offset });

const H = () => withDimension(P(1, 1), P(4, 1), 0.5); // the line at y 1.5
// Diagonal: length 2.50, u = (0.6, 0.8), left normal n = (−0.8, 0.6).
const D_A = P(1, 0.5);
const D_B = P(2.5, 2.5);
const D = () => withDimension(D_A, D_B, 0.5);
const at = (s: number, t: number): Point => add(add(D_A, scale(P(0.6, 0.8), s)), scale(P(-0.8, 0.6), t));
const R = () => withDimension(P(4, 1), P(1, 1), -0.5); // right to left: left normal (0, −1), the line at y 1.5
const J = () => withDimension(P(0, 0), P(6, 0), 0); // both ends on joint centres, on the bottom wall's centreline
const chair = (doc: Document): Document => withCommands(doc, { type: "placeObject", deck: null, opId: "c1", state: "s0", object: { kind: "chair" }, at: P(4, 3) });
const CHAIR_AT = P(4, 2.775); // a 0.45 m chair anchored at (4, 3): its footprint's centre

const layer = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "dimensions")?.primitives ?? [];
const colors = (shell: FakeShell): string[] => [...new Set(layer(shell).map((p) => p.color))];
const offsetOf = (shell: FakeShell): number | undefined => shell.doc().dimensions[ID]?.offset;
const selectState = (shell: FakeShell) => (shell.state.tool.name === "select" ? shell.state.tool.state : null);

describe("dimensions in the Select tool (spec §Editing, AC-09)", () => {
  it("› a press on the line selects the dimension alone; Properties shows Dimension, Length 3.00 m (AC-09)", () => {
    const shell = FakeShell.withDocument(H());
    shell.click(P(2, 1.52));
    expect(shell.state.selection).toEqual([DIM]);
    expect(shell.view().properties).toEqual({
      kind: "dimension",
      fields: [{ id: "length", label: "Length", section: "Dimension", value: "3.00", unit: "m", readOnly: true }],
    });
    const diagonal = FakeShell.withDocument(D());
    diagonal.click(at(0.625, 0.5));
    expect(diagonal.view().properties).toMatchObject({ kind: "dimension", fields: [{ value: "2.50" }] }); // not |dx| (1.50)
  });

  it("› the line hits within 6 px across it; the text box hits beyond that", () => {
    const pressed = (p: Point) => {
      const shell = FakeShell.withDocument(D());
      shell.click(p);
      return shell.state.selection;
    };
    expect(pressed(at(0.625, 0.5 - 5 / 80))).toEqual([DIM]);
    expect(pressed(at(0.625, 0.5 - 7 / 80))).toEqual([]); // not HANDLE_HIT_PX, not a tolerance in metres
    expect(pressed(P(2, 1))).toEqual([]); // inside the line's axis-aligned box, 1.0 m across it
    const l = dimensionLayout(D_A, D_B, 0.5, CANVAS_STYLE, 80);
    expect(l).not.toBeNull();
    if (!l) return;
    const c = scale(l.text.box.reduce(add, P(0, 0)), 1 / l.text.box.length);
    expect(distanceToSegment(c, ...l.line)).toBeGreaterThan(0.075);
    expect(pressed(c)).toEqual([DIM]);
  });

  it("› joints before dimensions, dimensions before walls (AC-09)", () => {
    const shell = FakeShell.withDocument(J());
    shell.click(P(0, 0));
    expect(shell.state.selection.map((r) => r.table)).toEqual(["joints"]);
    shell.click(P(3, 0));
    expect(shell.state.selection).toEqual([DIM]);

    const fresh = FakeShell.withDocument(J());
    const before = fresh.doc().dimensions[ID];
    fresh.drag(P(0, 0), P(0, -0.4));
    const d = fresh.doc().dimensions[ID];
    expect(d).toBe(before);
    if (!d || !("joint" in d.a)) throw new Error("expected an anchored end");
    expect(fresh.doc().joints[d.a.joint]).toMatchObject({ x: 0, y: -0.4 });
    expect(dimensionPoints(fresh.doc(), d)?.a).toEqual({ x: 0, y: -0.4 });
  });

  it("› dragging sets only the offset: the pointer's distance along the left normal, rounded to the snap step", () => {
    const shell = FakeShell.withDocument(D());
    const before = shell.doc();
    const row = before.dimensions[ID];
    shell.moveTo(at(0.625, 0.5));
    shell.down(at(0.625, 0.5));
    shell.moveTo(at(0.625, 1.13));
    const line = layer(shell)[0];
    expect(line?.kind).toBe("segment");
    if (line?.kind !== "segment") return;
    const n = P(-0.8, 0.6);
    const want = [add(D_A, scale(n, 1.2)), add(D_B, scale(n, 1.2))];
    [line.a, line.b].forEach((got, i) => {
      expect(got.x).toBeCloseTo(want[i]?.x ?? Number.NaN, 9);
      expect(got.y).toBeCloseTo(want[i]?.y ?? Number.NaN, 9);
    });
    expect(shell.doc()).toBe(before);
    const moving = selectState(shell);
    expect(moving?.kind === "moving" ? moving.attempt.dependencies : null).toEqual([DIM]);

    shell.up(at(0.625, 1.13));
    expect(offsetOf(shell)).toBe(1.2); // not 1.1 (a rounded delta), not −1.2 (the right normal)
    expect(shell.doc().dimensions[ID]).toMatchObject({ a: row?.a, b: row?.b });
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([DIM]);
    shell.key("z", { meta: true });
    expect(offsetOf(shell)).toBe(0.5);

    shell.drag(at(0.625, 0.5), at(0.625, 1.137), { ctrl: true });
    expect(offsetOf(shell)).toBe(1.137);

    const still = FakeShell.withDocument(D());
    const unchanged = still.doc();
    still.moveTo(at(0.625, 0.5), { ctrl: true });
    still.down(at(0.625, 0.5), { ctrl: true });
    still.moveTo(at(0.625, 1.0), { ctrl: true });
    still.moveTo(at(0.625, 0.5), { ctrl: true });
    still.up(at(0.625, 0.5), { ctrl: true });
    expect(still.doc()).toBe(unchanged);
    expect(still.state.undo.past).toHaveLength(0);

    // The offset is absolute: a press on the text, off the line, brings the line under the pointer.
    const text = FakeShell.withDocument(H());
    const l = dimensionLayout(P(1, 1), P(4, 1), 0.5, CANVAS_STYLE, 80);
    if (!l) throw new Error("expected a layout");
    const c = scale(l.text.box.reduce(add, P(0, 0)), 1 / l.text.box.length);
    expect(distanceToSegment(c, ...l.line)).toBeGreaterThan(0.075);
    text.drag(c, P(c.x, 2.13));
    expect(offsetOf(text)).toBe(1.2); // not 1.0 (the old offset plus the pointer's delta)
  });

  it("› a dimension drawn right to left keeps its sign", () => {
    const shell = FakeShell.withDocument(R());
    shell.drag(P(2, 1.5), P(2, 2.13));
    expect(offsetOf(shell)).toBe(-1.2);
    const line = layer(shell)[0];
    expect(line?.kind === "segment" ? [line.a.y, line.b.y] : null).toEqual([2.2, 2.2]);
  });

  it("› Delete and Backspace delete it; undo restores it (AC-09)", () => {
    const shell = FakeShell.withDocument(H());
    shell.click(P(2, 1.52));
    shell.key("Delete");
    expect(shell.doc().dimensions).toEqual({});
    shell.key("z", { meta: true });
    expect(Object.keys(shell.doc().dimensions)).toEqual([ID]);
    shell.click(P(2, 1.52));
    shell.key("Backspace");
    expect(shell.doc().dimensions).toEqual({});
  });

  it("› arrows, R and Cmd/Ctrl+D do nothing with a dimension selected", () => {
    const shell = FakeShell.withDocument(H());
    shell.click(P(2, 1.52));
    const before = shell.doc();
    shell.clearEffects();
    shell.key("ArrowRight");
    shell.key("ArrowUp", { shift: true });
    shell.key("r");
    shell.key("d", { meta: true });
    shell.key("d", { ctrl: true });
    expect(shell.doc()).toBe(before);
    expect(selectState(shell)?.kind).toBe("idle");
    expect(shell.effectsOf("startTimer")).toEqual([]);
    expect(shell.state.selection).toEqual([DIM]);
  });

  it("› a dimension replaces the selection; Shift never adds it to furniture; a box ignores it", () => {
    const shell = FakeShell.withDocument(chair(H()));
    shell.click(CHAIR_AT);
    expect(shell.state.selection).toEqual([CHAIR]);
    shell.click(P(2, 1.52), { shift: true });
    expect(shell.state.selection).toEqual([DIM]);
    shell.click(CHAIR_AT, { shift: true });
    expect(shell.state.selection).toEqual([CHAIR]);
    shell.drag(P(0.5, 3.7), P(5.5, 0.5));
    expect(shell.state.selection).toEqual([CHAIR]);
  });

  it("› the selected dimension is drawn in the selection colour", () => {
    const shell = FakeShell.withDocument(H());
    expect(layer(shell).length).toBeGreaterThan(0);
    expect(colors(shell)).toEqual([CANVAS_STYLE.dim.ink]);
    shell.click(P(2, 1.52));
    expect(colors(shell)).toEqual([CANVAS_STYLE.dim.selected]);
    shell.moveTo(P(2, 1.5));
    shell.down(P(2, 1.5));
    shell.moveTo(P(2, 2.1));
    expect(selectState(shell)?.kind).toBe("moving");
    expect(colors(shell)).toEqual([CANVAS_STYLE.dim.selected]);
  });

  it("› a dimension deleted by another edit leaves the selection", () => {
    const shell = FakeShell.withDocument(H());
    shell.click(P(2, 1.52));
    expect(shell.state.selection).toEqual([DIM]);
    shell.command({ type: "deleteEntities", ids: [{ table: "dimensions", id: ID }] });
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().properties).toEqual({ kind: "none" });
  });
});
