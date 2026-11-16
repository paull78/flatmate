import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { GESTURE_CANCELLED } from "../src/gestures";
import { WHOLE_GRIP_PX } from "../src/tools/section-edit";
import { COLORS } from "../src/view/colors";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { handles, type Handle } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// A selected section's grips (spec "Editing", "Depth", AC-04, AC-05's grip). roomDoc is a 6 x 4 room.
//
//                   ▪ far     a whole depth's grip sits a fixed distance off the line; a set depth's on its far line
//                   ▲ side 1 looks up, the left of a → b
//   ●  ▬▬▬ ─ ─ ─ ─ ─ ─ ▬▬▬  ●
//     (1,2)            (5,2)

const P = (x: number, y: number): Point => ({ x, y });
const add = (a: Point, b: Point, side: 1 | -1 = 1, depth: number | null = null): Command => ({ type: "addSection", a, b, side, depth });
const LINE = add(P(1, 2), P(5, 2));
const SELECTED = [{ table: "sections", id: "A" }];

const row = (shell: FakeShell) => shell.doc().sections["A"];
const past = (shell: FakeShell): number => shell.state.undo.past.length;
const grips = (shell: FakeShell): Handle[] => handles(shell.state, shell.doc());
const far = (shell: FakeShell): Point => {
  const grip = grips(shell).find((h) => h.kind === "sectionFar");
  if (!grip) throw new Error("no far grip");
  return grip.at;
};
const layer = (shell: FakeShell, name: string): readonly Primitive[] => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];
const bands = (shell: FakeShell): Primitive[] => layer(shell, "marks").filter((p) => p.kind === "polygon" && p.color === COLORS.sectionBand);
const red = (shell: FakeShell): Primitive[] => layer(shell, "overlays").filter((p) => p.kind === "segment" && p.color === COLORS.invalid);

function selected(doc: Document = withCommands(roomDoc(), LINE)): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(P(3, 2));
  expect(shell.state.selection).toEqual(SELECTED);
  return shell;
}
const withDepth = (depth: number | null, side: 1 | -1 = 1): Document => withCommands(roomDoc(), add(P(1, 2), P(5, 2), side, depth));

describe("the grips", () => {
  it("show on each end and the far line, only for the selected section in the idle Select tool", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE, add(P(1, 3), P(5, 3))));
    expect(grips(shell)).toEqual([]);
    shell.click(P(3, 2));
    expect(grips(shell).map((h) => h.kind)).toEqual(["sectionEnd", "sectionEnd", "sectionFar"]);
    expect(grips(shell).slice(0, 2).map((h) => h.at)).toEqual([P(1, 2), P(5, 2)]);
    shell.key("w"); // the Wall tool
    expect(shell.state.tool.name).toBe("wall");
    expect(grips(shell)).toEqual([]);
  });

  it("are gone while one is dragged", () => {
    const shell = selected();
    shell.down(P(5, 2));
    expect(grips(shell)).toHaveLength(3); // pressing, as a deck's
    shell.moveTo(P(5, 3));
    expect(grips(shell)).toEqual([]);
  });

  it("draw over the marks: a disc on each end and a square on the far line", () => {
    const shell = selected(withDepth(1));
    const prims = layer(shell, "overlays");
    const discs = prims.flatMap((p) => (p.kind === "disc" ? [p.center] : []));
    expect(discs.filter((c) => c.x === 1 && c.y === 2)).toHaveLength(2);
    expect(discs.filter((c) => c.x === 5 && c.y === 2)).toHaveLength(2);
    const squares = prims.flatMap((p) => (p.kind === "polygon" && p.points.length === 4 ? [p.points] : []));
    expect(squares).toHaveLength(2); // a square over a square
    const [outer] = squares;
    const centre = outer ? outer.reduce((s, q) => ({ x: s.x + q.x / 4, y: s.y + q.y / 4 }), P(0, 0)) : P(0, 0);
    expect(Math.abs(centre.x - 3)).toBeLessThan(1e-9);
    expect(Math.abs(centre.y - 3)).toBeLessThan(1e-9);
  });

  it("the far grip sits on the far line's middle, on the seen side", () => {
    expect(far(selected(withDepth(1.5)))).toEqual(P(3, 3.5));
    expect(far(selected(withDepth(1.5, -1)))).toEqual(P(3, 0.5));
  });

  it("with Zero it sits on the cut line, and a click there keeps the section selected", () => {
    const shell = selected(withDepth(0));
    expect(far(shell)).toEqual(P(3, 2));
    shell.click(P(3, 2));
    expect(shell.state.selection).toEqual(SELECTED);
    expect(row(shell)?.depth).toBe(0);
  });
});

