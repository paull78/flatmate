import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap, type Command, type Document } from "@fm/domain";
import { squared } from "../src/snapping/near-square";
import { jointAt, pointOf, roomDoc, wallDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 20 (straight.10, .19): near-square lands square. At 80 px/m the aligned snap already catches anything within
// 10 px (0.125 m) of another joint's line, so these fixtures use walls long enough that 1° is more than that: an 8 m
// wall 0.13 m off is 0.93°, out of the aligned snap's reach and inside near-square's. The snap step is 1 cm.

const wall = (opId: string, from: [number, number], to: [number, number]): Command => ({ type: "addWall", opId, from: { at: { x: from[0], y: from[1] } }, to: { at: { x: to[0], y: to[1] } } });
const docOf = (...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
function fine(doc: Document): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "setSnapStep", step: 0.01 });
  return shell;
}

describe("near-square lands square", () => {
  it("a corner dragged so an 8 m wall lands 0.93° off horizontal puts it exactly horizontal; Ctrl keeps the slant (AC-15)", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 8, y: 0 });
    const plain = fine(doc);
    plain.drag({ x: 8, y: 0 }, { x: 8.4, y: 0.13 });
    expect(pointOf(plain.doc(), jointAt(doc, { x: 8, y: 0 }))).toEqual({ x: 8.4, y: 0 });
    const ctrl = fine(doc);
    ctrl.drag({ x: 8, y: 0 }, { x: 8.4, y: 0.13 }, { ctrl: true });
    expect(pointOf(ctrl.doc(), jointAt(doc, { x: 8, y: 0 }))).toEqual({ x: 8.4, y: 0.13 });
  });

  it("beyond 1° nothing changes: a 4 m wall 0.13 m off (1.9°) keeps its slant", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    const shell = fine(doc);
    shell.drag({ x: 4, y: 0 }, { x: 4.4, y: 0.13 });
    expect(pointOf(shell.doc(), jointAt(doc, { x: 4, y: 0 }))).toEqual({ x: 4.4, y: 0.13 });
  });

  it("drawing from one existing joint to another 0.5° off keeps both joints (an endpoint snap is never changed)", () => {
    const doc = docOf(wall("a", [0, 0], [0, 2]), wall("b", [4, 0.03], [4, 2]));
    const shell = fine(doc);
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.click({ x: 4.01, y: 0.03 }); // within the endpoint tolerance of (4, 0.03)
    expect(Object.keys(shell.doc().joints)).toHaveLength(4);
    expect(Object.keys(shell.doc().walls)).toHaveLength(3);
  });

  it("the Wall tool squares a nearly horizontal second point beyond the angle ray's reach; a typed length follows", () => {
    const shell = fine(emptyDocument());
    shell.key("w");
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 9, y: 1.13 }); // 0.93° off, 0.13 m above the 0° ray: out of its 10 px, inside near-square
    shell.type("5");
    shell.key("Enter");
    const joints = Object.values(shell.doc().joints).map((j) => [j.x, j.y]);
    expect(joints).toContainEqual([6, 1]);
  });

  it("squares against one far end, and leaves an axis alone when two disagree", () => {
    const grid = (x: number, y: number) => ({ point: { x, y }, kind: "grid" as const });
    expect(squared(grid(8.4, 0.13), [{ x: 0, y: 0 }]).point).toEqual({ x: 8.4, y: 0 });
    expect(squared(grid(8.4, 0.13), [{ x: 0, y: 0 }, { x: 0, y: 0.05 }]).point).toEqual({ x: 8.4, y: 0.13 });
    expect(squared({ point: { x: 8.4, y: 0.13 }, kind: "endpoint" }, [{ x: 0, y: 0 }]).point).toEqual({ x: 8.4, y: 0.13 });
  });

  it("a straight-joint slide is not squared: it stays on its line", () => {
    const doc = docOf(wall("a", [0, 0], [3, 0.02]), wall("b", [3, 0.02], [6, 0.04]));
    const shell = fine(doc);
    shell.drag({ x: 3, y: 0.02 }, { x: 3.6, y: 0.02 });
    const p = pointOf(shell.doc(), jointAt(doc, { x: 3, y: 0.02 }));
    expect(Math.abs(p.y - p.x / 150)).toBeLessThanOrEqual(1e-3);
  });

  it("a room's corner dragged far along its top wall stays square against it", () => {
    const shell = fine(roomDoc());
    shell.drag({ x: 6, y: 4 }, { x: 7.6, y: 4.13 }); // the top wall from (0, 4): 7.6 m long, 0.13 off = 0.98°; the right wall tilts freely
    expect(pointOf(shell.doc(), jointAt(roomDoc(), { x: 6, y: 4 }))).toEqual({ x: 7.6, y: 4 });
  });
});
