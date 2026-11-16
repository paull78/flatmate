import { describe, expect, it } from "vitest";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// roomDoc (6 × 4 m, inner faces x 0.1/5.9, y 0.1/3.9) with 1.2 × 0.6 desks in Layout (s0): `at` is the middle of the
// back edge, so each desk spans y 1.2–1.8 with its centre on (x, 1.5).
const desks = (...xs: number[]) =>
  withCommands(
    roomDoc(),
    ...xs.map((x, i) => ({ type: "placeObject", deck: null, opId: `d${i + 1}`, state: "s0", object: { kind: "desk" }, at: { x, y: 1.8 } }) as const),
  );

/** Both desks selected, by a click and a Shift-click. */
function selectBoth(): FakeShell {
  const shell = FakeShell.withDocument(desks(1.5, 4.5));
  shell.click({ x: 1.5, y: 1.5 });
  shell.click({ x: 4.5, y: 1.5 }, { shift: true });
  return shell;
}

describe("Properties' Delete for a furniture group (direct.08, AC-09)", () => {
  it("ui deleteSelection removes every selected desk in one changeset and one undo step", () => {
    const shell = selectBoth();
    expect(shell.view().properties).toEqual({ kind: "group", count: 2 });
    const before = shell.doc();
    shell.ui({ type: "deleteSelection" });
    expect(Object.keys(shell.doc().placements)).toEqual([]);
    expect(Object.keys(shell.doc().objects)).toEqual([]);
    expect(shell.state.undo.past).toHaveLength(1);
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().properties.kind).toBe("none");
    shell.key("z", { meta: true });
    expect(shell.doc()).toEqual(before);
  });

  it("ui deleteSelection with one desk selected removes only that desk", () => {
    const shell = FakeShell.withDocument(desks(1.5, 4.5));
    shell.click({ x: 1.5, y: 1.5 });
    shell.ui({ type: "deleteSelection" });
    const left = Object.values(shell.doc().placements);
    expect(left).toHaveLength(1);
    expect(left[0]?.at).toEqual({ x: 4.5, y: 1.8 });
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("ui deleteSelection with nothing selected changes nothing", () => {
    const shell = FakeShell.withDocument(desks(1.5, 4.5));
    const before = shell.doc();
    shell.ui({ type: "deleteSelection" });
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBeNull();
  });
});