describe("dragging an end", () => {
  it("moves that end only, in one undo step", () => {
    const shell = selected(withCommands(roomDoc(), add(P(1, 2), P(5, 2), -1, 1.5)));
    const before = past(shell);
    shell.drag(P(5, 2), P(4.5, 3), { ctrl: true });
    expect(row(shell)).toEqual({ id: "A", a: P(1, 2), b: P(4.5, 3), side: -1, depth: 1.5 });
    expect(shell.state.selection).toEqual(SELECTED);
    expect(past(shell)).toBe(before + 1);
    shell.key("z", { ctrl: true });
    expect(row(shell)?.b).toEqual(P(5, 2));
    expect(past(shell)).toBe(before);
  });

  it("moves a, leaving b", () => {
    const shell = selected();
    shell.drag(P(1, 2), P(1.5, 1), { ctrl: true });
    expect(row(shell)).toMatchObject({ a: P(1.5, 1), b: P(5, 2) });
  });

  it("previews on the plan as it goes, and Esc leaves the row", () => {
    const shell = selected();
    const before = past(shell);
    shell.down(P(5, 2));
    shell.moveTo(P(4.5, 3));
    const letters = layer(shell, "marks").flatMap((p) => (p.kind === "text" ? [p.at] : []));
    expect(letters).toHaveLength(2);
    expect(letters[1]?.x).toBeLessThan(5); // past the moved end, near (4.5, 3)
    expect(row(shell)?.b).toEqual(P(5, 2));
    shell.key("Escape");
    shell.up(P(4.5, 3));
    expect(row(shell)?.b).toEqual(P(5, 2));
    expect(past(shell)).toBe(before);
  });

  it("snaps as the tool does: to a room's corner, to an angle from the other end, and with Ctrl not at all", () => {
    const shell = selected();
    shell.drag(P(5, 2), P(5.86, 3.86)); // the inner corner of the 0.20 m walls, (5.9, 3.9)
    expect(row(shell)?.b).toEqual(P(5.9, 3.9));
    const angled = selected();
    angled.drag(P(5, 2), P(4.5, 3));
    const b = angled.doc().sections["A"]?.b ?? P(0, 0);
    expect(Math.abs(Math.atan2(b.y - 2, b.x - 1) * 180 / Math.PI - 15)).toBeLessThan(0.05);
    const free = selected();
    free.drag(P(5, 2), P(4.513, 3.127), { ctrl: true });
    expect(free.doc().sections["A"]?.b).toEqual(P(4.513, 3.127));
  });

  it("with Shift keeps the line on an axis from the other end", () => {
    const shell = selected();
    shell.drag(P(5, 2), P(4.6, 2.4), { shift: true });
    expect(row(shell)?.b).toEqual(P(4.6, 2));
  });

  it("wins over a mark under it", () => {
    const shell = selected(withCommands(roomDoc(), LINE, add(P(5, 1), P(5, 3))));
    shell.drag(P(5, 2), P(4.5, 3), { ctrl: true });
    expect(row(shell)?.b).toEqual(P(4.5, 3));
    expect(shell.doc().sections["B"]?.a).toEqual(P(5, 1));
  });
});

describe("dragging an end to under 0.50 m", () => {
  const SHORT = P(1.3, 2);

  it("shows the refusal while dragging and keeps the last valid line", () => {
    const shell = selected();
    shell.down(P(5, 2));
    shell.moveTo(P(4, 2));
    shell.moveTo(SHORT, { ctrl: true });
    const tool = shell.state.tool;
    expect(tool.name === "select" && tool.state.kind === "moving" && tool.state.attempt.ok).toBe(false);
    const lines = red(shell);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ a: P(1, 2), b: SHORT }); // from the end that stays to the refused place
    expect(layer(shell, "marks").flatMap((p) => (p.kind === "text" ? [p.at.x] : []))[1]).toBeGreaterThan(3.9); // still the last valid line
    shell.up(SHORT);
    expect(row(shell)?.b).toEqual(P(5, 2));
  });

  it("the refused line's from the other end when a moves", () => {
    const shell = selected();
    shell.down(P(1, 2));
    shell.moveTo(P(4.7, 2), { ctrl: true });
    expect(red(shell)[0]).toMatchObject({ a: P(5, 2), b: P(4.7, 2) });
  });

  it("reverts on release: says why, no edit, and no undo step", () => {
    const shell = selected();
    const before = past(shell);
    const doc = shell.doc();
    shell.drag(P(5, 2), SHORT);
    expect(shell.doc()).toBe(doc);
    expect(past(shell)).toBe(before);
    expect(shell.state.plate?.text).toBe("A section's line must be at least 0.50 m"); // at the pointer
    expect(shell.state.selection).toEqual(SELECTED);
    expect(red(shell)).toEqual([]);
  });

  it("exactly 0.50 m is taken", () => {
    const shell = selected();
    shell.drag(P(5, 2), P(1.5, 2), { ctrl: true });
    expect(row(shell)?.b).toEqual(P(1.5, 2));
  });
});

