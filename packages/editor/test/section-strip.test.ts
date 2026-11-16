import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { worldToScreen } from "../src/camera";
import type { ExportPage } from "../src/ports/effects";
import type { Primitive } from "../src/view/scene-types";
import { nightBedDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The strip (spec "The strip", AC-09): this viewer's section under the plan, apart from the selection.
//
//   (-1,2) A ▬▬ ─ ─ ─ ─ ─ ─ ▬▬ A (7,2)     through the 6 × 4 room's side walls, looking up
//   (-1,1) B ▬▬ ─ ─ ─ ─ ─ ─ ▬▬ B (7,1)

const P = (x: number, y: number): Point => ({ x, y });
const add = (y: number): Command => ({ type: "addSection", a: P(-1, y), b: P(7, y), side: 1 });
const twoSections = (doc: Document = roomDoc()): Document => withCommands(doc, add(2), add(1));
const delete_ = (id: string): Command => ({ type: "deleteEntities", ids: [{ table: "sections", id }] });

const strip = (shell: FakeShell) => shell.view().sectionStrip;
const shown = (shell: FakeShell): string | null => strip(shell)?.section ?? null;
const pageOf = (shell: FakeShell, w = 1200, h = 208): ExportPage => {
  const s = strip(shell);
  if (!s) throw new Error("no strip");
  return s.page({ w, h });
};
const texts = (p: ExportPage): string[] => p.primitives.flatMap((q) => (q.kind === "text" ? [q.text] : []));
const clickA = (shell: FakeShell): void => shell.click(P(3, 2));
const clickB = (shell: FakeShell): void => shell.click(P(3, 1));

function pointsOf(p: Primitive): Point[] {
  switch (p.kind) {
    case "segment": return [p.a, p.b];
    case "polygon": return [...p.points, ...p.holes.flat()];
    case "arc": case "disc": return [p.center];
    case "text": return [p.at];
  }
}

describe("the strip follows the selection only to a section", () => {
  it("nothing is open at first", () => {
    expect(strip(FakeShell.withDocument(twoSections()))).toBeNull();
  });

  it("selecting a section opens the strip on it", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickB(shell);
    expect(shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
    expect(shown(shell)).toBe("B");
  });

  it("selecting another section switches it", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    clickB(shell);
    expect(shown(shell)).toBe("B");
  });

  it("drawing one opens the strip on it, on the third click", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickTool", tool: "section" });
    shell.click(P(-1, 2));
    shell.click(P(7, 2));
    expect(strip(shell)).toBeNull();
    shell.click(P(3, 3));
    expect(shown(shell)).toBe("A");
  });

  it("selecting a wall leaves it", () => {
    const doc = twoSections();
    const shell = FakeShell.withDocument(doc);
    clickA(shell);
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wallBetween(doc, P(0, 0), P(6, 0)) } });
    expect(shell.state.selection).toHaveLength(1);
    expect(shell.state.selection[0]?.table).toBe("walls");
    expect(shown(shell)).toBe("A");
  });

  it("clicking empty floor leaves it, and it opens on nothing but a section", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.click(P(3, 3));
    expect(shell.state.selection).toEqual([]);
    expect(shown(shell)).toBe("A");
    const other = FakeShell.withDocument(twoSections());
    other.click(P(3, 3));
    expect(strip(other)).toBeNull();
  });

  it("a letter switches it and selects that section, as a click on its mark does", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.ui({ type: "showSection", section: "B" });
    expect(shown(shell)).toBe("B");
    expect(shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
    expect(shell.view().properties.kind).toBe("section");
  });

  it("a letter takes the selection from anything else", () => {
    const doc = twoSections();
    const shell = FakeShell.withDocument(doc);
    clickA(shell);
    shell.ui({ type: "selectEntity", ref: { table: "walls", id: wallBetween(doc, P(0, 0), P(6, 0)) } });
    shell.ui({ type: "showSection", section: "B" });
    expect(shell.state.selection).toEqual([{ table: "sections", id: "B" }]);
  });

  it("a letter while drawing only switches the picture, and the tool and its points stay", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.ui({ type: "pickTool", tool: "wall" });
    shell.click(P(1, 1));
    const tool = shell.state.tool;
    shell.ui({ type: "showSection", section: "B" });
    expect(shown(shell)).toBe("B");
    expect(shell.state.tool).toEqual(tool);
    expect(shell.state.selection).toEqual([]);
  });

  it("lists every letter with its label, in order", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickB(shell);
    expect(strip(shell)?.letters).toEqual([{ section: "A", label: "A–A" }, { section: "B", label: "B–B" }]);
  });

  it("close closes it and deselects the section, and a click on that section opens it again", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.ui({ type: "closeSection" });
    expect(strip(shell)).toBeNull();
    expect(shell.state.selection).toEqual([]);
    expect(shell.view().properties.kind).toBe("none");
    shell.moveTo(P(2, 3));
    expect(strip(shell)).toBeNull();
    clickA(shell);
    expect(shown(shell)).toBe("A");
    expect(shell.state.selection).toEqual([{ table: "sections", id: "A" }]);
  });

  it("close deselects a section picked by its letter", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.ui({ type: "showSection", section: "B" });
    shell.ui({ type: "closeSection" });
    expect(strip(shell)).toBeNull();
    expect(shell.state.selection).toEqual([]);
  });

  it("close leaves anything else selected", () => {
    const doc = twoSections();
    const shell = FakeShell.withDocument(doc);
    clickA(shell);
    const wall = { table: "walls" as const, id: wallBetween(doc, P(0, 0), P(6, 0)) };
    shell.ui({ type: "selectEntity", ref: wall });
    shell.ui({ type: "closeSection" });
    expect(strip(shell)).toBeNull();
    expect(shell.state.selection).toEqual([wall]);
  });

  it("a letter with no row opens nothing", () => {
    const shell = FakeShell.withDocument(twoSections());
    shell.ui({ type: "showSection", section: "Q" });
    expect(strip(shell)).toBeNull();
    shell.ui({ type: "showSection", section: "constructor" });
    expect(strip(shell)).toBeNull();
    expect(shell.state.stripSection).toBeNull();
    expect(shell.state.selection).toEqual([]);
  });

  it("deleting its section closes it, and an undo doesn't reopen it", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    shell.key("Delete");
    expect(Object.keys(shell.doc().sections)).toEqual(["B"]);
    expect(strip(shell)).toBeNull();
    shell.ui({ type: "undo" });
    expect(Object.keys(shell.doc().sections).sort()).toEqual(["A", "B"]);
    expect(strip(shell)).toBeNull();
  });

  it("the project list closes it, so another project's A doesn't open", () => {
    const r = FakeRemote.open(twoSections());
    clickA(r.shell);
    expect(shown(r.shell)).toBe("A");
    r.shell.ui({ type: "showProjectList" });
    expect(r.shell.state.stripSection).toBeNull();
    expect(strip(r.shell)).toBeNull();
  });
});

