import { describe, expect, it } from "vitest";
import { MESSAGES, emptyDocument, execute, unwrap } from "@fm/domain";
import { NO_MODS } from "../src/types";
import { COLORS } from "../src/view/colors";
import { dividedRoomDoc, jointAt, localState, pointOf, roomDoc, wallBetween, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

function selectState(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "select") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

function wallsLayer(shell: FakeShell) {
  return shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
}

describe("select tool (spec §5.6)", () => {
  it("selects a wall on click, shows its properties, and clears on empty space", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("4.00");
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([]);
  });

  it("selects a joint on click", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 4 });
    expect(shell.state.selection).toEqual([{ table: "joints", id: corner }]);
  });

  it("selects and drags an unselected wall in one press, as one undo entry", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const doc = shell.doc();
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const top = jointAt(doc, { x: 6, y: 4 });
    const bottom = jointAt(doc, { x: 6, y: 0 });
    shell.drag({ x: 6, y: 2 }, { x: 6.6, y: 2 });
    expect(pointOf(shell.doc(), top).x).toBeCloseTo(6.6, 9);
    expect(pointOf(shell.doc(), bottom).x).toBeCloseTo(6.6, 9);
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("drags a handle of the selected wall and keeps the wall selected", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("does not drag below the 4 px threshold", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 6.03, y: 2 }); // 2.4 px at 80 px/m
    shell.up({ x: 6.03, y: 2 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("draws an invalid drag red, reverts on release, adds no history and explains why", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 }); // still valid
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    const moving = selectState(shell);
    expect(moving.kind === "moving" && moving.attempt.ok).toBe(false);
    expect(wallsLayer(shell).some((p) => p.kind === "polygon" && p.color === COLORS.invalid)).toBe(true);
    shell.up({ x: 2, y: 2 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("cancels a drag on Esc", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 5 });
    expect(shell.state.snap).not.toBeNull(); // added in self-review: Esc clears the snap glyph
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.snap).toBeNull();
    shell.up({ x: 6, y: 5 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("deletes the selected wall and the joints it leaves unused", () => {
    const single = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }));
    single.click({ x: 1, y: 0 });
    single.key("Delete");
    expect(single.doc()).toEqual({ joints: {}, walls: {}, zoneLabels: {} });

    const room = FakeShell.withDocument(roomDoc());
    room.click({ x: 6, y: 2 });
    room.key("Backspace");
    expect(Object.keys(room.doc().walls)).toHaveLength(3);
    expect(Object.keys(room.doc().joints)).toHaveLength(4); // both ends still belong to other walls
  });

  it("highlights the wall under the cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 2 });
    expect(shell.state.hover).toEqual({ table: "walls", id: right });
    expect(shell.view().cursor).toBe("pointer");
    expect(wallsLayer(shell).some((p) => p.kind === "polygon" && p.color === COLORS.wallHover)).toBe(true);
  });

  it("clears the selection on Esc when idle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.click({ x: 6, y: 2 });
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
  });

  // Added in self-review: each test below kills a mutation the plan's tests let survive.
  it("moves a wall by the grid-rounded delta; Shift keeps the larger axis; Ctrl skips rounding", () => {
    const corner = { x: 6, y: 4 };
    const plain = FakeShell.withDocument(roomDoc());
    plain.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.05 }); // 0.2 m grid at 80 px/m
    expect(pointOf(plain.doc(), jointAt(roomDoc(), corner))).toEqual({ x: 6.6, y: 4 });

    const shift = FakeShell.withDocument(roomDoc());
    shift.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.3 }, { shift: true });
    expect(pointOf(shift.doc(), jointAt(roomDoc(), corner))).toEqual({ x: 6.6, y: 4 });

    const ctrl = FakeShell.withDocument(roomDoc());
    ctrl.drag({ x: 6, y: 2 }, { x: 6.63, y: 2.05 }, { ctrl: true });
    const moved = pointOf(ctrl.doc(), jointAt(roomDoc(), corner));
    expect(moved.x).toBeCloseTo(6.63, 9);
    expect(moved.y).toBeCloseTo(4.05, 9);
  });

  it("snaps a dragged joint, ignoring the joint itself and its own walls", () => {
    // Off-grid joint: dragged 7 px away, it would snap back onto itself if not excluded.
    const single = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 2.03, y: 1 }));
    const end = jointAt(single.doc(), { x: 2.03, y: 1 });
    single.drag({ x: 2.03, y: 1 }, { x: 2.12, y: 1.02 }); // 10.6 and 5.1 grid steps: no rounding tie
    expect(pointOf(single.doc(), end)).toEqual({ x: 2.2, y: 1 }); // the grid

    // 4 px above its own top wall: it would snap onto that wall (5.45, 4) instead of the grid (5.4, 4).
    const room = FakeShell.withDocument(roomDoc());
    const corner = jointAt(room.doc(), { x: 6, y: 4 });
    room.drag({ x: 6, y: 4 }, { x: 5.45, y: 4.05 });
    expect(pointOf(room.doc(), corner)).toEqual({ x: 5.4, y: 4 });
  });

  it("gets no angle or perpendicular snap on a joint drag: those are the wall tool's (§5.8)", () => {
    // From the joint (3, 0), the cursor (5, 0.6) is 0.062 m off the 15° ray: the joint stays on the grid.
    const single = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 3, y: 0 }));
    const end = jointAt(single.doc(), { x: 3, y: 0 });
    single.drag({ x: 3, y: 0 }, { x: 5, y: 0.6 });
    expect(pointOf(single.doc(), end)).toEqual({ x: 5, y: 0.6 });

    // The foot of (3, 0) on the wall y = 4 is (3, 4), 0.094 m from the cursor (the wall's midpoint is 1 m away):
    // on-wall (3.05, 4) wins instead.
    let doc = unwrap(execute(emptyDocument(), { type: "addWall", opId: "a", from: { at: { x: 0, y: 0 } }, to: { at: { x: 3, y: 0 } } })).doc;
    doc = unwrap(execute(doc, { type: "addWall", opId: "b", from: { at: { x: 0, y: 4 } }, to: { at: { x: 8, y: 4 } } })).doc;
    const two = FakeShell.withDocument(doc);
    two.moveTo({ x: 3, y: 0 });
    two.down({ x: 3, y: 0 });
    two.moveTo({ x: 3.05, y: 2 });
    two.moveTo({ x: 3.05, y: 3.92 });
    expect(two.state.snap?.kind).toBe("onWall");
  });

  it("keeps the last valid preview while the attempt is invalid, and clears the snap on release", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 });
    shell.moveTo({ x: 2, y: 2 });
    const moving = selectState(shell);
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, corner)).toEqual({ x: 4, y: 3 });
    expect(shell.state.snap).not.toBeNull();
    shell.up({ x: 2, y: 2 });
    expect(shell.state.snap).toBeNull();
  });

  // Planned deviation (wave 6 code review): the threshold is in world units at the current zoom.
  it("starts a drag when a scroll moves the camera under a still press, so the wall follows the cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    const bottom = jointAt(shell.doc(), { x: 6, y: 0 });
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.wheel(0, 204); // the content moves 204 px up: the cursor is now 2.55 m lower, over (6, -0.55)
    const moving = selectState(shell);
    expect(moving.kind).toBe("moving");
    // -2.55 m rounded to the 0.2 m grid at 80 px/m (-12.75 steps: no rounding tie)
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, top)).toEqual({ x: 6, y: 1.4 });
    const cursor = shell.state.pointer?.world ?? { x: 0, y: 0 };
    shell.moveTo({ x: cursor.x + 5 / 80, y: cursor.y }); // 5 px to the right
    shell.up({ x: cursor.x + 5 / 80, y: cursor.y });
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 1.4 });
    expect(pointOf(shell.doc(), bottom)).toEqual({ x: 6, y: -2.6 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("does not start a drag on a zoom at the cursor, and measures the threshold at the current zoom", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.wheel(0, -100, { ctrl: true }); // zoom in at the cursor: the world point under it stays put
    expect(selectState(shell).kind).toBe("pressing");
    shell.wheel(0, 100 + 100 * Math.log(2), { ctrl: true }); // back out to 40 px/m
    expect(shell.state.camera.zoom).toBeCloseTo(40, 6);
    expect(selectState(shell).kind).toBe("pressing");
    shell.moveTo({ x: 6 + 3 / 40, y: 2 }); // 3 px at 40 px/m (6 px at the default zoom)
    expect(selectState(shell).kind).toBe("pressing");
    shell.moveTo({ x: 6 + 5 / 40, y: 2 }); // 5 px
    expect(selectState(shell).kind).toBe("moving");
  });

  // Carried from wave 6: an applied undo drops the drag, so its release commits nothing.
  it("undoes the previous edit on Cmd+Z mid-drag, drops the drag, and commits nothing on release", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.drag({ x: 6, y: 2 }, { x: 6.6, y: 2 });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.moveTo({ x: 6.6, y: 2 });
    shell.down({ x: 6.6, y: 2 });
    shell.moveTo({ x: 7.2, y: 2 });
    expect(selectState(shell).kind).toBe("moving");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(roomDoc());
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.up({ x: 7.2, y: 2 });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.undo.future).toHaveLength(1);
  });

  // Review fix: release commits the moves of the last attempt, whatever the release point and mods.
  it("commits exactly what was last previewed when Shift is released before the button", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    const bottom = jointAt(shell.doc(), { x: 6, y: 0 });
    shell.moveTo({ x: 6, y: 2 }, { shift: true });
    shell.down({ x: 6, y: 2 }, { shift: true });
    shell.moveTo({ x: 7, y: 2.6 }, { shift: true });
    const moving = selectState(shell);
    expect(moving.kind === "moving" && pointOf(moving.attempt.doc, top)).toEqual({ x: 7, y: 4 });
    shell.up({ x: 7, y: 2.6 }); // without Shift
    expect(pointOf(shell.doc(), top)).toEqual({ x: 7, y: 4 });
    expect(pointOf(shell.doc(), bottom)).toEqual({ x: 7, y: 0 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("commits the last preview when the release arrives at another point", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.moveTo({ x: 6.6, y: 2 });
    shell.up({ x: 7.2, y: 2 }); // no move to the release point
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6.6, y: 4 });
  });

  it("refuses a red last attempt on release with its toast, even if the release point is valid", () => {
    const shell = FakeShell.withDocument(dividedRoomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 4, y: 3 });
    shell.moveTo({ x: 2, y: 2 }); // red: the right wall would cross the divider
    shell.up({ x: 4, y: 3 }); // valid there, but the last attempt was (2, 2)
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  // Review fix: each test below kills a named mutant.
  it("keeps a Shift joint drag on the axis through the joint's start", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 4 }, { x: 7.03, y: 4.25 }, { shift: true }); // x dominates, so y stays 4
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 7, y: 4 });
  });

  it("places a Ctrl joint drag at the raw cursor", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 4 }, { x: 6.63, y: 4.07 }, { ctrl: true });
    const moved = pointOf(shell.doc(), corner);
    expect(moved.x).toBeCloseTo(6.63, 9);
    expect(moved.y).toBeCloseTo(4.07, 9);
  });

  it("keeps y on a Shift wall drag when y dominates", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.drag({ x: 6, y: 2 }, { x: 6.05, y: 2.63 }, { shift: true });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
  });

  it("cancels a press on Esc, so a following move and release do nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    shell.down({ x: 6, y: 2 });
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.moveTo({ x: 6.6, y: 2 });
    shell.up({ x: 6.6, y: 2 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("clears the hover when the cursor leaves the entity", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 2 });
    expect(shell.state.hover).not.toBeNull();
    shell.moveTo({ x: 3, y: 2 });
    expect(shell.state.hover).toBeNull();
  });

  it("stays pressing at exactly 4 px", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.state = { ...shell.state, camera: { ...shell.state.camera, center: { x: 0, y: 0 }, zoom: 80 } };
    shell.send({ type: "pointerDown", screen: { x: 600, y: 400 }, mods: NO_MODS, button: 0 }); // the joint at (0, 0)
    expect(selectState(shell).kind).toBe("pressing");
    shell.send({ type: "pointerMove", screen: { x: 604, y: 400 }, mods: NO_MODS, button: 0 }); // 0.05 m · 80 = 4 px
    expect(selectState(shell).kind).toBe("pressing");
  });

  it("grabs a handle of the selected wall 7 px from its joint (handles 8 px, other hits 6 px)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.click({ x: 6, y: 2 });
    shell.drag({ x: 6, y: 4 + 7 / 80 }, { x: 6, y: 4.6 + 7 / 80 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 4.6 });
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 0, y: 4 }))).toEqual({ x: 0, y: 4 });
  });

  // Wave 7 code review: each test below is red on the reviewed code or kills a named mutant.
  it("grabs the nearest handle when both are in range", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 0.15, y: 0 }));
    const a = jointAt(shell.doc(), { x: 0, y: 0 });
    const b = jointAt(shell.doc(), { x: 0.15, y: 0 });
    shell.click({ x: 0.075, y: 0.05 }); // the wall: 4 px from it, 7.2 px from each joint
    shell.drag({ x: 0.09, y: 0 }, { x: 0.09, y: 1 }); // 7.2 px from a, 4.8 px from b
    expect(pointOf(shell.doc(), a)).toEqual({ x: 0, y: 0 });
    expect(pointOf(shell.doc(), b)).toEqual({ x: 0, y: 1 }); // the grid: 0.45 and 5 steps of 0.2 m
  });

  it("grabs endpoint a on an exact handle tie", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: -0.05, y: 0 }, { x: 0.05, y: 0 }));
    const a = jointAt(shell.doc(), { x: -0.05, y: 0 });
    const b = jointAt(shell.doc(), { x: 0.05, y: 0 });
    const wallId = wallBetween(shell.doc(), { x: -0.05, y: 0 }, { x: 0.05, y: 0 });
    shell.state = { ...shell.state, selection: [{ table: "walls", id: wallId }], camera: { ...shell.state.camera, center: { x: 0, y: 0 }, zoom: 80 } };
    shell.send({ type: "pointerDown", screen: { x: 600, y: 400 }, mods: NO_MODS, button: 0 }); // (0, 0): 4 px from each joint
    shell.send({ type: "pointerMove", screen: { x: 600, y: 320 }, mods: NO_MODS, button: 0 }); // 1 m away
    shell.send({ type: "pointerUp", screen: { x: 600, y: 320 }, mods: NO_MODS, button: 0 });
    expect(pointOf(shell.doc(), a)).toEqual({ x: 0.05, y: 1 }); // lined up with b (5 cm, within 10 px), y on the grid
    expect(pointOf(shell.doc(), b)).toEqual({ x: 0.05, y: 0 });
  });

  it("keeps a Shift joint drag on the axis through the joint, not through an off-centre press", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    // The press is 5.7 px from the joint; x dominates, so the axis is y = 4 and 1.03 m is 5.15 grid steps.
    // Through the press point it would be y = 4.05, 0.98 m from x = 6.05: the joint would land at (7.05, 4.05).
    shell.drag({ x: 6.05, y: 4.05 }, { x: 7.03, y: 4.3 }, { shift: true });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 7, y: 4 });
  });

  it("hits a free joint 5 px away but not 7 px away (6 px tolerance)", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 });
    const joint = jointAt(doc, { x: 0, y: 0 });
    const wallId = wallBetween(doc, { x: 0, y: 0 }, { x: 2, y: 0 });
    const near = FakeShell.withDocument(doc);
    near.click({ x: -5 / 80, y: 0 });
    expect(near.state.selection).toEqual([{ table: "joints", id: joint }]);
    const far = FakeShell.withDocument(doc);
    far.click({ x: -7 / 80, y: 0 }); // the wall still hits: its body adds half the thickness
    expect(far.state.selection).toEqual([{ table: "walls", id: wallId }]);
  });

  it("ends a press whose target left the document before the drag starts (phase 7: a remote delete)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const corner = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    expect(selectState(shell)).toMatchObject({ kind: "pressing", target: { kind: "joint", jointId: corner } });
    const other = wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }); // unreachable locally: state surgery
    expect(other.joints[corner]).toBeUndefined();
    shell.state = { ...shell.state, document: localState(shell.host, other).document };
    shell.moveTo({ x: 7, y: 4 });
    expect(selectState(shell)).toEqual({ kind: "idle" });
    shell.up({ x: 7, y: 4 });
    expect(shell.doc()).toEqual(other);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.state.toast).toBeNull();
  });
});
