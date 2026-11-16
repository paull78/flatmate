import { describe, expect, it } from "vitest";
import { execute, unwrap, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { DEFAULT_ZOOM } from "../src/camera";
import { areaTagLayout } from "../src/view/area-tags";
import { COLORS } from "../src/view/colors";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Selecting a named area (areas step 06, areas.07, .16, AC-06, AC-02): by its tag in the Select and Zone tools, anywhere
// inside it in the Zone tool; its outline on hover and selection, every area's faint outline while the Zone tool is out;
// Delete; the right-click list; Properties.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const KITCHEN: Command = { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 3, d: 2.4, name: "Kitchen" }; // x 0.5–3.5, y 0.8–3.2
const SOFA: Command = { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 2, y: 1.3 }, deck: null };
const AREA = { table: "areas", id: "k/a0" } as const;
const tagCentre = (shell: FakeShell): Point => {
  const tag = areaTagLayout(shell.doc(), "k/a0", shell.state.camera, "s0");
  if (!tag) throw new Error("no tag");
  return { x: (tag.min.x + tag.max.x) / 2, y: (tag.min.y + tag.max.y) / 2 };
};
/** Segments along the area's rectangle 0.5–3.5 × 0.8–3.2, in any layer. */
const outline = (shell: FakeShell): Extract<Primitive, { kind: "segment" }>[] => {
  const on = (p: Point): boolean => (Math.abs(p.x - 0.5) < 1e-9 || Math.abs(p.x - 3.5) < 1e-9) && p.y > 0.8 - 1e-9 && p.y < 3.2 + 1e-9
    || (Math.abs(p.y - 0.8) < 1e-9 || Math.abs(p.y - 3.2) < 1e-9) && p.x > 0.5 - 1e-9 && p.x < 3.5 + 1e-9;
  return shell.scene().layers.flatMap((l) => l.primitives).flatMap((p) => (p.kind === "segment" && on(p.a) && on(p.b) && (p.a.x === p.b.x || p.a.y === p.b.y) ? [p] : []));
};

describe("selecting an area (AC-06)", () => {
  it("a click on its tag selects it, in the Select and the Zone tool", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    shell.click(tagCentre(shell));
    expect(shell.state.selection).toEqual([AREA]);
    shell.key("Escape");
    shell.key("z");
    shell.click(tagCentre(shell));
    expect(shell.state.selection).toEqual([AREA]);
  });

  it("in the Select tool a click inside it away from its tag selects the sofa there, or nothing", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN, SOFA));
    shell.click({ x: 2, y: 1.0 });
    expect(shell.state.selection.map((r) => r.table)).toEqual(["placements"]);
    shell.click({ x: 0.8, y: 3 });
    expect(shell.state.selection).toEqual([]);
  });

  it("in the Zone tool a click anywhere inside it selects it, even with its tag hidden", () => {
    const small = run(roomDoc(), { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 0.4, d: 0.4, name: "Laundry" });
    const shell = FakeShell.withDocument(small);
    expect(areaTagLayout(small, "k/a0", { zoom: DEFAULT_ZOOM }, "s0")).toBeNull();
    shell.key("z");
    shell.click({ x: 2.1, y: 2.1 });
    expect(shell.state.selection).toEqual([AREA]);
  });

  it("in the Zone tool a room tiled by areas is selected by its tag", () => {
    const tiled = run(roomDoc(), { type: "labelZone", id: "L1", at: { x: 3, y: 2 }, name: "Great room", finish: null }, { type: "addArea", opId: "k", at: { x: 3, y: 2 }, w: 5.8, d: 3.8, name: "All" });
    const shell = FakeShell.withDocument(tiled);
    shell.key("z");
    shell.click({ x: 3, y: 2 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("shows its outline and four grips when selected, its outline on hover, none with nothing selected (AC-02)", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    expect(outline(shell)).toEqual([]);
    shell.moveTo(tagCentre(shell));
    expect(outline(shell).length).toBeGreaterThanOrEqual(4);
    shell.click(tagCentre(shell));
    expect(outline(shell).every((s) => s.color === COLORS.wallSelected)).toBe(true);
    expect(handles(shell.state, shell.doc()).filter((h) => h.kind === "areaSide")).toHaveLength(4);
  });

  it("while the Zone tool is out every area's outline shows; back in Select with nothing selected, none", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    shell.key("z");
    shell.moveTo({ x: 5, y: 1 });
    expect(outline(shell).length).toBeGreaterThanOrEqual(4);
    shell.key("Escape");
    shell.moveTo({ x: 5, y: 1 });
    expect(outline(shell)).toEqual([]);
  });

  it("Delete removes it in the Select and the Zone tool, and one undo restores it", () => {
    for (const tool of [null, "z"]) {
      const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
      if (tool) shell.key(tool);
      shell.click(tagCentre(shell));
      shell.key("Delete");
      expect(shell.doc().areas).toEqual({});
      shell.key("z", { meta: true });
      expect(Object.keys(shell.doc().areas)).toEqual(["k/a0"]);
    }
  });

  it("the right-click list names the area", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN));
    shell.down(tagCentre(shell), {}, 2);
    shell.up(tagCentre(shell), {}, 2);
    expect(shell.view().underPointer?.rows.map((r) => r.label)).toContain("Area · Kitchen");
  });
});

describe("clicks over the selected area (walkthrough, areas.38)", () => {
  const LABELLED: Command = { type: "labelZone", id: "L1", at: { x: 1.2, y: 1.5 }, name: "Main room", finish: null }; // inside Kitchen

  it("with the area selected, a click on its room's tag inside it selects the room", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN, LABELLED));
    shell.click(tagCentre(shell));
    expect(shell.state.selection).toEqual([AREA]);
    shell.click({ x: 1.2, y: 1.5 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
  });

  it("a click on the selected area's body goes on to the room under it; a press there still drags the area", () => {
    const shell = FakeShell.withDocument(run(roomDoc(), KITCHEN, LABELLED));
    shell.click(tagCentre(shell));
    shell.click({ x: 3, y: 1 });
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L1" }]);
    shell.click(tagCentre(shell));
    shell.drag({ x: 3, y: 1 }, { x: 3.2, y: 1 }, { ctrl: true });
    expect(shell.doc().areas["k/a0"]?.at).toEqual({ x: 2.2, y: 2 });
  });
});

describe("an area tag over a piece (walkthrough, areas.39)", () => {
  it("a click on an area's tag lying over a piece selects the area, even with the piece selected; the piece is still pressed off the tag", () => {
    // The sofa spans y 1.1–2.0 (its point is its back edge's centre); the area, 0.8 deep, has no free spot for its tag.
    const shell = FakeShell.withDocument(run(roomDoc(), { type: "addArea", opId: "k", at: { x: 2, y: 2 }, w: 1, d: 0.8, name: "Kitchen" }, { type: "placeObject", opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 2, y: 2 }, deck: null }));
    const tag = areaTagLayout(shell.doc(), "k/a0", shell.state.camera, "s0");
    if (!tag) throw new Error("no tag");
    const at = { x: 2, y: (tag.min.y + 2) / 2 }; // on the tag and on the sofa
    shell.click({ x: 1.2, y: 1.5 }); // the sofa, off the tag
    expect(shell.state.selection.map((r) => r.table)).toEqual(["placements"]);
    shell.click(at);
    expect(shell.state.selection).toEqual([AREA]);
  });
});
