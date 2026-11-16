import { describe, expect, it } from "vitest";
import { unwrap, execute, type Document } from "@fm/domain";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";
import { roomDoc, wallBetween } from "./builders";

// Step 15 (spec M2 "Split"): a selected wall's Split arms a one-shot gesture; a typed value and Enter, or a click, split
// the wall; refusals keep the gesture armed; Esc clears the value, then cancels. The 6 × 4 room's bottom wall W1 runs
// (0, 0) → (6, 0); its room-side face runs x 0.1 .. 5.9. The grid is 0.2 m at 80 px/m.

function armed(doc: Document = roomDoc()): { shell: FakeShell; wall: string } {
  const shell = FakeShell.withDocument(doc);
  const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
  shell.click({ x: 3, y: 0 });
  expect(shell.state.selection).toEqual([{ table: "walls", id: wall }]);
  const props = shell.view().properties;
  expect(props.kind === "wall" && props.split).toBe(true);
  shell.ui({ type: "split" });
  expect(shell.state.tool.name === "select" && shell.state.tool.state.kind).toBe("splitting");
  return { shell, wall };
}

const selectState = (shell: FakeShell) => (shell.state.tool.name === "select" ? shell.state.tool.state : null);

describe("the Split gesture", () => {
  it("Split, type 1.20, Enter: two walls, the joint 1.20 from the room face's start (AC-12)", () => {
    const { shell, wall } = armed();
    shell.moveTo({ x: 2, y: 0 });
    shell.type("1.2");
    expect(shell.view().typing).toBe(true);
    shell.key("Enter");
    expect(Object.keys(shell.doc().walls)).toHaveLength(5);
    const pieces = Object.values(shell.doc().walls).filter((w) => w.id === wall || w.id.endsWith("/w1"));
    expect(pieces).toHaveLength(2);
    const joint = Object.values(shell.doc().joints).find((j) => Math.abs(j.x - 1.3) < 1e-9 && j.y === 0);
    expect(joint).toBeDefined();
    expect(selectState(shell)?.kind).toBe("idle");
    expect(shell.state.selection).toEqual([{ table: "walls", id: wall }]);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a click at the midpoint snaps the tick there (state.snap midpoint) and splits", () => {
    const { shell } = armed();
    shell.moveTo({ x: 3.05, y: 0 }); // 4 px from the face's middle at x 3
    expect(shell.state.snap?.kind).toBe("midpoint");
    shell.down({ x: 3.05, y: 0 });
    shell.up({ x: 3.05, y: 0 });
    expect(Object.values(shell.doc().joints).some((j) => j.x === 3 && j.y === 0)).toBe(true);
    expect(Object.keys(shell.doc().walls)).toHaveLength(5);
  });

  it("a click inside a door is refused at the pointer and the gesture stays armed", () => {
    const doc = unwrap(execute(roomDoc(), { type: "addOpening", opId: "d", wall: wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 1 })).doc;
    const { shell } = armed(doc);
    shell.moveTo({ x: 1.4, y: 0 });
    shell.down({ x: 1.4, y: 0 });
    shell.up({ x: 1.4, y: 0 });
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
    expect(shell.view().toast).toBe("A wall can't be split inside a door");
    expect(shell.state.plate?.text).toBe("A wall can't be split inside a door");
    expect(selectState(shell)?.kind).toBe("splitting");
  });

  it("Esc clears a typed value, then cancels", () => {
    const { shell } = armed();
    shell.moveTo({ x: 2, y: 0 });
    shell.type("1.2");
    shell.key("Escape");
    expect(selectState(shell)).toMatchObject({ kind: "splitting", value: "" });
    shell.key("Escape");
    expect(selectState(shell)?.kind).toBe("idle");
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("a click away from the wall cancels and acts as a normal press", () => {
    const { shell } = armed();
    shell.click({ x: 3, y: 2 }); // the floor
    expect(selectState(shell)?.kind).toBe("idle");
    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
  });

  it("a remote edit of the wall cancels the gesture", () => {
    const remote = FakeRemote.open(roomDoc());
    const shell = remote.shell;
    const wall = wallBetween(roomDoc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wall } });
    shell.ui({ type: "split" });
    expect(selectState(shell)?.kind).toBe("splitting");
    remote.remote({ type: "setWallThickness", wallId: wall, thickness: 0.3 });
    expect(selectState(shell)?.kind).toBe("idle");
    expect(shell.view().toast).toBe("Drawing changed remotely");
  });

  it("the picture shows the tick and the two clear distances", () => {
    const { shell } = armed();
    shell.moveTo({ x: 1.3, y: 0 });
    const texts = (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["1.20", "4.60"]));
  });
});
