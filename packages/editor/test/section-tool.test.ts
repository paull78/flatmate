import { COLORS } from "../src/view/colors";
import { describe, expect, it } from "vitest";
import { MESSAGES, SECTION_LETTERS, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { CLASH_TEXT } from "../src/toast-text";
import { CONNECTION_LOST, GESTURE_CANCELLED } from "../src/gestures";
import { CANVAS_STYLE } from "../src/view/plan-style";
import type { Primitive } from "../src/view/scene-types";
import { sectionMark } from "../src/view/section-marks-layer";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The Section tool (spec "Drawing a section", AC-01, AC-02): S, two clicks for the line, a third for the side.
// FakeShell.local() is an empty drawing at zoom 80, here on a 0.1 m snap.
//
//   a ───────► b      side 1 is the left of a → b

const P = (x: number, y: number): Point => ({ x, y });
const ZOOM = 80;

const tool = (shell: FakeShell) => {
  const t = shell.state.tool;
  return t.name === "section" ? t.state : null;
};
const rows = (shell: FakeShell) => shell.doc().sections;
const prompt = (shell: FakeShell): string => shell.view().commandBar.prompt;
const overlays = (shell: FakeShell): readonly Primitive[] => shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const letters = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "text" && p.color !== COLORS.snap ? [p.text] : [])); // not the snap mark's word (straight step 22)
const previewOf = (id: string, a: Point, b: Point, side: 1 | -1): Primitive[] => sectionMark({ id, a, b, side, depth: null }, CANVAS_STYLE, ZOOM, CANVAS_STYLE.mark.selected);
const add = (a: Point, b: Point, side: 1 | -1 = 1): Command => ({ type: "addSection", a, b, side });
const fullDoc = (rowsWanted: number): Document => withCommands(roomDoc(), ...[...SECTION_LETTERS].slice(0, rowsWanted).map((_, i) => add(P(0, i * 0.1), P(1, i * 0.1))));

function armed(doc?: Document): FakeShell {
  const shell = doc ? FakeShell.withDocument(doc) : FakeShell.local();
  shell.key("s");
  shell.ui({ type: "setSnapStep", step: 0.1 });
  return shell;
}

function sectionBy(shell: FakeShell, a: Point, b: Point, side: Point): void {
  shell.click(a);
  shell.click(b);
  shell.click(side);
}