describe("dragging the far line", () => {
  it("sets depth from the cut line, on the grid, in one undo step", () => {
    const shell = selected(withDepth(1));
    const before = past(shell);
    shell.drag(P(3, 3), P(3.7, 3.57)); // 1.57 across, 0.7 along, which doesn't count; the 0.20 m grid at this zoom
    expect(row(shell)).toEqual({ id: "A", a: P(1, 2), b: P(5, 2), side: 1, depth: 1.6 });
    expect(past(shell)).toBe(before + 1);
    expect(far(shell)).toEqual(P(3, 3.6));
    shell.key("z", { ctrl: true });
    expect(row(shell)?.depth).toBe(1);
  });

  it("measures on the seen side when flipped", () => {
    const shell = selected(withDepth(1, -1));
    shell.drag(P(3, 1), P(3, 0.4));
    expect(row(shell)?.depth).toBe(1.6);
  });

  it("on a slanted line measures across it", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), add(P(1, 1), P(4, 3), 1, 0.5)));
    shell.click(P(2.5, 2));
    expect(shell.state.selection).toEqual(SELECTED);
    const at = far(shell);
    const u = { x: 3 / Math.hypot(3, 2), y: 2 / Math.hypot(3, 2) };
    const n = { x: -u.y, y: u.x };
    // 0.5 m further across, and 0.3 m along the line, which doesn't count
    const to = P(at.x + 0.5 * n.x + 0.3 * u.x, at.y + 0.5 * n.y + 0.3 * u.y);
    shell.drag(at, to, { ctrl: true });
    expect(Math.abs((row(shell)?.depth ?? 0) - 1)).toBeLessThanOrEqual(1e-3);
  });

  it("with Ctrl keeps the millimetre", () => {
    const shell = selected(withDepth(1));
    shell.drag(P(3, 3), P(3, 3.237), { ctrl: true });
    expect(row(shell)?.depth).toBe(1.237);
  });

  it("past the cut line stops at Zero", () => {
    const shell = selected(withDepth(1));
    shell.drag(P(3, 3), P(3, 1));
    expect(row(shell)?.depth).toBe(0);
    expect(shell.view().toast).toBeNull();
  });

  it("from Zero, off the line, sets a depth", () => {
    const shell = selected(withDepth(0));
    shell.drag(P(3, 2), P(3, 3));
    expect(row(shell)?.depth).toBe(1);
  });

  it("shows the band at the dragged depth as it goes", () => {
    const shell = selected(withDepth(1));
    shell.down(P(3, 3));
    shell.moveTo(P(3, 3.6));
    expect(bands(shell)[0]).toMatchObject({ points: [P(1, 2), P(5, 2), P(5, 3.6), P(1, 3.6)] });
    expect(row(shell)?.depth).toBe(1);
    shell.up(P(3, 3.6));
    expect(row(shell)?.depth).toBe(1.6);
    expect(bands(shell)[0]).toMatchObject({ points: [P(1, 2), P(5, 2), P(5, 3.6), P(1, 3.6)] });
  });
});

describe("a grip and a typed value", () => {
  it("store the same field", () => {
    const dragged = selected(withDepth(1));
    dragged.drag(P(3, 3), P(3, 3.6));
    const typed = selected(withDepth(1));
    typed.ui({ type: "setField", fieldId: "depth", value: "1.6" });
    expect(row(dragged)).toEqual(row(typed));
    expect(row(dragged)?.depth).toBe(1.6);
  });

  it("Properties reads what the grip set, and a typed value moves the grip", () => {
    const shell = selected(withDepth(1));
    shell.drag(P(3, 3), P(3, 3.6));
    const p = shell.view().properties;
    expect("fields" in p ? p.fields.find((f) => f.id === "depth")?.value : null).toBe("1.60");
    shell.ui({ type: "setField", fieldId: "depth", value: "2" });
    expect(far(shell)).toEqual(P(3, 4));
  });
});

