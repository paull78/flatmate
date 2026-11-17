import { describe, expect, it } from "vitest";
import { clearanceWarnings, footprints, type Document } from "@fm/domain";
import { FURNITURE_SETS, furnitureSet, setBox, setHeight } from "../src/furniture-sets";
import { FakeShell } from "./fake-shell";
import { roomDoc, withCommands } from "./builders";

// Sets in the Object tool (seated.03, .06, .11, .12; AC-12, AC-13, AC-17): a list of pieces and offsets, a ghost of all of them,
// and one edit that leaves independent pieces. The sample room's inner faces are x 0.1–5.9, y 0.1–3.9.

const BED = "bedAndNightstands";
const SOFA = "sofaAndRug";
const armed = (set: string, doc: Document = roomDoc()): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.ui({ type: "pickSet", set });
  return shell;
};
const kinds = (doc: Document): string[] => Object.values(doc.objects).map((o) => o.kind).sort();
const tool = (shell: FakeShell) => {
  const t = shell.state.tool;
  if (t.name !== "object") throw new Error(`the ${t.name} tool`);
  return t.state;
};
const box = (doc: Document) => {
  const all = [...footprints(doc).values()].flatMap((q) => q as readonly { x: number; y: number }[]);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe("the sets' lists", () => {
  it("bed and nightstands is 2.60 × 2.10, flush at the head; sofa and rug 2.10 × 2.35", () => {
    const by = (id: string) => FURNITURE_SETS.find((s) => s.id === id);
    const bed = by(BED);
    const sofa = by(SOFA);
    if (!bed || !sofa) throw new Error("no set");
    expect(setBox(bed)).toEqual({ w: expect.closeTo(2.6, 9), d: expect.closeTo(2.1, 9) });
    expect(setBox(sofa)).toEqual({ w: expect.closeTo(2.1, 9), d: expect.closeTo(2.35, 9) });
    expect(bed.pieces.map((p) => p.kind)).toEqual(["bed", "nightstand", "nightstand"]);
    expect(sofa.pieces.map((p) => p.kind)).toEqual(["rug", "sofa", "coffeeTable"]);
  });
});

describe("placing a set", () => {
  it.each([[BED, ["bed", "nightstand", "nightstand"]], [SOFA, ["coffeeTable", "rug", "sofa"]]])("%s: a click places its pieces as independent objects in one undo step, with no warnings, and it stays armed (AC-12)", (set, expected) => {
    const shell = armed(set);
    const p = { x: 3, y: 2 };
    shell.moveTo(p);
    expect(tool(shell).ghost?.fits).toBe(true);
    shell.click(p);
    expect(kinds(shell.doc())).toEqual(expected);
    expect(clearanceWarnings(shell.doc(), "s0")).toEqual([]);
    expect(shell.state.tool.name).toBe("object");
    expect(shell.state.objectSet).toBe(set);
    shell.key("z", { ctrl: true });
    expect(Object.keys(shell.doc().objects)).toEqual([]);
  });

  it("a ghost shows every piece, where the click puts it", () => {
    const shell = armed(BED);
    const p = { x: 3, y: 2 };
    shell.moveTo(p);
    const ghost = tool(shell).ghost;
    expect(ghost?.set?.map((g) => g.kind)).toEqual(["bed", "nightstand", "nightstand"]);
    const shown = (ghost?.set ?? []).map((g) => `${g.kind} ${g.at.x.toFixed(3)} ${g.at.y.toFixed(3)} ${g.rotation}`);
    shell.click(p);
    const doc = shell.doc();
    const placed = Object.values(doc.placements).map((q) => `${doc.objects[q.object]?.kind ?? ""} ${q.at.x.toFixed(3)} ${q.at.y.toFixed(3)} ${q.rotation}`);
    expect(placed.sort()).toEqual(shown.sort());
  });

  it("near a wall the overall box lands flush and turns its head to it, in the ghost and the placed pieces (AC-17)", () => {
    const shell = armed(BED);
    // Its back 0.05 m from the top wall, under the 10 px tolerance: flush at y 3.9.
    const near = { x: 3, y: 3.9 - 1.05 - 0.05 };
    shell.moveTo(near);
    const g = tool(shell).ghost;
    expect(g?.fits).toBe(true);
    expect(g?.at.y).toBeCloseTo(3.9, 6);
    expect(g?.rotation).toBe(0);
    shell.click(near);
    expect(box(shell.doc()).maxY).toBeCloseTo(3.9, 6);
    expect(clearanceWarnings(shell.doc(), "s0")).toEqual([]);

    // Its left end near the left wall, and no wall at its back: the box turns so its head is on that wall.
    const left = armed(BED);
    const side = { x: 0.1 + 1.3 + 0.05, y: 2 };
    left.moveTo(side);
    const turned = tool(left).ghost;
    expect(turned?.rotation).toBe(90);
    left.click(side);
    expect(box(left.doc()).minX).toBeCloseTo(0.1, 6);
    expect(box(left.doc()).maxX).toBeCloseTo(0.1 + 2.1, 6);
    const bed = Object.values(left.doc().placements).find((q) => left.doc().objects[q.object]?.kind === "bed");
    expect(bed?.rotation).toBe(90);
    expect(clearanceWarnings(left.doc(), "s0")).toEqual([]);
  });

  it("R turns the ghost about its centre, and the placed pieces match it (AC-13)", () => {
    const shell = armed(SOFA);
    const p = { x: 3, y: 2 };
    shell.moveTo(p);
    const before = tool(shell).ghost;
    shell.key("r");
    const after = tool(shell).ghost;
    expect(after?.rotation).toBe(((before?.rotation ?? 0) + 90) % 360);
    const shown = (after?.set ?? []).map((g) => `${g.kind} ${g.at.x.toFixed(3)} ${g.at.y.toFixed(3)} ${g.rotation}`);
    shell.click(p);
    const doc = shell.doc();
    expect(Object.values(doc.placements).map((q) => `${doc.objects[q.object]?.kind ?? ""} ${q.at.x.toFixed(3)} ${q.at.y.toFixed(3)} ${q.rotation}`).sort()).toEqual(shown.sort());
    const b = box(doc);
    expect(b.maxX - b.minX).toBeCloseTo(2.35, 6); // turned, its depth runs along x
    expect(b.maxY - b.minY).toBeCloseTo(2.1, 6);
  });

  it("where one piece doesn't fit, nothing is placed and the reason shows (AC-13)", () => {
    // A wardrobe where a nightstand would stand; the bed itself has room.
    const doc = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe", preset: "100" }, at: { x: 4.2, y: 3.9 } });
    const shell = armed(BED, doc);
    const p = { x: 3, y: 2.5 };
    shell.moveTo(p);
    expect(tool(shell).ghost?.fits).toBe(false);
    shell.click(p);
    expect(shell.doc()).toEqual(doc);
    expect(shell.view().toast).toMatch(/Nightstand|Wardrobe/);
  });

  it("moving one piece afterwards moves only it (AC-12)", () => {
    const shell = armed(BED);
    shell.click({ x: 3, y: 2 });
    const doc = shell.doc();
    const stand = Object.values(doc.placements).find((q) => doc.objects[q.object]?.kind === "nightstand");
    if (!stand) throw new Error("no nightstand");
    const others = Object.values(doc.placements).filter((q) => q.id !== stand.id);
    shell.command({ type: "movePlacement", placementId: stand.id, at: { x: 0.6, y: 3.5 }, rotation: 0 });
    expect(shell.doc().placements[stand.id]?.at).toEqual({ x: 0.6, y: 3.5 });
    expect(others.map((q) => shell.doc().placements[q.id]?.at)).toEqual(others.map((q) => q.at));
  });

  it("picking a kind leaves the set; the size picker is off while a set is armed", () => {
    const shell = armed(BED);
    expect(shell.view().sizePicker).toBeNull();
    shell.ui({ type: "pickKind", kind: "sofa" });
    expect(shell.state.objectSet).toBeNull();
    shell.click({ x: 3, y: 2 });
    expect(kinds(shell.doc())).toEqual(["sofa"]);
  });

  it("the hint doesn't offer drawing a footprint, which a set can't do", () => {
    const shell = armed(BED);
    expect(shell.view().commandBar.prompt).toBe("Click inside a room to place the set, R to turn it");
    shell.ui({ type: "pickKind", kind: "sofa" });
    expect(shell.view().commandBar.prompt).toBe("Click inside a room to place, or drag to draw its footprint");
  });

  it("an unknown set arms nothing", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickSet", set: "constructor" });
    expect(shell.state.objectSet).toBeNull();
    expect(shell.state.tool.name).not.toBe("object");
  });

  it("the Ctrl bypass keeps its start angle and takes no wall", () => {
    const shell = armed(BED);
    const near = { x: 3, y: 3.9 - 1.05 - 0.05 };
    shell.moveTo(near, { ctrl: true });
    expect(tool(shell).ghost?.at.y).toBeCloseTo(3.85, 2);
  });
});

describe("a set's height (knownbugs AC-02)", () => {
  it("is its tallest piece's: 0.90 for the sofa and rug, not a bed's 1.00", () => {
    const sofa = furnitureSet(SOFA);
    if (!sofa) throw new Error("no sofa set");
    expect(setHeight(sofa)).toBe(0.9);
  });
});
