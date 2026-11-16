import { describe, expect, it } from "vitest";
import { emptyDocument } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { dimensionLayout } from "../src/view/dimension-layout";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The Dimension tool (spec §Placing). FakeShell.local() is an empty drawing at zoom 80: Auto snaps to 0.2 m and the
// snap tolerance is 0.125 m. An empty drawing keeps these answers stable when anchoring and face snaps arrive.

const P = (x: number, y: number): Point => ({ x, y });
const tool = (shell: FakeShell) => {
  const t = shell.state.tool;
  return t.name === "dimension" ? t.state : null;
};
const rows = (shell: FakeShell) => Object.values(shell.doc().dimensions);
const layer = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "dimensions")?.primitives ?? [];
const texts = (shell: FakeShell): string[] => layer(shell).flatMap((p) => (p.kind === "text" ? [p.text] : []));
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt;

function armed(): FakeShell {
  const shell = FakeShell.local();
  shell.key("m");
  return shell;
}

/** A, B, then the pointer at `at`, with the tool waiting for the third click. */
function placing(a: Point, b: Point, at: Point, step?: 0.1 | 0.25): FakeShell {
  const shell = armed();
  if (step) shell.ui({ type: "setSnapStep", step });
  shell.click(a);
  shell.click(b);
  shell.moveTo(at);
  return shell;
}

