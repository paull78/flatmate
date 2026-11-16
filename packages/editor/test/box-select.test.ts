import { describe, expect, it } from "vitest";
import { levelOf, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { placementsInBox } from "../src/tools/box-select";
import { COLORS } from "../src/view/colors";
import type { Primitive } from "../src/view/scene-types";
import { studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// studioDoc labelled "Studio" (L1), with two chairs in Layout (s0): c1/p0 spans x 3.775–4.225, c2/p0 x 4.775–5.225,
// both y 2.55–3. Night (n/s0) has cn/p0 where c1/p0 is. The bed (bed/p0, s0) spans x 0.7–2.3, y 1–3. Zoom 80 px/m.
const boxDoc = () =>
  withCommands(
    studioDoc(),
    { type: "labelZone", id: "L1", at: { x: 3, y: 0.6 }, name: "Studio", finish: null },
    { type: "placeObject", linked: false, deck: null, opId: "c1", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "c2", state: "s0", object: { kind: "chair" }, at: { x: 5, y: 3 } },
    { type: "placeObject", linked: false, deck: null, opId: "cn", state: "n/s0", object: { kind: "chair" }, at: { x: 4, y: 3 } },
  );
const P = (table: EntityRef["table"], id: string): EntityRef => ({ table, id });
const BED = P("placements", "bed/p0");
const C1 = P("placements", "c1/p0");
const C2 = P("placements", "c2/p0");
const FLOOR = { x: 3.5, y: 2.4 };
const FAR = { x: 5.5, y: 3.2 };
const FLOOR_LEVEL = levelOf(boxDoc(), null);

function selectKind(shell: FakeShell): string {
  const t = shell.state.tool;
  return t.name === "select" ? t.state.kind : t.name;
}

function overlays(shell: FakeShell): readonly Primitive[] {
  return shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
}

// The box's outline only: a selected piece's zone outlines are dashed too, in COLORS.zoneOutline (smart.09).
const dashed = (shell: FakeShell) => overlays(shell).filter((p) => p.kind === "segment" && p.dash !== undefined && p.color === COLORS.wallSelected);
const boxFills = (shell: FakeShell) => overlays(shell).filter((p) => p.kind === "polygon" && p.color === COLORS.boxFill);

function expectNear(actual: readonly Point[], expected: Point[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((q, i) => {
    expect(actual[i]?.x).toBeCloseTo(q.x, 9);
    expect(actual[i]?.y).toBeCloseTo(q.y, 9);
  });
}

describe("box select in the Select tool (spec: tools, direct.07)", () => {
  it("a drag from a room's floor selects the active layout's furniture fully inside the box (AC-07)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    const before = shell.doc();
    shell.drag(FLOOR, FAR);
    expect(shell.state.selection).toEqual([C1, C2]);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.doc()).toBe(before);
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
  });

  it("a piece partly inside the box is not selected (AC-07)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.drag(FLOOR, { x: 5.0, y: 3.2 });
    expect(shell.state.selection).toEqual([C1]);
  });

  it("a drag from empty canvas outside the room boxes too, in any direction", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.drag({ x: 7, y: 4.5 }, FLOOR);
    expect(shell.state.selection).toEqual([C1, C2]);
  });

  it("a click on the floor without a drag selects the room; a 2.4 px move is still a click (AC-07)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click(FLOOR);
    expect(shell.state.selection).toEqual([P("zoneLabels", "L1")]);
    shell.click({ x: 7, y: 4.5 });
    expect(shell.state.selection).toEqual([]);
    shell.down(FLOOR);
    shell.moveTo({ x: 3.53, y: 2.4 }); // 0.03 m × 80 px/m = 2.4 px
    expect(dashed(shell)).toEqual([]);
    expect(shell.view().cursor).not.toBe("crosshair");
    shell.up({ x: 3.53, y: 2.4 });
    expect(shell.state.selection).toEqual([P("zoneLabels", "L1")]);
  });

  it("Shift+drag adds to a furniture selection without duplicates (AC-07)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 1.5, y: 2 });
    expect(shell.state.selection).toEqual([BED]);
    shell.drag(FLOOR, { x: 4.5, y: 3.2 }, { shift: true });
    expect(shell.state.selection).toEqual([BED, C1]);
    shell.drag(FLOOR, FAR, { shift: true });
    expect(shell.state.selection).toEqual([BED, C1, C2]);
    expect(shell.state.selection).toHaveLength(3);
  });

  it("a Shift-click on a floor still selects the room alone (direct.02)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 1.5, y: 2 });
    shell.click(FLOOR, { shift: true });
    expect(shell.state.selection).toEqual([P("zoneLabels", "L1")]);
  });

  it("a drag from a room tag draws a box too", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.drag({ x: 3, y: 0.6 }, { x: 4.5, y: 3.2 });
    expect(shell.state.selection).toEqual([C1]);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Shift+drag adds the boxed pieces to a wall selection: walls group with furniture (straight.09)", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 6, y: 2 });
    expect(shell.state.selection[0]?.table).toBe("walls");
    shell.drag(FLOOR, FAR, { shift: true });
    expect(shell.state.selection.map((r) => r.table)).toEqual(["walls", "placements", "placements"]);
    expect(shell.state.selection.slice(1)).toEqual([C1, C2]);
  });

  it("an empty box clears the selection; with Shift it keeps it", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 1.5, y: 2 });
    shell.drag({ x: 4.5, y: 1.2 }, { x: 5.5, y: 2.0 });
    expect(shell.state.selection).toEqual([]);
    shell.click({ x: 1.5, y: 2 });
    shell.drag({ x: 4.5, y: 1.2 }, { x: 5.5, y: 2.0 }, { shift: true });
    expect(shell.state.selection).toEqual([BED]);
  });

  it("draws the box as a faint fill under four dashed 1 px outlines while dragging", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.moveTo(FLOOR);
    shell.down(FLOOR);
    shell.moveTo(FAR);
    const fills = boxFills(shell);
    expect(fills).toHaveLength(1);
    const fill = fills[0];
    expectNear(fill?.kind === "polygon" ? fill.points : [], [FLOOR, { x: 5.5, y: 2.4 }, FAR, { x: 3.5, y: 3.2 }]);
    const lines = dashed(shell);
    expect(lines).toHaveLength(4);
    for (const s of lines) expect(s).toMatchObject({ dash: [4, 3], width: { px: 1 }, color: COLORS.wallSelected });
    const ne = { x: 5.5, y: 2.4 };
    const sw = { x: 3.5, y: 3.2 };
    expectNear(
      lines.flatMap((s) => (s.kind === "segment" ? [s.a, s.b] : [])),
      [FLOOR, ne, ne, FAR, FAR, sw, sw, FLOOR],
    );
    // The fill comes first: WebGL draws polygons before segments, so Canvas2D must too (rendering.md).
    const all = overlays(shell);
    const fillAt = all.findIndex((p) => p.kind === "polygon" && p.color === COLORS.boxFill);
    const firstDash = all.findIndex((p) => p.kind === "segment" && p.dash !== undefined && p.color === COLORS.wallSelected);
    expect(fillAt).toBeGreaterThanOrEqual(0);
    expect(fillAt).toBeLessThan(firstDash);
    expect(shell.view().cursor).toBe("crosshair");
    shell.up(FAR);
    expect(dashed(shell)).toEqual([]);
    expect(boxFills(shell)).toEqual([]);
  });

  it("Esc cancels the box: the release selects and moves nothing", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 1.5, y: 2 });
    shell.down(FLOOR, { shift: true });
    shell.moveTo(FAR, { shift: true });
    shell.key("Escape");
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(dashed(shell)).toEqual([]);
    shell.up(FAR, { shift: true });
    expect(shell.state.selection).toEqual([BED]);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("a plain press clears the selection at once, so Esc leaves nothing selected", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.click({ x: 1.5, y: 2 });
    shell.down(FLOOR);
    shell.moveTo(FAR);
    expect(shell.state.selection).toEqual([]);
    shell.key("Escape");
    shell.up(FAR);
    expect(shell.state.selection).toEqual([]);
    // a box from the floor of a selected room never leaves it selected
    shell.click(FLOOR);
    shell.down(FLOOR);
    shell.moveTo(FAR);
    expect(shell.state.selection).toEqual([]);
  });

  it("furniture of another layout is never boxed", () => {
    const shell = FakeShell.withDocument(boxDoc());
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.drag(FLOOR, FAR);
    expect(shell.state.selection).toEqual([P("placements", "cn/p0")]);
  });

  it("placementsInBox keeps a footprint touching the box edge (1 mm slack) and orders by id", () => {
    expect(placementsInBox(boxDoc(), "s0", FLOOR_LEVEL, { x: 3.775, y: 2.55 }, { x: 5.225, y: 3 })).toEqual(["c1/p0", "c2/p0"]);
    // 0.5 mm inside each footprint edge: within the slack
    expect(placementsInBox(boxDoc(), "s0", FLOOR_LEVEL, { x: 3.7755, y: 2.5505 }, { x: 5.2245, y: 2.9995 })).toEqual(["c1/p0", "c2/p0"]);
    // 5 mm inside: past it
    expect(placementsInBox(boxDoc(), "s0", FLOOR_LEVEL, { x: 3.78, y: 2.55 }, { x: 5.225, y: 3 })).toEqual(["c2/p0"]);
    expect(placementsInBox(boxDoc(), "s0", FLOOR_LEVEL, { x: 5.225, y: 3 }, { x: 3.775, y: 2.55 })).toEqual(["c1/p0", "c2/p0"]);
  });

  it("a box starts while an edit is in flight and submits nothing (no canCommit gate)", () => {
    const r = FakeRemote.open(boxDoc());
    r.shell.drag({ x: 1.5, y: 2 }, { x: 2, y: 2 }); // moves the bed; left unaccepted
    expect(r.submits()).toHaveLength(1);
    r.shell.drag(FLOOR, FAR);
    expect(r.shell.state.selection).toEqual([C1, C2]);
    expect(r.submits()).toHaveLength(1);
  });

  it("a remote move during the box counts at release; the box survives it", () => {
    const r = FakeRemote.open(boxDoc());
    r.shell.moveTo(FLOOR);
    r.shell.down(FLOOR);
    r.shell.moveTo(FAR);
    r.remote({ type: "movePlacement", placementId: "c2/p0", at: { x: 5, y: 1.5 }, rotation: 0 });
    expect(selectKind(r.shell)).toBe("box");
    r.shell.up(FAR);
    expect(r.shell.state.selection).toEqual([C1]);
  });

  it("a click whose room is deleted remotely during the press selects nothing", () => {
    const r = FakeRemote.open(boxDoc());
    r.shell.down(FLOOR);
    r.remote({ type: "deleteEntities", ids: [{ table: "zoneLabels", id: "L1" }] });
    r.shell.up(FLOOR);
    expect(r.shell.state.selection).toEqual([]);
  });

  it("a snapshot or a lost connection cancels the box", () => {
    const lost = FakeRemote.open(boxDoc());
    lost.shell.moveTo(FLOOR);
    lost.shell.down(FLOOR);
    lost.shell.moveTo(FAR);
    lost.disconnect();
    expect(selectKind(lost.shell)).toBe("idle");
    expect(lost.shell.view().toast).toBe(CONNECTION_LOST);
    lost.shell.up(FAR);
    expect(lost.shell.state.selection).toEqual([]);

    const snap = FakeRemote.open(boxDoc());
    snap.shell.moveTo(FLOOR);
    snap.shell.down(FLOOR);
    snap.shell.moveTo(FAR);
    snap.snapshot();
    expect(selectKind(snap.shell)).toBe("idle");
    expect(snap.shell.view().toast).toBe(GESTURE_CANCELLED);
    snap.shell.up(FAR);
    expect(snap.shell.state.selection).toEqual([]);
  });

  it("a snapshot during a click on a floor cancels nothing: the release selects the room", () => {
    const r = FakeRemote.open(boxDoc());
    r.shell.moveTo(FLOOR);
    r.shell.down(FLOOR);
    r.snapshot();
    expect(selectKind(r.shell)).toBe("box");
    expect(r.shell.view().toast).toBeNull();
    r.shell.up(FLOOR);
    expect(r.shell.state.selection).toEqual([P("zoneLabels", "L1")]);
  });
});
