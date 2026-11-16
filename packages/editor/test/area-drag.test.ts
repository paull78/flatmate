import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { REST_TIMER } from "../src/plate";
import { areaTagLayout } from "../src/view/area-tags";
import { handles } from "../src/view/handles";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Moving and resizing a named area (areas step 07, areas.07, .29, AC-06, AC-07): in the Select tool, a press on the
// selected area drags it with a deck's snapping, a side grip resizes it to at least 0.30 m; refusals red with the reason.
// roomDoc: wall faces x 0.1–5.9, y 0.1–3.9.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const KITCHEN: Command = { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 2, d: 2, name: "Kitchen" }; // x 1–3, y 1–3
const LIVING: Command = { type: "addArea", opId: "l", at: { x: 4.5, y: 2 }, w: 1.5, d: 2, name: "Living" }; // x 3.75–5.25
const ID = "k/a0";
const kitchen = (shell: FakeShell) => shell.doc().areas[ID];

function selected(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.state = { ...shell.state, selection: [{ table: "areas", id: ID }] };
  return shell;
}
function drag(shell: FakeShell, from: Point, to: Point, ctrl = false): void {
  shell.moveTo(from, { ctrl });
  shell.down(from, { ctrl });
  shell.moveTo({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { ctrl });
  shell.moveTo(to, { ctrl });
  shell.up(to, { ctrl });
}
const grip = (shell: FakeShell, side: string): Point => {
  const h = handles(shell.state, shell.doc()).find((x) => x.kind === "areaSide" && x.side === side);
  if (!h) throw new Error(`no ${side} grip`);
  return h.at;
};

describe("moving an area (AC-06)", () => {
  it("dragging the selected area moves it; one undo returns it", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    drag(shell, { x: 1.5, y: 1.5 }, { x: 2, y: 1.5 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2.5, y: 2 });
    shell.key("z", { meta: true });
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
  });

  it("a press inside an area not selected doesn't move it", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    drag(shell, { x: 1.5, y: 1.5 }, { x: 2, y: 1.5 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
  });

  it("a press on a sofa inside the selected area drags the sofa", () => {
    const shell = selected(run(roomDoc(), KITCHEN, { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 2, y: 2 }, deck: null }));
    const before = shell.doc().placements["sofa/p0"]?.at;
    drag(shell, { x: 2, y: 1.8 }, { x: 2.3, y: 1.8 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
    expect(shell.doc().placements["sofa/p0"]?.at).not.toEqual(before);
  });

  it("a side near a wall face lands on it, and near another area's side too", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    drag(shell, { x: 1.5, y: 1.5 }, { x: 0.62, y: 1.5 }); // left side to 0.12, near the face at 0.1
    expect((kitchen(shell)?.at.x ?? 0) - 1).toBeCloseTo(0.1, 9);
    const two = selected(run(roomDoc(), KITCHEN, LIVING));
    drag(two, { x: 1.5, y: 1.5 }, { x: 2.23, y: 1.5 }); // right side to 3.73, near Living's left at 3.75
    expect((kitchen(two)?.at.x ?? 0) + 1).toBeCloseTo(3.75, 9);
  });

  it("moving it into another area previews red with Overlaps Living, and a release leaves it where it was (AC-07)", () => {
    const shell = selected(run(roomDoc(), KITCHEN, LIVING));
    shell.moveTo({ x: 1.5, y: 1.5 }, { ctrl: true });
    shell.down({ x: 1.5, y: 1.5 }, { ctrl: true });
    shell.moveTo({ x: 2.5, y: 1.5 }, { ctrl: true });
    shell.moveTo({ x: 3, y: 1.5 }, { ctrl: true });
    shell.fireTimer(REST_TIMER);
    expect(shell.state.plate?.text).toBe("Overlaps Living");
    shell.up({ x: 3, y: 1.5 }, { ctrl: true });
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
  });

  it("moving its centre out of every room is refused (AC-07)", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    drag(shell, { x: 1.5, y: 1.5 }, { x: 6, y: 1.5 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
  });

  it("a press on its tag drags it once selected", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    const tag = areaTagLayout(shell.doc(), ID, shell.state.camera, "s0");
    const at = tag ? { x: (tag.min.x + tag.max.x) / 2, y: (tag.min.y + tag.max.y) / 2 } : { x: 0, y: 0 };
    drag(shell, at, { x: at.x, y: at.y + 0.5 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2.5 });
  });
});

describe("resizing an area (AC-06)", () => {
  it("a side grip moves that side with the opposite one fixed", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    drag(shell, grip(shell, "right"), { x: 3.5, y: 2 }, true);
    expect(kitchen(shell)).toMatchObject({ at: { x: 2.25, y: 2 }, w: 2.5, d: 2 });
    drag(shell, grip(shell, "back"), { x: 2.25, y: 3.4 }, true);
    expect(kitchen(shell)).toMatchObject({ at: { x: 2.25, y: 2.2 }, w: 2.5, d: 2.4 });
  });

  it("never under 0.30 m", () => {
    const shell = selected(run(roomDoc(), KITCHEN));
    drag(shell, grip(shell, "right"), { x: 0, y: 2 }, true);
    expect(kitchen(shell)?.w).toBeCloseTo(0.3, 9);
  });

  it("the Zone tool shows no grips, and a drag from the selected area draws (red, refused)", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    shell.key("z");
    shell.click({ x: 1.5, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "areas", id: ID }]);
    expect(handles(shell.state, shell.doc()).filter((h) => h.kind === "areaSide")).toEqual([]);
    drag(shell, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 }, true);
    expect(kitchen(shell)?.at).toEqual({ x: 2, y: 2 });
    expect(Object.keys(shell.doc().areas)).toEqual([ID]);
  });
});