describe("the Dimension tool (spec §Placing)", () => {
  it("M or the toolbar picks the tool; prompt and cursor (AC-01)", () => {
    const shell = armed();
    const vm = shell.view();
    expect(vm.activeTool).toBe("dimension");
    expect(vm.commandBar.prompt).toBe("Click the first point");
    expect(vm.cursor).toBe("crosshair");
    expect(vm.toolHelp).toMatchObject({ label: "Dimension", key: "M" });
    shell.moveTo(P(1.03, 0.97));
    expect(shell.view().snap).toEqual({ kind: "grid", at: { x: 1, y: 1 } }); // the mark before the first click
    const other = FakeShell.local();
    other.ui({ type: "pickTool", tool: "dimension" });
    expect(other.view()).toMatchObject({ activeTool: "dimension", commandBar: vm.commandBar, cursor: "crosshair", toolHelp: vm.toolHelp });
  });

  it("three clicks add one dimension; one undo, one redo (AC-02)", () => {
    const shell = armed();
    shell.ui({ type: "setSnapStep", step: 0.1 });
    const past = shell.state.undo.past.length;
    shell.click(P(0, 0));
    expect(prompt(shell)).toBe("Click the second point");
    shell.click(P(3, 0));
    expect(prompt(shell)).toBe("Click to place the dimension");
    shell.down(P(1.5, -0.5));
    expect(shell.view().snap).toEqual({ kind: "grid", at: { x: 1.5, y: -0.5 } }); // the mark for the next A, before the release
    shell.up(P(1.5, -0.5));
    expect(prompt(shell)).toBe("Click the first point");
    expect(shell.view().activeTool).toBe("dimension");
    const placed = rows(shell);
    expect(placed).toEqual([{ id: expect.any(String), a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, offset: -0.5 }]);
    expect(shell.state.undo.past.length).toBe(past + 1);
    expect(texts(shell)).toEqual(["3.00"]);
    shell.key("z", { meta: true });
    expect(rows(shell)).toEqual([]);
    shell.key("z", { meta: true, shift: true });
    expect(rows(shell)).toEqual(placed);
  });

  describe("the offset is signed from A→B and rounded to the snap step", () => {
    it("right to left: the side follows A→B, not +y", () => {
      expect(tool(placing(P(3, 0), P(0, 0), P(1.5, -0.5), 0.1))).toMatchObject({ kind: "offset", offset: 0.5 });
    });

    it("diagonal: the distance across the line, not dx, dy or the distance from A", () => {
      expect(tool(placing(P(0, 0), P(3, 4), P(0.7, 1.6)))).toMatchObject({ kind: "offset", b: { x: 3, y: 4 }, offset: 0.4 });
    });

    it("rounded to the snap step, not the zoom's grid", () => {
      expect(tool(placing(P(0, 0), P(3, 0), P(1.5, -0.43)))).toMatchObject({ offset: -0.4 });
      expect(tool(placing(P(0, 0), P(3, 0), P(1.5, -0.43), 0.25))).toMatchObject({ offset: -0.5 });
    });
  });

  it("the second click snaps like the Wall tool's (angles, Shift)", () => {
    const shell = armed();
    shell.click(P(0, 0));
    shell.click(P(2.6, 1.55)); // the 30° ray at 3.00 m; the grid alone would give (2.6, 1.6)
    const t = tool(shell);
    expect(t?.kind).toBe("offset");
    const b = t?.kind === "offset" ? t.b : P(NaN, NaN);
    expect(b.x).toBeCloseTo(2.598076, 6);
    expect(b.y).toBeCloseTo(1.5, 6);

    const shift = armed();
    shift.click(P(0, 0));
    shift.click(P(3, 0.3), { shift: true });
    expect(tool(shift)).toMatchObject({ kind: "offset", b: { x: 3, y: 0 } });
  });

  it("a second click under 1 cm from A is ignored (AC-07)", () => {
    const shell = armed();
    shell.click(P(1, 1));
    shell.click(P(1.008, 1), { ctrl: true });
    expect(tool(shell)).toEqual({ kind: "second", a: { x: 1, y: 1 } });
    expect(shell.view().toast).toBeNull();
    expect(rows(shell)).toEqual([]);
    shell.click(P(1.012, 1), { ctrl: true });
    const t = tool(shell);
    expect(t?.kind).toBe("offset");
    const b = t?.kind === "offset" ? t.b : P(NaN, NaN);
    expect(b.x).toBeCloseTo(1.012, 9);
    expect(b.y).toBeCloseTo(1, 9);
    expect(shell.view().toast).toBeNull();
  });

  it("Esc steps back; Esc in idle picks Select (AC-07)", () => {
    const shell = placing(P(0, 0), P(3, 0), P(2, 0));
    shell.key("Escape");
    expect(tool(shell)).toEqual({ kind: "second", a: { x: 0, y: 0 } });
    expect(texts(shell)).toEqual(["2.00"]); // the rubber band to the pointer, without a move
    expect(shell.view().snap).toEqual({ kind: "angle", at: { x: 2, y: 0 } });
    shell.key("Escape");
    expect(tool(shell)).toEqual({ kind: "idle" });
    expect(layer(shell)).toEqual([]);
    expect(shell.view().snap).toEqual({ kind: "grid", at: { x: 2, y: 0 } });
    expect(shell.view().activeTool).toBe("dimension");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("the preview: rubber band, then the offset dimension, through the layer", () => {
    const shell = armed();
    shell.click(P(0, 0));
    shell.moveTo(P(2, 0));
    expect(texts(shell)).toEqual(["2.00"]);
    expect(rows(shell)).toEqual([]);
    expect(shell.view().snap).toEqual({ kind: "angle", at: { x: 2, y: 0 } }); // the 0° ray outranks the grid
    shell.click(P(3, 0));
    shell.ui({ type: "setSnapStep", step: 0.1 });
    shell.moveTo(P(1.5, -0.5));
    const expected = dimensionLayout(P(0, 0), P(3, 0), -0.5, CANVAS_STYLE, 80);
    const segments = layer(shell).flatMap((p) => (p.kind === "segment" ? [[p.a, p.b]] : []));
    expect(segments).toContainEqual(expected?.line);
    expect(texts(shell)).toEqual(["3.00"]);
    expect(rows(shell)).toEqual([]);
    expect(shell.view().snap).toBeNull();
  });

  it("leaving the canvas hides the preview and keeps A and B", () => {
    const shell = armed();
    shell.click(P(0, 0));
    shell.moveTo(P(2, 0));
    const second = tool(shell);
    shell.send({ type: "pointerLeave" });
    expect(layer(shell)).toEqual([]);
    expect(tool(shell)).toEqual(second);
    expect(shell.view().snap).toBeNull();
    shell.moveTo(P(2, 0));
    expect(texts(shell)).toEqual(["2.00"]);

    shell.click(P(3, 0));
    shell.moveTo(P(1.5, -0.6));
    const offset = tool(shell);
    shell.send({ type: "pointerLeave" });
    expect(layer(shell)).toEqual([]);
    expect(tool(shell)).toEqual(offset);
    expect(shell.view().snap).toBeNull();
    shell.moveTo(P(1.5, -0.6));
    expect(texts(shell)).toEqual(["3.00"]);
  });

  describe("tool switch, undo, redo and a layout switch drop it", () => {
    it("a tool switch", () => {
      const shell = armed();
      shell.click(P(0, 0));
      shell.key("w");
      shell.key("m");
      expect(tool(shell)).toEqual({ kind: "idle" });
    });

    it("undo and redo", () => {
      const shell = armed();
      shell.click(P(0, 0));
      shell.click(P(3, 0));
      shell.click(P(1.5, -0.6));
      shell.click(P(0, 1));
      shell.key("z", { meta: true });
      expect(tool(shell)).toEqual({ kind: "idle" });
      expect(rows(shell)).toEqual([]);
      shell.click(P(0, 1));
      expect(tool(shell)?.kind).toBe("second");
      shell.key("z", { meta: true, shift: true });
      expect(tool(shell)).toEqual({ kind: "idle" });
      expect(rows(shell)).toHaveLength(1);
    });

    it("a layout switch", () => {
      const shell = FakeShell.withDocument(withCommands(emptyDocument(), { type: "copyState", opId: "c", from: "s0", name: "Copy" }));
      shell.key("m");
      shell.click(P(0, 0));
      expect(tool(shell)?.kind).toBe("second");
      shell.ui({ type: "setActiveState", id: "c/s0" });
      expect(tool(shell)).toEqual({ kind: "idle" });
      expect(shell.view().activeTool).toBe("dimension");
    });
  });

  it("a snapshot or lost connection drops it; a remote change keeps it", () => {
    const r = FakeRemote.open(roomDoc());
    r.shell.key("m");
    r.snapshot(); // an armed tool with nothing placed is left alone
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBeNull();
    r.shell.click(P(1, 1));
    r.remote({ type: "addWall", opId: "bob-op", from: { at: P(10, 10) }, to: { at: P(12, 10) } }); // a topology change
    expect(tool(r.shell)).toEqual({ kind: "second", a: { x: 1, y: 1 } });
    expect(r.shell.view().toast).toBeNull();
    r.snapshot();
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.click(P(1, 1));
    expect(tool(r.shell)?.kind).toBe("second");
    r.disconnect();
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(r.shell.view().toast).toBe(CONNECTION_LOST);
  });

  it("a refused third click keeps the placed points", () => {
    const r = FakeRemote.open();
    r.shell.key("m");
    r.shell.ui({ type: "setSnapStep", step: 0.1 });
    for (const p of [P(0, 0), P(3, 0), P(1.5, -0.5)]) r.shell.click(p);
    expect(r.submits()).toHaveLength(1); // pending
    r.shell.click(P(0, 1));
    r.shell.click(P(3, 1));
    r.shell.click(P(1.5, 1.5));
    expect(r.shell.view().toast).toBe("Waiting for server");
    expect(tool(r.shell)).toEqual({ kind: "offset", a: { x: 0, y: 1 }, b: { x: 3, y: 1 }, offset: 0.5 });
    r.accept();
    r.shell.click(P(1.5, 1.5));
    expect(r.submits()).toHaveLength(2);
    expect(tool(r.shell)).toEqual({ kind: "idle" });
    expect(Object.values(r.shell.doc().dimensions)).toHaveLength(2);
  });
});
