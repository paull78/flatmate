import { describe, expect, it } from "vitest";
import { MESSAGES, execute, unwrap } from "@fm/domain";
import { createLocalDocument } from "../src/document/local-document";
import { COLORS } from "../src/view/colors";
import { helperLabelAt } from "../src/view/helper";
import { jointAt, pointOf, roomDoc, wallBetween } from "./builders";
import { FakeShell } from "./fake-shell";

/** Selects the right wall of the demo room (a = (6, 0)) and clicks its helper. */
function editRightWall() {
  const shell = FakeShell.withDocument(roomDoc());
  const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
  shell.click({ x: 6, y: 1 });
  const at = helperLabelAt(shell.doc(), right, shell.state.camera);
  if (!at) throw new Error("no helper");
  shell.click(at);
  return { shell, right };
}

function selectState(shell: FakeShell) {
  const t = shell.state.tool;
  if (t.name !== "select") throw new Error(`active tool is ${t.name}`);
  return t.state;
}

const helperTexts = (shell: FakeShell) =>
  (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).flatMap((p) =>
    p.kind === "text" && p.color === COLORS.helper ? [p.text] : [],
  );

describe("helper dimension editing (spec §5.6, F5)", () => {
  it("a click on the helper starts editing the length", () => {
    const { shell, right } = editRightWall();
    expect(selectState(shell)).toEqual({ kind: "editingHelper", wallId: right, value: "" });
    expect(shell.view().commandBar).toEqual({ prompt: "Wall length", value: "", unit: "m" });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("Enter resizes the wall from its fixed a end; connected walls follow", () => {
    const { shell, right } = editRightWall();
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.type("3.5");
    expect(shell.view().commandBar.value).toBe("3.5");
    shell.key("Enter");
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 3.5 });
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    wallBetween(shell.doc(), { x: 6, y: 3.5 }, { x: 0, y: 4 }); // the top wall kept its connection and now slopes
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    expect(shell.state.undo.past).toHaveLength(1);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("3.50");
  });

  it("Space applies like Enter", () => {
    const { shell } = editRightWall();
    shell.type("5");
    shell.key(" ");
    jointAt(shell.doc(), { x: 6, y: 5 });
  });

  it("shows the typed value in the helper while editing", () => {
    const { shell } = editRightWall();
    shell.type("35");
    shell.key("Backspace");
    expect(helperTexts(shell)).toEqual(["3"]);
  });

  it("Esc cancels without changing the wall", () => {
    const { shell, right } = editRightWall();
    shell.type("3");
    shell.key("Escape");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("keeps editing after a value that is not a positive number", () => {
    const { shell } = editRightWall();
    shell.type(".");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
    expect(selectState(shell)).toMatchObject({ kind: "editingHelper", value: "." });
  });

  it("shows a domain refusal and ends editing", () => {
    const { shell } = editRightWall();
    shell.type("0.005");
    shell.key("Enter");
    expect(shell.view().toast).toBe(MESSAGES.tooShort);
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("an empty Enter ends editing without a change", () => {
    const { shell } = editRightWall();
    shell.key("Enter");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("Delete deletes nothing while the value field is active", () => {
    const { shell } = editRightWall();
    shell.key("Delete");
    expect(shell.doc()).toEqual(roomDoc());
    expect(selectState(shell).kind).toBe("editingHelper");
  });

  it("ends editing when the wall vanished (in phase 7, a remote delete)", () => {
    const { shell, right } = editRightWall();
    shell.type("3");
    const gone = unwrap(execute(shell.doc(), { type: "deleteEntities", ids: [{ table: "walls", id: right }] })).doc;
    shell.state = { ...shell.state, document: createLocalDocument({ id: "local", name: "Untitled" }, "open1", gone) };
    shell.key("Enter");
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(gone);
    expect(shell.state.toast).toBeNull();
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