describe("the far line doesn't show with whole depth", () => {
  it("a small grip sits a fixed distance off the line on the seen side, in pixels", () => {
    const shell = selected();
    const zoom = shell.state.camera.zoom;
    expect(far(shell)).toEqual(P(3, 2 + WHOLE_GRIP_PX / zoom));
    expect(bands(shell)).toEqual([]);
    const flipped = selected(withDepth(null, -1));
    expect(far(flipped)).toEqual(P(3, 2 - WHOLE_GRIP_PX / zoom));
    shell.wheel(0, -200, { ctrl: true });
    expect(shell.state.camera.zoom).not.toBe(zoom);
    const offset = far(shell).y - 2;
    expect(Math.abs(offset * shell.state.camera.zoom - WHOLE_GRIP_PX)).toBeLessThan(1e-6);
  });

  it("dragging from it sets a depth, and the band shows", () => {
    const shell = selected();
    const before = past(shell);
    shell.drag(far(shell), P(3, 3.6));
    expect(row(shell)?.depth).toBe(1.6);
    expect(past(shell)).toBe(before + 1);
    expect(bands(shell)).toHaveLength(1);
    shell.key("z", { ctrl: true });
    expect(row(shell)?.depth).toBeNull();
  });

  it("a click on it changes nothing", () => {
    const shell = selected();
    const doc = shell.doc();
    shell.click(far(shell));
    expect(shell.doc()).toBe(doc);
    expect(shell.state.selection).toEqual(SELECTED);
  });
});

describe("a level switch", () => {
  it.each([
    ["a press", false],
    ["a drag", true],
  ])("during %s on a grip drops it, keeps the selection, and edits nothing", (_, moved) => {
    const shell = selected(withCommands(roomDoc(), LINE, { type: "addDeck", opId: "m", preset: "loft", at: P(1.2, 3) }));
    const doc = shell.doc();
    shell.down(P(5, 2));
    if (moved) shell.moveTo(P(4.5, 1));
    shell.ui({ type: "setViewedLevel", deck: "m/k0" });
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(shell.state.selection).toEqual(SELECTED);
    shell.up(P(4.5, 1));
    expect(shell.doc()).toBe(doc);
  });
});

describe("the cursor", () => {
  it("over an end moves, over the far grip resizes across the line, and keeps it during the drag", () => {
    const shell = selected(withDepth(1));
    shell.moveTo(P(5, 2));
    expect(shell.view().cursor).toBe("move");
    shell.down(P(5, 2));
    shell.moveTo(P(4.5, 3));
    expect(shell.view().cursor).toBe("move");
    shell.key("Escape");
    shell.up(P(4.5, 3));
    shell.moveTo(P(3, 3));
    expect(shell.view().cursor).toBe("ns-resize");
    shell.down(P(3, 3));
    shell.moveTo(P(3, 3.5));
    expect(shell.view().cursor).toBe("ns-resize");
  });

  it("follows a line that isn't level", () => {
    const shell = selected(withCommands(roomDoc(), add(P(3, 0.5), P(3, 3.5), 1, 1)));
    shell.moveTo(far(shell));
    expect(shell.view().cursor).toBe("ew-resize");
  });
});

describe("shared", () => {
  const open = (): FakeRemote => {
    const r = FakeRemote.open(withCommands(roomDoc(), LINE, add(P(1, 3), P(5, 3))));
    r.shell.click(P(3, 2));
    expect(r.shell.state.selection).toEqual(SELECTED);
    return r;
  };

  it("a dragged end reaches the other client in one edit", () => {
    const r = open();
    r.shell.drag(P(5, 2), P(4.5, 1), { ctrl: true });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.doc.sections["A"]?.b).toEqual(P(4.5, 1));
    expect(r.doc.sections["A"]?.a).toEqual(P(1, 2));
  });

  it("a dragged far line reaches the other client", () => {
    const r = open();
    r.shell.drag(far(r.shell), P(3, 2.6));
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.doc.sections["A"]?.depth).toBe(0.6);
  });

  it.each([
    ["an end", P(5, 2), P(4.5, 1)],
    ["the far line", P(3, 2 + WHOLE_GRIP_PX / 80), P(3, 2.6)],
  ])("a remote delete during a drag of %s ends it with no edit", (_, from, to) => {
    const r = open();
    expect(r.shell.state.camera.zoom).toBe(80);
    r.shell.down(from);
    r.shell.moveTo(to);
    const tool = r.shell.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    r.remote({ type: "deleteEntities", ids: [{ table: "sections", id: "A" }] });
    expect(r.shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
    expect(r.doc.sections["A"]).toBeUndefined();
    expect(r.shell.state.selection).toEqual([]);
    expect(r.shell.doc().sections["A"]).toBeUndefined();
  });

  it("a remote edit of the same row ends the drag too", () => {
    const r = open();
    r.shell.down(P(5, 2));
    r.shell.moveTo(P(4.5, 1));
    r.remote({ type: "setSection", sectionId: "A", side: -1 });
    expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
    r.shell.up(P(4.5, 1));
    expect(r.submits()).toEqual([]);
    expect(r.doc.sections["A"]?.b).toEqual(P(5, 2));
  });

  it("a remote edit of another row leaves the drag going, and it lands", () => {
    const r = open();
    r.shell.down(P(5, 2));
    r.shell.moveTo(P(4.5, 1), { ctrl: true });
    r.remote({ type: "setSection", sectionId: "B", side: -1 });
    const tool = r.shell.state.tool;
    expect(tool.name === "select" && tool.state.kind).toBe("moving");
    r.shell.up(P(4.5, 1), { ctrl: true });
    expect(r.submits()).toHaveLength(1);
    r.accept();
    expect(r.doc.sections["A"]?.b).toEqual(P(4.5, 1));
    expect(r.doc.sections["B"]?.side).toBe(-1);
  });
});