describe("the Section tool", () => {
  it("goes back to Select once drawn, the new section selected", () => {
    const shell = armed();
    sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
    expect(shell.view().activeTool).toBe("select");
    expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
  });

  it("Delete straight after drawing removes the new section", () => {
    const shell = armed();
    sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
    shell.key("Delete");
    expect(rows(shell)).toEqual({});
  });

  it("the next click selects, and draws no second section", () => {
    const shell = armed();
    sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
    shell.click(P(1.5, 2));
    expect(shell.view().activeTool).toBe("select");
    expect(shell.state.selection).toEqual([]);
    expect(Object.keys(rows(shell))).toEqual(["A"]);
  });

  it.each([
    ["looking down, from the tool", P(1, 6), P(3, 6), P(2, 5), -1],
    ["looking up, from the tool", P(1, 6), P(3, 6), P(2, 7), 1],
  ] as const)("a mark clear of the walls selects by its line: %s", (_name, a, b, side, expected) => {
    const shell = armed(roomDoc());
    sectionBy(shell, a, b, side);
    expect(rows(shell)["A"]?.side).toBe(expected);
    shell.key("Escape");
    expect(shell.state.selection).toEqual([]);
    shell.click(P(2, 6));
    expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
  });

  it("S or the toolbar picks it; its prompts and cursor", () => {
    const shell = armed();
    expect(shell.view()).toMatchObject({ activeTool: "section", cursor: "crosshair", toolHelp: { label: "Section", key: "S" } });
    expect(shell.view().tools).toContainEqual({ tool: "section", label: "Section", key: "S" });
    expect(prompt(shell)).toBe("First point");
    shell.click(P(0, 0));
    expect(prompt(shell)).toBe("Second point");
    shell.click(P(3, 0));
    expect(prompt(shell)).toBe("Pick the side to look at");
    const other = FakeShell.local();
    other.ui({ type: "pickTool", tool: "section" });
    expect(other.view().activeTool).toBe("section");
  });

  describe("S, two clicks and a side click make section A with whole depth and that side", () => {
    it.each([
      ["left of a → b", P(0, 0), P(3, 0), P(1.5, 1), 1],
      ["right of a → b", P(0, 0), P(3, 0), P(1.5, -1), -1],
      ["the side follows a → b, not +y: left", P(3, 0), P(0, 0), P(1.5, -1), 1],
      ["the side follows a → b, not +y: right", P(3, 0), P(0, 0), P(1.5, 1), -1],
      ["a diagonal, past its ends: left", P(0, 0), P(2.97, 2.97), P(5, 6), 1], // 2.97: the 45° ray, as snapped
      ["a diagonal, past its ends: right", P(0, 0), P(2.97, 2.97), P(6, 5), -1],
    ] as const)("%s", (_name, a, b, side, expected) => {
      const shell = armed();
      const past = shell.state.undo.past.length;
      sectionBy(shell, a, b, side);
      expect(rows(shell)).toEqual({ A: { id: "A", a, b, side: expected, depth: null } });
      expect(shell.state.undo.past.length).toBe(past + 1);
    });

    it("the side comes from the raw pointer, not the snapped one, and a click on the line looks left", () => {
      const near = (y: number): 1 | -1 | undefined => {
        const shell = armed();
        sectionBy(shell, P(0, 0), P(3, 0), P(1.5, y));
        return rows(shell)["A"]?.side;
      };
      expect(near(-0.04)).toBe(-1); // the snap would put these on the line
      expect(near(0.04)).toBe(1);
      expect(near(0)).toBe(1);
    });

    it("S again draws the next section, which takes the next letter; one undo removes one", () => {
      const shell = armed();
      sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
      shell.key("s");
      expect(tool(shell)).toEqual({ kind: "idle" });
      expect(prompt(shell)).toBe("First point");
      sectionBy(shell, P(0, 2), P(3, 2), P(1.5, 1));
      expect(Object.keys(rows(shell))).toEqual(["A", "B"]);
      expect(rows(shell)["B"]).toMatchObject({ a: P(0, 2), side: -1 });
      shell.key("z", { meta: true });
      expect(Object.keys(rows(shell))).toEqual(["A"]);
    });

    it("the letter is the first free one", () => {
      const doc = withCommands(fullDoc(3), { type: "deleteEntities", ids: [{ table: "sections", id: "B" }] });
      const shell = armed(doc);
      sectionBy(shell, P(1, 1), P(2, 1), P(1.5, 2));
      expect(Object.keys(rows(shell)).sort()).toEqual(["A", "B", "C"]);
      expect(rows(shell)["B"]).toMatchObject({ a: P(1, 1), b: P(2, 1) });
    });

    it("a release does nothing: a drag places only its press", () => {
      const shell = armed();
      shell.drag(P(0, 0), P(2, 0));
      expect(tool(shell)).toEqual({ kind: "second", a: P(0, 0) });
    });
  });

  it("A and B take the Dimension tool's snaps", () => {
    const stages = (key: string, doc: Document): unknown[] => {
      const shell = FakeShell.withDocument(doc);
      shell.key(key);
      shell.click(P(0.13, 0.11)); // near the room's inner corner
      const t = shell.state.tool;
      const a = (t.name === "section" || t.name === "dimension") && t.state.kind === "second" ? t.state.a : null;
      shell.click(P(2.6, 1.55), { shift: false });
      const u = shell.state.tool;
      const b = (u.name === "section" && u.state.kind === "side") || (u.name === "dimension" && u.state.kind === "offset") ? u.state.b : null;
      return [a, b];
    };
    const [a, b] = stages("s", roomDoc());
    expect(a).not.toEqual(P(0.13, 0.11));
    expect(b).not.toEqual(P(2.6, 1.55));
    expect([a, b]).toEqual(stages("m", roomDoc()));
  });

  it("Esc steps back: third to second to first to idle, with nothing stored", () => {
    const shell = armed();
    const past = shell.state.undo.past.length;
    shell.click(P(0, 0));
    shell.click(P(3, 0));
    shell.moveTo(P(2, 1));
    shell.key("Escape");
    expect(tool(shell)).toEqual({ kind: "second", a: P(0, 0) });
    expect(letters(overlays(shell))).toEqual(["A", "A"]); // back to the rubber band, without a move
    expect(shell.view().snap).not.toBeNull();
    shell.key("Escape");
    expect(tool(shell)).toEqual({ kind: "idle" });
    expect(letters(overlays(shell))).toEqual([]);
    expect(shell.view().snap).not.toBeNull();
    expect(shell.view().activeTool).toBe("section");
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
    expect(rows(shell)).toEqual({});
    expect(shell.state.undo.past.length).toBe(past);
  });

  it("a line under 0.50 m is refused with its reason, and the tool stays", () => {
    const shell = armed();
    shell.click(P(1, 1));
    shell.down(P(1.4, 1));
    expect(shell.view().toast).toBe(MESSAGES.sectionLine);
    expect(shell.state.plate?.text).toBe(MESSAGES.sectionLine); // at the pointer too
    shell.up(P(1.4, 1));
    expect(tool(shell)).toEqual({ kind: "second", a: P(1, 1) });
    expect(prompt(shell)).toBe("Second point");
    expect(shell.view().activeTool).toBe("section");
    expect(rows(shell)).toEqual({});
    shell.click(P(1, 1)); // a zero-length line, the same
    expect(tool(shell)).toEqual({ kind: "second", a: P(1, 1) });
    shell.click(P(1.5, 1)); // exactly 0.50 m goes on
    expect(tool(shell)).toMatchObject({ kind: "side", b: P(1.5, 1) });
    shell.click(P(1.2, 2));
    expect(rows(shell)["A"]).toMatchObject({ a: P(1, 1), b: P(1.5, 1), side: 1 });
  });

  describe("after Z", () => {
    it("the second click says every letter is taken, and nothing is stored or previewed", () => {
      const shell = armed(fullDoc(26));
      shell.click(P(1, 1));
      shell.moveTo(P(3, 1));
      expect(letters(overlays(shell))).toEqual([]);
      shell.click(P(3, 1));
      expect(shell.view().toast).toBe(MESSAGES.sectionsFull);
      expect(tool(shell)).toEqual({ kind: "second", a: P(1, 1) });
      expect(Object.keys(rows(shell))).toHaveLength(26);
    });

    it("the last letter going while the side is picked refuses the third click and keeps the line", () => {
      const r = FakeRemote.open(fullDoc(25));
      r.shell.key("s");
      r.shell.click(P(1, 1));
      r.shell.click(P(3, 1));
      r.remote(add(P(0, 5), P(1, 5)));
      r.shell.click(P(2, 2));
      expect(r.shell.view().toast).toBe(MESSAGES.sectionsFull);
      expect(tool(r.shell)).toMatchObject({ kind: "side", a: P(1, 1), b: P(3, 1) });
      expect(r.submits()).toEqual([]);
      expect(r.shell.state.selection).toEqual([]);
    });
  });

  it("the new section is selected, and a later one replaces it", () => {
    const shell = armed();
    sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
    expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
    const marks = shell.scene().layers.find((l) => l.name === "marks")?.primitives ?? [];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((p) => p.color === CANVAS_STYLE.mark.selected)).toBe(true);
    shell.key("s");
    sectionBy(shell, P(0, 2), P(3, 2), P(1.5, 1));
    expect(shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
  });

  describe("the preview, drawn by the marks' own function", () => {
    it("the line follows the pointer, then the side does; none of it is stored", () => {
      const shell = armed();
      shell.moveTo(P(0, 0));
      expect(letters(overlays(shell))).toEqual([]);
      shell.click(P(0, 0));
      shell.moveTo(P(2, 0));
      expect(overlays(shell)).toEqual(expect.arrayContaining(previewOf("A", P(0, 0), P(2, 0), 1)));
      shell.click(P(3, 0));
      shell.moveTo(P(1, -1));
      expect(tool(shell)).toEqual({ kind: "side", a: P(0, 0), b: P(3, 0), side: -1 });
      expect(overlays(shell)).toEqual(expect.arrayContaining(previewOf("A", P(0, 0), P(3, 0), -1)));
      shell.moveTo(P(1, 1));
      expect(tool(shell)).toMatchObject({ side: 1 });
      expect(overlays(shell)).toEqual(expect.arrayContaining(previewOf("A", P(0, 0), P(3, 0), 1)));
      expect(rows(shell)).toEqual({});
      expect(shell.scene().layers.find((l) => l.name === "marks")?.primitives).toEqual([]);
    });

    it("it shows the side already on the press that placed B, before any move", () => {
      const shell = armed();
      shell.click(P(0, 0));
      shell.click(P(3, 0));
      expect(tool(shell)).toEqual({ kind: "side", a: P(0, 0), b: P(3, 0), side: 1 });
      expect(overlays(shell)).toEqual(expect.arrayContaining(previewOf("A", P(0, 0), P(3, 0), 1)));
    });

    it("it names the letter it will take", () => {
      const shell = armed(fullDoc(2));
      shell.click(P(1, 1));
      shell.moveTo(P(3, 1));
      expect(letters(overlays(shell))).toEqual(["C", "C"]);
    });

    it("leaving the canvas hides it and keeps the points", () => {
      const shell = armed();
      shell.click(P(0, 0));
      shell.moveTo(P(2, 0));
      shell.send({ type: "pointerLeave" });
      expect(letters(overlays(shell))).toEqual([]);
      expect(shell.view().snap).toBeNull();
      expect(tool(shell)).toEqual({ kind: "second", a: P(0, 0) });
      shell.moveTo(P(2, 0));
      shell.click(P(3, 0));
      shell.moveTo(P(1, -1));
      shell.send({ type: "pointerLeave" });
      expect(letters(overlays(shell))).toEqual([]);
      expect(tool(shell)).toEqual({ kind: "side", a: P(0, 0), b: P(3, 0), side: -1 });
    });

    it("a tool switch and an undo drop the gesture", () => {
      const shell = armed();
      sectionBy(shell, P(0, 0), P(3, 0), P(1.5, 1));
      shell.key("s");
      shell.click(P(0, 2));
      shell.click(P(3, 2));
      shell.key("z", { meta: true });
      expect(tool(shell)).toEqual({ kind: "idle" });
      shell.click(P(0, 2));
      shell.key("w");
      shell.key("s");
      expect(tool(shell)).toEqual({ kind: "idle" });
    });
  });

  describe("shared", () => {
    const shared = (doc: Document = roomDoc()): FakeRemote => {
      const r = FakeRemote.open(doc);
      r.shell.key("s");
      r.shell.ui({ type: "setSnapStep", step: 0.1 });
      return r;
    };
    const WALL: Command = { type: "addWall", opId: "bob-op", from: { at: P(10, 10) }, to: { at: P(12, 10) } };

    it("a remote edit during the gesture leaves it working", () => {
      const r = shared();
      r.shell.click(P(1, 1));
      r.remote(WALL); // a topology change, at each stage
      expect(tool(r.shell)).toEqual({ kind: "second", a: P(1, 1) });
      r.shell.click(P(3, 1));
      r.remote({ ...WALL, opId: "bob-op-2", from: { at: P(10, 12) }, to: { at: P(12, 12) } });
      expect(tool(r.shell)).toMatchObject({ kind: "side", a: P(1, 1), b: P(3, 1) });
      r.remote(add(P(0, 5), P(1, 5))); // Bob takes A: this one will be B
      expect(r.shell.view().toast).toBeNull();
      r.shell.click(P(2, 2));
      expect(r.submits()).toHaveLength(1);
      r.accept();
      expect(rows(r.shell)["B"]).toMatchObject({ a: P(1, 1), b: P(3, 1), side: 1 });
      expect(r.shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
    });

    it("the second of two taking B is told, and the tool ends clean", () => {
      const r = shared(fullDoc(1));
      sectionBy(r.shell, P(1, 1), P(3, 1), P(2, 2));
      const mine = r.last();
      expect(rows(r.shell)["B"]).toMatchObject({ a: P(1, 1) }); // pending
      const past = r.shell.state.undo.past.length;
      r.remote(add(P(0, 2), P(4, 2), -1)); // Bob's reached the server first
      r.reject(mine);
      expect(r.shell.view().toast).toBe(CLASH_TEXT);
      expect(rows(r.shell)["B"]).toEqual({ id: "B", a: P(0, 2), b: P(4, 2), side: -1, depth: null });
      expect(r.shell.state.undo.past.length).toBe(past - 1);
      expect(r.shell.view().activeTool).toBe("select");
      expect(r.shell.state.selection).toEqual([{ table: "sections", id: "B" }]); // now Bob's: a stated limit
      r.shell.key("s");
      sectionBy(r.shell, P(1, 3), P(3, 3), P(2, 4)); // and the tool works again
      expect(rows(r.shell)["C"]).toMatchObject({ a: P(1, 3) });
    });

    it("a snapshot or a lost connection drops a half-made section", () => {
      const r = shared();
      r.snapshot(); // an armed tool with nothing placed is left alone
      expect(r.shell.view().toast).toBeNull();
      r.shell.click(P(1, 1));
      r.snapshot();
      expect(tool(r.shell)).toEqual({ kind: "idle" });
      expect(r.shell.view().toast).toBe(GESTURE_CANCELLED);
      r.shell.click(P(1, 1));
      r.shell.click(P(3, 1));
      r.disconnect();
      expect(tool(r.shell)).toEqual({ kind: "idle" });
      expect(r.shell.view().toast).toBe(CONNECTION_LOST);
    });

    it("a third click while another edit is pending keeps the line", () => {
      const r = shared();
      sectionBy(r.shell, P(1, 1), P(3, 1), P(2, 2));
      r.shell.key("s");
      sectionBy(r.shell, P(1, 3), P(3, 3), P(2, 4));
      expect(r.shell.view().toast).toBe("Waiting for server");
      expect(tool(r.shell)).toMatchObject({ kind: "side", a: P(1, 3), b: P(3, 3) });
      expect(r.submits()).toHaveLength(1);
    });
  });
});
