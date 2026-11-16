import { describe, expect, it } from "vitest";
import { MESSAGES, execute, unwrap } from "@fm/domain";
import { createLocalDocument } from "../src/document/local-document";
import { COLORS } from "../src/view/colors";
import { helperLabelAt } from "../src/view/helper";
import { jointAt, pointOf, roomDoc, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

/** Selects the right wall of the sample room (a = (6, 0)) and clicks its helper. */
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

describe("helper dimension editing (spec: tools, F5)", () => {
  it("a click on the helper starts editing the length", () => {
    const { shell, right } = editRightWall();
    expect(selectState(shell)).toEqual({ kind: "editingHelper", wallId: right, value: "" });
    expect(shell.view().commandBar).toEqual({ prompt: "Wall length", value: "", unit: "m", chips: [] });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
  });

  it("Enter sets the clear length from the fixed a end, as it reads after the move (tidy.45); connected walls follow", () => {
    const { shell, right } = editRightWall();
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.type("3.3");
    expect(shell.view().commandBar.value).toBe("3.3");
    shell.key("Enter");
    // 3.30 + both insets would be 3.50, but the top wall now slopes and moves the inner corner: corrected to 3.492.
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 3.492 });
    expect(helperTexts(shell)).toEqual(["3.30"]);
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    wallBetween(shell.doc(), { x: 6, y: 3.492 }, { x: 0, y: 4 }); // the top wall kept its connection and now slopes
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    expect(shell.state.undo.past).toHaveLength(1);
    const props = shell.view().properties;
    expect(props.kind === "wall" && props.fields[0]?.value).toBe("3.49");
  });

  it("Space is typed into the value and applies nothing", () => {
    const { shell } = editRightWall();
    shell.type("5");
    shell.key(" ");
    expect(selectState(shell)).toMatchObject({ kind: "editingHelper", value: "5 " });
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
    expect(shell.view().toast).toBe("Can't read .");
    expect(selectState(shell)).toMatchObject({ kind: "editingHelper", value: "." });
  });

  it("shows a domain refusal and ends editing", () => {
    // A free wall: its faces run to its joints, so the clear length is the centre length and 0.005 is too short.
    const free = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    const shell = FakeShell.withDocument(free);
    shell.click({ x: 1, y: 0 });
    const at = helperLabelAt(shell.doc(), wallBetween(free, { x: 0, y: 0 }, { x: 4, y: 0 }), shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    expect(helperTexts(shell)).toEqual(["4.00"]);
    shell.type("0.005");
    shell.key("Enter");
    expect(shell.view().toast).toBe(MESSAGES.tooShort);
    expect(selectState(shell)).toEqual({ kind: "idle" });
    expect(shell.doc()).toEqual(free);
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

  it("the total edits the clear length keeping joint a (a wall with a door: the total is the outer row)", () => {
    const doc = withCommands(roomDoc(), { type: "addOpening", opId: "x", wall: wallBetween(roomDoc(), { x: 6, y: 0 }, { x: 6, y: 4 }), kind: "swing", offset: 1.1 });
    const shell = FakeShell.withDocument(doc);
    const right = wallBetween(doc, { x: 6, y: 0 }, { x: 6, y: 4 });
    const top = jointAt(doc, { x: 6, y: 4 });
    shell.click({ x: 6, y: 0.3 });
    const at = helperLabelAt(shell.doc(), right, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    expect(selectState(shell)).toEqual({ kind: "editingHelper", wallId: right, value: "" });
    shell.type("4.3");
    expect(helperTexts(shell)).toContain("4.3");
    expect(helperTexts(shell)).toContain("1.00"); // the chain keeps its own (clear) texts
    shell.key("Enter");
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 4.509 }); // 4.50 corrected for the sloping top wall (tidy.45)
    expect(helperTexts(shell)).toContain("4.30");
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 6, y: 0 }))).toEqual({ x: 6, y: 0 });
    expect(shell.doc().openings["x/d0"]?.offset).toBe(1.1);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("the Wall tool's live length and typed lengths stay the centre line", () => {
    // A wall from the bottom wall's midpoint: its clear length would stop 0.10 short, at the bottom wall's face.
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("w");
    shell.click({ x: 3, y: 0 });
    shell.moveTo({ x: 3, y: -3 });
    const labels = (shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));
    expect(labels.some((t) => t.startsWith("3.00 m"))).toBe(true); // the segment being drawn, not a clear length
    shell.type("2.5");
    shell.key("Enter");
    wallBetween(shell.doc(), { x: 3, y: 0 }, { x: 3, y: -2.5 });
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

describe("wall thickness in Properties (layout-states.27, AC-24)", () => {
  function selectRightWall() {
    const shell = FakeShell.withDocument(roomDoc());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 1 });
    return { shell, right };
  }
  const thicknessField = (shell: FakeShell) => {
    const props = shell.view().properties;
    return props.kind === "wall" ? props.fields.find((f) => f.id === "thickness") : undefined;
  };

  it("typing 0.10 in the thickness field commits setWallThickness and the ViewModel shows 0.10", () => {
    const { shell, right } = selectRightWall();
    expect(thicknessField(shell)).toMatchObject({ value: "0.20", readOnly: false });
    shell.ui({ type: "setField", fieldId: "thickness", value: "0.10" });
    expect(shell.doc().walls[right]?.thickness).toBe(0.1);
    expect(thicknessField(shell)?.value).toBe("0.10");
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([{ table: "walls", id: right }]);
    shell.ui({ type: "undo" });
    expect(shell.doc().walls[right]?.thickness).toBe(0.2);
    expect(thicknessField(shell)?.value).toBe("0.20");
  });

  it("typing 0.70 is refused: the document is unchanged and a toast says \"Wall thickness must be between 0.05 and 0.50 m\"", () => {
    const { shell } = selectRightWall();
    shell.ui({ type: "setField", fieldId: "thickness", value: "0.70" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.view().toast).toBe("Wall thickness must be between 0.05 and 0.50 m");
    expect(shell.view().toast).toBe(MESSAGES.thickness);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("a value that can't be read is refused and changes nothing", () => {
    const { shell } = selectRightWall();
    shell.ui({ type: "setField", fieldId: "thickness", value: "abc" });
    expect(shell.doc()).toEqual(roomDoc());
    expect(shell.view().toast).toBe("Can't read abc");
  });

  it("the length field stays read-only: setField length does nothing", () => {
    const { shell } = selectRightWall();
    shell.ui({ type: "setField", fieldId: "length", value: "3" });
    expect(shell.doc()).toEqual(roomDoc());
  });
});

describe("a second click on the helper being edited (tidy C10b, AC-13)", () => {
  it("keeps the typed value on the total, so Enter applies it", () => {
    const { shell, right } = editRightWall();
    const top = jointAt(shell.doc(), { x: 6, y: 4 });
    shell.type("3.3");
    const at = helperLabelAt(shell.doc(), right, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    expect(selectState(shell)).toEqual({ kind: "editingHelper", wallId: right, value: "3.3" });
    shell.key("Enter");
    expect(pointOf(shell.doc(), top)).toEqual({ x: 6, y: 3.492 });
  });
});

describe("a typed clear length holds after the move (tidy.45, AC-22)", () => {
  /** Types `value` into the length label of the wall a → b of the sample room, then reads its helper back. */
  function typed(a: { x: number; y: number }, b: { x: number; y: number }, value: string) {
    const shell = FakeShell.withDocument(roomDoc());
    const id = wallBetween(shell.doc(), a, b);
    shell.click({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const at = helperLabelAt(shell.doc(), id, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    shell.type(value);
    shell.key("Enter");
    return { shell, id };
  }

  it("5.8 on the right wall leaves its helper at 5.80, though the top wall tilts (it read 5.76)", () => {
    const { shell } = typed({ x: 6, y: 0 }, { x: 6, y: 4 }, "5.8");
    expect(helperTexts(shell)).toEqual(["5.80"]);
  });

  it("3.3 on the right wall leaves 3.30 (it read 3.31)", () => {
    const { shell } = typed({ x: 6, y: 0 }, { x: 6, y: 4 }, "3.3");
    expect(helperTexts(shell)).toEqual(["3.30"]);
  });

  it("5.5 on the bottom wall leaves 5.50: shortening it tilts the right wall (it read 5.51)", () => {
    const { shell } = typed({ x: 0, y: 0 }, { x: 6, y: 0 }, "5.5");
    expect(helperTexts(shell)).toEqual(["5.50"]);
  });

  it("a lone wall, with no neighbour to tilt, gets the length typed in one step", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 }));
    const id = Object.keys(shell.doc().walls)[0] ?? "";
    shell.click({ x: 2, y: 0 });
    const at = helperLabelAt(shell.doc(), id, shell.state.camera);
    if (!at) throw new Error("no helper");
    shell.click(at);
    shell.type("5.8");
    shell.key("Enter");
    expect(pointOf(shell.doc(), jointAt(shell.doc(), { x: 5.8, y: 0 }))).toEqual({ x: 5.8, y: 0 });
    expect(helperTexts(shell)).toEqual(["5.80"]);
  });
});
