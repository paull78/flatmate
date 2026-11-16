import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { UiAction, ViewModel } from "@fm/editor";
import { WarningsPillView } from "../src/panels/WarningsPill";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId, mouseDown } from "./react-tree";

const row = (key: string, text: string, id: string): ViewModel["warnings"]["rows"][number] => ({ key, text, ref: { table: "placements", id } });
const two = viewFixture({ warnings: { rows: [row("a", "Sofa's front is blocked by Coffee table", "s/p0"), row("b", "Desk's front is blocked by a wall", "d/p0")], blink: 0 } });
const one = viewFixture({ warnings: { rows: [row("a", "Sofa's front is blocked by a wall", "s/p0")], blink: 0 } });

/** The hook-free pill, recording what it sends and what it asks of its wrapper. */
function pill(view: ViewModel = two, open = false, blinking = false) {
  const sent: UiAction[] = [];
  const asked: string[] = [];
  const tree = WarningsPillView({
    view,
    send: (a) => sent.push(a),
    open,
    blinking,
    listRef: { current: null },
    triggerRef: { current: null },
    onOpen: (o) => asked.push(o ? "open" : "close"),
    onEscape: () => asked.push("escape"),
  });
  return { tree, sent, asked };
}

/** A keydown that records whether it was stopped from reaching the window's handler. */
function keyEvent(key: string, currentTarget: unknown = null) {
  const seen = { stopped: false, prevented: false };
  return {
    seen,
    event: { key, currentTarget, stopPropagation: () => { seen.stopped = true; }, preventDefault: () => { seen.prevented = true; } },
  };
}

/** Every element of a tree that has a key: `findAll` reads props, and a key isn't one. */
function keyed(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(keyed);
  if (!isValidElement<{ children?: unknown }>(node)) return [];
  return [...(node.key === null ? [] : [node]), ...keyed(node.props.children)];
}

describe("the warnings pill", () => {
  it("is hidden at zero", () => {
    expect(pill(viewFixture({ warnings: { rows: [], blink: 0 } })).tree).toBeNull();
  });

  it("the tick is the key of the background span alone: a key higher up would close the list and drop the focus", () => {
    const view = viewFixture({ warnings: { ...two.warnings, blink: 7 } });
    const closed = keyed(pill(view).tree);
    expect(closed.map((e) => e.key)).toEqual(["7"]);
    expect(closed[0]?.props).toMatchObject({ "aria-hidden": "true", className: "warnings-flash" });
  });

  it("the span blinks only when its wrapper says so", () => {
    const flash = (blinking: boolean) => findAll(pill(two, false, blinking).tree, (p) => p["aria-hidden"] === "true" && String(p.className).includes("warnings-flash"))[0]?.className;
    expect(flash(false)).toBe("warnings-flash");
    expect(flash(true)).toBe("warnings-flash warnings-blink");
  });

  it("counts in words, singular and plural", () => {
    const count = (view: ViewModel) => findByTestId(pill(view).tree, "warnings-button")?.["aria-label"];
    expect(count(one)).toBe("1 warning");
    expect(count(two)).toBe("2 warnings");
  });

  it("the button opens and closes the list", () => {
    const closed = pill(two, false);
    expect(findByTestId(closed.tree, "warnings-list")).toBeNull();
    expect(findByTestId(closed.tree, "warnings-button")?.["aria-expanded"]).toBe(false);
    call(findByTestId(closed.tree, "warnings-button"), "onClick");
    expect(closed.asked).toEqual(["open"]);

    const open = pill(two, true);
    expect(findByTestId(open.tree, "warnings-button")?.["aria-expanded"]).toBe(true);
    call(findByTestId(open.tree, "warnings-button"), "onClick");
    expect(open.asked).toEqual(["close"]);
  });

  it("lists a row per warning, and a row selects its piece and leaves the list open", () => {
    const { tree, sent, asked } = pill(two, true);
    const rows = findAll(tree, (p) => p.role === "menuitem");
    expect(rows.map((r) => r.children)).toEqual(["Sofa's front is blocked by Coffee table", "Desk's front is blocked by a wall"]);
    call(rows[1], "onClick", { currentTarget: { focus: () => {} } });
    expect(sent).toEqual([{ type: "selectEntity", ref: { table: "placements", id: "d/p0" } }]);
    expect(asked).toEqual([]);
  });

  it("Esc closes the list without reaching the window, which would clear the selection", () => {
    const { tree, asked } = pill(two, true);
    const { event, seen } = keyEvent("Escape");
    call(findByTestId(tree, "warnings-list"), "onKeyDown", event);
    expect(seen.stopped).toBe(true);
    expect(asked).toEqual(["escape"]);
  });

  it("the arrows move along the list and never nudge the piece a row just selected", () => {
    const { tree } = pill(two, true);
    const focused: string[] = [];
    const item = (name: string) => ({ focus: () => focused.push(name) });
    const a = item("a");
    const b = item("b");
    const list = { querySelectorAll: () => [a, b], ownerDocument: { activeElement: a } };
    const down = keyEvent("ArrowDown", list);
    call(findByTestId(tree, "warnings-list"), "onKeyDown", down.event);
    expect(down.seen.stopped).toBe(true);
    expect(down.seen.prevented).toBe(true);
    const up = keyEvent("ArrowUp", list);
    call(findByTestId(tree, "warnings-list"), "onKeyDown", up.event);
    expect(focused).toEqual(["b", "b"]); // wraps both ways from the first of two
  });

  it("Enter and Space stay with the focused button: the window's handler would cancel its click", () => {
    const { tree } = pill(two, true);
    for (const key of ["Enter", " "]) {
      const inList = keyEvent(key);
      call(findByTestId(tree, "warnings-list"), "onKeyDown", inList.event);
      expect(inList.seen).toEqual({ stopped: true, prevented: false });
      const onButton = keyEvent(key);
      call(findByTestId(tree, "warnings-button"), "onKeyDown", onButton.event);
      expect(onButton.seen).toEqual({ stopped: true, prevented: false });
    }
  });

  it("other keys go on to the editor: Delete, a tool's letter, Esc on the closed pill", () => {
    const { tree } = pill(two, true);
    for (const key of ["Delete", "v"]) {
      const { event, seen } = keyEvent(key);
      call(findByTestId(tree, "warnings-list"), "onKeyDown", event);
      expect(seen.stopped).toBe(false);
    }
    const esc = keyEvent("Escape");
    call(findByTestId(pill(two, false).tree, "warnings-button"), "onKeyDown", esc.event);
    expect(esc.seen.stopped).toBe(false);
  });

  it("keeps the canvas's focus when pressed", () => {
    const { tree } = pill(two, true);
    const pressed: string[] = [];
    call(findByTestId(tree, "warnings-button"), "onMouseDown", mouseDown(() => pressed.push("button")));
    call(findAll(tree, (p) => p.role === "menuitem")[0], "onMouseDown", mouseDown(() => pressed.push("row")));
    expect(pressed).toEqual(["button", "row"]);
  });
});
