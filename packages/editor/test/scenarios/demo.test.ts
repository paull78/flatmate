import { describe, expect, it } from "vitest";
import { MESSAGES, zones } from "@fm/domain";
import { COLORS } from "../../src/view/colors";
import { jointAt, pointOf, wallBetween } from "../builders";
import { FakeShell } from "../fake-shell";
import { drawDivider, drawRoom, labelRooms, resizeRightWall } from "./demo-steps";

const count = (o: object) => Object.keys(o).length;
const areas = (shell: FakeShell) => zones(shell.doc()).map((z) => z.area?.toFixed(2)).sort();
const hasRedWall = (shell: FakeShell) =>
  (shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? []).some(
    (p) => p.kind === "polygon" && p.color === COLORS.invalid,
  );

function throughStep5(): FakeShell {
  const shell = FakeShell.local();
  drawRoom(shell);
  drawDivider(shell);
  labelRooms(shell);
  resizeRightWall(shell);
  return shell;
}

describe("demo script, headless (spec §1.4)", () => {
  it("step 2: draws the 6 × 4 m room with Shift and typed lengths, and closes it", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    const doc = shell.doc();
    expect([count(doc.walls), count(doc.joints)]).toEqual([4, 4]);
    wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
    wallBetween(doc, { x: 0, y: 4 }, { x: 0, y: 0 });
    expect(pointOf(doc, jointAt(doc, { x: 6, y: 4 }))).toEqual({ x: 6, y: 4 }); // exact, not just within 1 mm
    const tool = shell.state.tool;
    expect(tool.name === "wall" && tool.state.kind).toBe("idle");
  });

  it("step 3: the divider joins the two midpoints exactly and splits both walls", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    const doc = shell.doc();
    expect([count(doc.walls), count(doc.joints)]).toEqual([7, 6]);
    expect(pointOf(doc, jointAt(doc, { x: 3, y: 0 }))).toEqual({ x: 3, y: 0 });
    expect(pointOf(doc, jointAt(doc, { x: 3, y: 4 }))).toEqual({ x: 3, y: 4 });
    wallBetween(doc, { x: 3, y: 0 }, { x: 3, y: 4 });
    wallBetween(doc, { x: 0, y: 0 }, { x: 3, y: 0 });
    wallBetween(doc, { x: 3, y: 0 }, { x: 6, y: 0 });
    wallBetween(doc, { x: 6, y: 4 }, { x: 3, y: 4 });
    wallBetween(doc, { x: 3, y: 4 }, { x: 0, y: 4 });
    expect(shell.state.undo.past.map((e) => e.status)).toEqual(["usable", "usable", "usable", "usable", "usable"]);
    // A local document talks to no server, and this run shows no toast: nothing but renders along the way.
    expect(shell.effects.filter((e) => e.type !== "render")).toEqual([]);
    expect(shell.effectsOf("render").length).toBeGreaterThan(0);
  });

  it("step 3, undone: removing the divider restores the unsplit room exactly", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    const room = shell.doc();
    drawDivider(shell);
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(room);
  });

  it("step 4: Z labels both rooms; each shows 10.64 m²", () => {
    const shell = FakeShell.local();
    drawRoom(shell);
    drawDivider(shell);
    labelRooms(shell);
    expect(Object.values(shell.doc().zoneLabels).map((l) => l.name).sort()).toEqual(["Room 1", "Room 2"]);
    expect(areas(shell)).toEqual(["10.64", "10.64"]);
    const props = shell.view().properties;
    expect(props.kind === "zone" && props.fields.map((f) => f.value)).toEqual(["Room 2", "10.64 m²"]);
  });

  it("step 5: the helper resizes the right wall to 3.5 m from its fixed a end; the top wall slopes", () => {
    const shell = throughStep5();
    const doc = shell.doc();
    expect(pointOf(doc, jointAt(doc, { x: 6, y: 3.5 }))).toEqual({ x: 6, y: 3.5 });
    wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 3.5 });
    wallBetween(doc, { x: 6, y: 3.5 }, { x: 3, y: 4 });
    expect(areas(shell)).toEqual(["10.64", "9.94"]);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("3.50");
  });

  it("step 6: dragging the top-right joint to (2, 2) crosses the divider: red, refused, reverted", () => {
    const shell = throughStep5();
    const corner = jointAt(shell.doc(), { x: 6, y: 3.5 });
    const entries = shell.state.undo.past.length;
    // The right wall is still selected after step 5, so (6, 3.5) is one of its handles.
    shell.moveTo({ x: 6, y: 3.5 });
    shell.down({ x: 6, y: 3.5 });
    shell.moveTo({ x: 4, y: 3 }); // still valid
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    expect(hasRedWall(shell)).toBe(true);
    shell.up({ x: 2, y: 2 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 6, y: 3.5 });
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.state.undo.past).toHaveLength(entries);
  });
});

describe("demo step 6, recovered (spec §5.7)", () => {
  it("dragging back from red to a valid spot commits the valid position", () => {
    const shell = throughStep5();
    const corner = jointAt(shell.doc(), { x: 6, y: 3.5 });
    const entries = shell.state.undo.past.length;
    shell.moveTo({ x: 6, y: 3.5 });
    shell.down({ x: 6, y: 3.5 });
    shell.moveTo({ x: 2, y: 2 }); // across the divider: red
    shell.moveTo({ x: 4, y: 3 }); // back inside the right room
    expect(hasRedWall(shell)).toBe(false);
    shell.up({ x: 4, y: 3 });
    expect(pointOf(shell.doc(), corner)).toEqual({ x: 4, y: 3 });
    expect(shell.state.undo.past).toHaveLength(entries + 1);
    expect(shell.view().toast).toBeNull();
  });
});
