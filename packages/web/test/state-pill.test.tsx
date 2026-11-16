import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UiAction } from "@fm/editor";
import { StatePill, StatePillView } from "../src/panels/StatePill";
import { viewFixture } from "./fixtures";
import { call, findAll, findByTestId } from "./react-tree";

const two = viewFixture({ states: [{ id: "s0", name: "Day", active: false }, { id: "n", name: "Night", active: true }] });
const one = viewFixture({ states: [{ id: "s0", name: "Layout", active: true }] });

/** The hook-free pill with its menu open or closed, recording what it sends and what it asks of its wrapper. */
function pill(view = two, menu = false) {
  const sent: UiAction[] = [];
  const asked: string[] = [];
  const tree = StatePillView({
    view,
    send: (a) => sent.push(a),
    menu,
    menuRef: { current: null },
    onMenu: (open) => asked.push(open ? "open" : "close"),
    onRename: () => asked.push("rename"),
  });
  return { tree, sent, asked };
}

describe("StatePill (spec: layouts)", () => {
  it("shows every layout in order with the active one marked, a menu button and a + button", () => {
    const html = renderToStaticMarkup(<StatePill view={two} send={() => {}} />);
    expect(html).toMatch(/data-state-id="s0"[^>]*>Day</);
    expect(html).toContain('data-testid="state-add"');
    expect(html).toContain('data-testid="state-menu-button"');
    expect(html).toContain('aria-label="Layouts"');
    expect(findByTestId(pill().tree, "state-name")?.value).toBe("Night");
  });

  it("sends setActiveState on a click, addState on +, renameState from the active name", () => {
    const { tree, sent } = pill();
    call(findAll(tree, (p) => p["data-state-id"] === "s0")[0], "onClick");
    call(findByTestId(tree, "state-add"), "onClick");
    call(findByTestId(tree, "state-name"), "onCommit", "Sleep");
    expect(sent).toEqual([{ type: "setActiveState", id: "s0" }, { type: "addState" }, { type: "renameState", id: "n", name: "Sleep" }]);
  });

  it("has no one-click delete on the pill: deleting goes through the menu", () => {
    const { tree } = pill();
    expect(findByTestId(tree, "state-delete")).toBeNull();
    expect(findAll(tree, (p) => p.title === "Delete this layout")).toEqual([]);
  });

  it("opens and closes the menu from the menu button, which says whether it is open", () => {
    const closed = pill();
    expect(findByTestId(closed.tree, "state-menu")).toBeNull();
    expect(findByTestId(closed.tree, "state-menu-button")?.["aria-expanded"]).toBe(false);
    call(findByTestId(closed.tree, "state-menu-button"), "onClick");
    expect(closed.asked).toEqual(["open"]);

    const open = pill(two, true);
    expect(findByTestId(open.tree, "state-menu-button")?.["aria-expanded"]).toBe(true);
    call(findByTestId(open.tree, "state-menu-button"), "onClick");
    expect(open.asked).toEqual(["close"]);
  });

  it("menu: Rename asks for the name field, Duplicate sends addState, Delete sends deleteState; each closes it", () => {
    const { tree, sent, asked } = pill(two, true);
    expect(findByTestId(tree, "state-menu")?.role).toBe("menu");
    call(findByTestId(tree, "state-menu-rename"), "onClick");
    call(findByTestId(tree, "state-menu-duplicate"), "onClick");
    const del = findByTestId(tree, "state-menu-delete");
    expect(del?.disabled).toBe(false);
    call(del, "onClick");
    expect(sent).toEqual([{ type: "addState" }, { type: "deleteState", id: "n" }]);
    expect(asked).toEqual(["close", "rename", "close", "close"]);
  });

  it("menu: Delete is disabled with a single layout, and says why", () => {
    const del = findByTestId(pill(one, true).tree, "state-menu-delete");
    expect(del?.disabled).toBe(true);
    expect(del?.title).toBe("A drawing keeps at least one layout");
  });

  it("renders nothing without a drawing", () => {
    expect(renderToStaticMarkup(<StatePill view={viewFixture({ states: [] })} send={() => {}} />)).toBe("");
  });
});