describe("the strip's page", () => {
  it("is the size it's asked for, with room for what it draws", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    const page = pageOf(shell, 1200, 300);
    expect([page.widthMm, page.heightMm]).toEqual([1200, 300]);
    const points = page.primitives.flatMap(pointsOf);
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((q) => q.x >= 0 && q.x <= 1200 && q.y >= 0 && q.y <= 300)).toBe(true);
  });

  const extentOf = (w: number, h: number): { x: number[]; y: number[] } => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), add(2)));
    shell.ui({ type: "showSection", section: "A" });
    const points = pageOf(shell, w, h).primitives.flatMap((q) => (q.kind === "polygon" ? q.points : []));
    const range = (vs: number[]): number[] => [Math.min(...vs), Math.max(...vs)];
    return { x: range(points.map((q) => q.x)), y: range(points.map((q) => q.y)) };
  };
  const close = (got: number[] | undefined, want: number[]): void => expect(got?.map((v) => Math.round(v * 1e6) / 1e6)).toEqual(want);

  it("fits a long line by its width and a short one by its height", () => {
    const wide = (w: number, h: number): number => {
      const { x } = extentOf(w, h);
      return (x[1] ?? 0) - (x[0] ?? 0);
    };
    expect(wide(600, 208)).toBeGreaterThan(wide(500, 208) + 50); // narrow: the width decides
    expect(wide(3000, 208)).toBeCloseTo(wide(2000, 208), 6); // wide: the height decides
    expect(wide(3000, 400)).toBeGreaterThan(wide(3000, 208) + 50); // a taller frame draws larger
  });

  it("fills what its margins leave: 16 left, 76 right for the heights, 8 below and above", () => {
    close(extentOf(400, 208).x, [16, 324]); // a line 8 m long sets the scale: 400 − 76
    close(extentOf(3000, 208).y, [8, 200]); // the height sets it: 208 − 8, the bands included
  });

  it("centres the picture and its heights across when the height sets the scale", () => {
    const { x } = extentOf(3000, 208);
    const left = x[0] ?? 0;
    const right = 3000 - ((x[1] ?? 0) + 76); // the heights take the 76 past the picture
    expect(left).toBeGreaterThan(16);
    expect(left).toBeCloseTo(right, 6);
  });

  it("centres it up and down when the width sets the scale", () => {
    const { y } = extentOf(400, 600);
    expect(y[0] ?? 0).toBeGreaterThan(8);
    expect(y[0] ?? 0).toBeCloseTo(600 - (y[1] ?? 0), 6);
  });

  it("stays the right way up however small the frame", () => {
    const shell = FakeShell.withDocument(twoSections());
    shell.ui({ type: "showSection", section: "A" });
    const heightAt = (value: string): number => {
      const found = pageOf(shell, 40, 40).primitives.find((q) => q.kind === "text" && q.text === value);
      if (found?.kind !== "text") throw new Error(`no ${value}`);
      return found.at.y;
    };
    expect(heightAt("+2.50")).toBeGreaterThan(heightAt("±0.00"));
  });

  it("has the heights beside the picture, and the title in the head, not on the page", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    expect(strip(shell)).toMatchObject({ label: "A–A", layout: "Layout" });
    expect(texts(pageOf(shell))).toEqual(expect.arrayContaining(["±0.00", "+2.50"]));
    expect(texts(pageOf(shell)).some((t) => t.startsWith("A–A"))).toBe(false);
  });

  it("the strip's page follows the viewed layout", () => {
    const doc = twoSections(nightBedDoc());
    const shell = FakeShell.withDocument(doc);
    clickA(shell);
    const other = shell.view().states.find((s) => !s.active)?.id ?? "";
    expect(doc.states[other]?.name).toBe("Night");
    const before = pageOf(shell);
    shell.ui({ type: "setActiveState", id: other });
    const after = pageOf(shell);
    expect(after).not.toBe(before);
    expect(strip(shell)).toMatchObject({ label: "A–A", layout: doc.states[other]?.name });
    expect(after.primitives.length).toBeGreaterThan(before.primitives.length); // the bed is Night's alone
  });

  it("its identity holds until the document or layout changes", () => {
    const doc = twoSections(nightBedDoc());
    const shell = FakeShell.withDocument(doc);
    clickA(shell);
    const page = pageOf(shell);
    expect(pageOf(shell)).toBe(page);
    shell.moveTo(P(2, 3));
    shell.wheel(0, 40, { ctrl: true });
    shell.ui({ type: "toggle3d" });
    shell.ui({ type: "pickTool", tool: "wall" });
    shell.ui({ type: "pickTool", tool: "select" });
    expect(pageOf(shell)).toBe(page);
    expect(strip(shell)).toBe(strip(shell));
  });

  it("no drag redraws it, and the edit let go does", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    const page = pageOf(shell);
    // A's b end, dragged two metres on along its line, past the room.
    shell.moveTo(P(7, 2));
    shell.down(P(7, 2));
    shell.moveTo(P(8, 2));
    expect(pageOf(shell)).toBe(page);
    shell.moveTo(P(9, 2));
    expect(pageOf(shell)).toBe(page);
    shell.up(P(9, 2));
    expect(shell.doc().sections["A"]?.b).toEqual(P(9, 2));
    expect(pageOf(shell)).not.toBe(page);
  });

  it("changes with the width, the section and an edit elsewhere", () => {
    const shell = FakeShell.withDocument(twoSections());
    clickA(shell);
    const a = pageOf(shell);
    const narrower = pageOf(shell, 900);
    expect(narrower).not.toBe(a);
    expect(narrower.widthMm).toBe(900);
    expect(pageOf(shell, 900)).toBe(narrower);
    expect(pageOf(shell, 900, 300)).not.toBe(narrower);
    shell.ui({ type: "showSection", section: "B" });
    const b = pageOf(shell);
    expect(b).not.toBe(a);
    expect(strip(shell)?.label).toBe("B–B");
    shell.command({ type: "setCeiling", height: 3 });
    expect(pageOf(shell)).not.toBe(b);
    expect(texts(pageOf(shell))).toContain("+3.00");
  });
});