describe("clicking a selected section's arrow flips it", () => {
  const arrowAt = (shell: FakeShell, end: Point, side: 1 | -1 = 1): Point => {
    const { stem, head } = CANVAS_STYLE.mark;
    return { x: end.x, y: end.y + (side * (stem + head - 2)) / shell.state.camera.zoom };
  };

  it("in one undo step, on either arrow, and again flips it back", () => {
    const shell = selected();
    const before = past(shell);
    shell.click(arrowAt(shell, P(1, 2)));
    expect(row(shell)?.side).toBe(-1);
    expect(past(shell)).toBe(before + 1);
    expect(shell.state.selection).toEqual(SELECTED);
    shell.click(arrowAt(shell, P(5, 2), -1)); // the arrows now point down
    expect(row(shell)?.side).toBe(1);
    shell.key("z", { meta: true });
    expect(row(shell)?.side).toBe(-1);
  });

  it("an unselected section's arrow only selects it", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), LINE));
    shell.click(arrowAt(shell, P(1, 2)));
    expect(shell.state.selection).toEqual(SELECTED);
    expect(row(shell)?.side).toBe(1);
  });

  it("the line of a selected section doesn't flip it", () => {
    const shell = selected();
    shell.click(P(2, 2));
    expect(row(shell)?.side).toBe(1);
    expect(shell.state.selection).toEqual(SELECTED);
  });

  it("a press dragged off the arrow doesn't flip it", () => {
    const shell = selected();
    const at = arrowAt(shell, P(1, 2));
    shell.moveTo(at);
    shell.down(at);
    shell.moveTo(P(at.x + 1, at.y));
    shell.up(P(at.x + 1, at.y));
    expect(row(shell)?.side).toBe(1);
  });

  it("the end grip beside it still drags the end", () => {
    const shell = selected();
    shell.moveTo(P(1, 2));
    shell.down(P(1, 2));
    shell.moveTo(P(0.4, 2));
    shell.up(P(0.4, 2));
    expect(row(shell)?.a).toEqual(P(0.4, 2));
    expect(row(shell)?.side).toBe(1);
  });

  it("flips as the section is at the release: a remote flip during the press isn't undone", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), LINE));
    r.shell.click(P(3, 2));
    const at = arrowAt(r.shell, P(1, 2));
    r.shell.moveTo(at);
    r.shell.down(at);
    r.remote({ type: "setSection", sectionId: "A", side: -1 });
    r.shell.up(at);
    expect(r.shell.doc().sections["A"]?.side).toBe(1);
  });
});

describe("at an upper level", () => {
  const atLoft = (): FakeShell => {
    const shell = selected(withCommands(roomDoc(), LINE, { type: "addDeck", opId: "m", preset: "loft", at: P(1.2, 3) }));
    shell.ui({ type: "setViewedLevel", deck: "m/k0" });
    return shell;
  };

  it("its grips show and drag", () => {
    const shell = atLoft();
    expect(grips(shell).map((h) => h.kind)).toEqual(["sectionEnd", "sectionEnd", "sectionFar"]);
    shell.moveTo(P(5, 2));
    shell.down(P(5, 2));
    shell.moveTo(P(5.4, 2));
    shell.up(P(5.4, 2));
    expect(row(shell)?.b).toEqual(P(5.4, 2));
  });

  it("its arrow's click flips it", () => {
    const shell = atLoft();
    const { stem, head } = CANVAS_STYLE.mark;
    shell.click({ x: 5, y: 2 + (stem + head - 2) / shell.state.camera.zoom });
    expect(row(shell)?.side).toBe(-1);
  });
});