describe("the plan beside the strip", () => {
  it("a resize keeps the plan centred on the same point", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const centre = shell.state.camera.center;
    shell.send({ type: "viewportResized", size: { width: 1200, height: 560 }, devicePixelRatio: 1 });
    expect(shell.state.camera.center).toEqual(centre);
    expect(worldToScreen(shell.state.camera, centre)).toEqual(P(600, 280));
  });
});

describe("sharing", () => {
  it("a remote delete of its section closes it", () => {
    const r = FakeRemote.open(twoSections());
    clickA(r.shell);
    expect(shown(r.shell)).toBe("A");
    r.remote(delete_("A"));
    expect(strip(r.shell)).toBeNull();
    expect(r.shell.state.selection).toEqual([]);
  });

  it("a remote delete of another section leaves it, and its letters drop it", () => {
    const r = FakeRemote.open(twoSections());
    clickA(r.shell);
    r.remote(delete_("B"));
    expect(shown(r.shell)).toBe("A");
    expect(strip(r.shell)?.letters).toEqual([{ section: "A", label: "A–A" }]);
  });

  it("a remote edit of its section redraws it, on the same section", () => {
    const r = FakeRemote.open(twoSections());
    clickA(r.shell);
    const page = pageOf(r.shell);
    r.remote({ type: "setCeiling", height: 3 });
    expect(shown(r.shell)).toBe("A");
    expect(pageOf(r.shell)).not.toBe(page);
    expect(texts(pageOf(r.shell))).toContain("+3.00");
  });

  it("another viewer's strip is untouched", () => {
    const doc = twoSections();
    const alice = FakeRemote.open(doc);
    const bob = FakeRemote.open(doc);
    clickA(alice.shell);
    expect(strip(bob.shell)).toBeNull();
    clickB(bob.shell);
    expect(shown(alice.shell)).toBe("A");
    expect(shown(bob.shell)).toBe("B");
    expect(strip(alice.shell)?.label).toBe("A–A");
    expect(strip(bob.shell)?.label).toBe("B–B");
    bob.shell.ui({ type: "closeSection" });
    expect(shown(alice.shell)).toBe("A");
    expect(strip(bob.shell)).toBeNull();
  });

  it("opening it sends no edit", () => {
    const r = FakeRemote.open(twoSections());
    clickA(r.shell);
    r.shell.ui({ type: "showSection", section: "B" });
    r.shell.ui({ type: "closeSection" });
    expect(r.submits()).toEqual([]);
  });
});
