import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import type { ObjectGhost } from "../src/tools/types";
import { roomDoc, studioDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// A typed width and depth while a kind is armed (sizing step 02; spec "The typed size", sizing.06, .08, .11, .19, .20,
// .23). roomDoc is 6 × 4 (inner faces x 0.1–5.9, y 0.1–3.9) under a 2.50 ceiling; its middle is free floor.

const MIDDLE: Point = { x: 3, y: 2 };

const ghost = (shell: FakeShell): ObjectGhost | null => (shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null);
const objects = (shell: FakeShell) => Object.values(shell.doc().objects);
const fields = (shell: FakeShell) => shell.view().sizeFields;
const picker = (shell: FakeShell) => shell.view().sizePicker;
const type = (shell: FakeShell, kind: string, sizes: { width?: string; depth?: string }) => shell.ui({ type: "setArmedSize", kind, ...sizes });
const pick = (shell: FakeShell, kind: string, preset: string) => shell.ui({ type: "pickPreset", kind, preset });

function armed(kind: string): FakeShell {
  const shell = FakeShell.withDocument(roomDoc());
  shell.ui({ type: "pickKind", kind });
  shell.moveTo(MIDDLE);
  return shell;
}

/** Width and Depth in Properties for the piece at `at`, selected with the Select tool. */
function propertiesAt(shell: FakeShell, at: Point): { width?: string; depth?: string } {
  shell.key("Escape");
  shell.click(at);
  const { properties } = shell.view();
  const value = (id: string) => ("fields" in properties ? properties.fields.find((f) => f.id === id)?.value : undefined);
  const width = value("width");
  const depth = value("depth");
  return { ...(width === undefined ? {} : { width }), ...(depth === undefined ? {} : { depth }) };
}

describe("a typed width and depth (sizing step 02)", () => {
  it("AC-01: typing 0.83 and 0.55 for Wardrobe sizes the ghost, the list reads Custom, and a click places it", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83" });
    type(shell, "wardrobe", { depth: "0.55" });
    expect(ghost(shell)).toMatchObject({ w: 0.83, d: 0.55, fits: true });
    expect(picker(shell)?.current).toBe("Custom");
    expect(fields(shell)).toEqual({ kind: "wardrobe", width: "0.83", depth: "0.55", height: "2.05", bad: [] });
    shell.click(MIDDLE);
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "wardrobe", w: { standard: 0.83 }, d: { standard: 0.55 } })]);
    expect(propertiesAt(shell, MIDDLE)).toEqual({ width: "0.83", depth: "0.55" });
  });

  it("AC-02: picking 100 × 60 afterwards sets the fields to 1.00 and 0.60, and the next click places that", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83", depth: "0.55" });
    pick(shell, "wardrobe", "100 × 60");
    expect(fields(shell)).toEqual({ kind: "wardrobe", width: "1.00", depth: "0.60", height: "2.05", bad: [] });
    expect(picker(shell)?.current).toBe("100 × 60");
    expect(ghost(shell)).toMatchObject({ w: 1, d: 0.6 });
    shell.click(MIDDLE);
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 1 }, d: { standard: 0.6 } })]);
  });

  it("AC-03: Chair has the fields and no list; a typed 0.50 × 0.50 is what a click places", () => {
    const shell = armed("chair");
    expect(picker(shell)).toBeNull();
    expect(fields(shell)).toMatchObject({ kind: "chair", bad: [] });
    type(shell, "chair", { width: "0.5", depth: "0.5" });
    shell.click(MIDDLE);
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "chair", w: { standard: 0.5 }, d: { standard: 0.5 } })]);
  });

  it("AC-07: the typed size is remembered per kind for the session", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83", depth: "0.55" });
    shell.click(MIDDLE);
    shell.click({ x: 4.6, y: 2 });
    expect(objects(shell).map((o) => [o.w["standard"], o.d["standard"]])).toEqual([[0.83, 0.55], [0.83, 0.55]]);
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(fields(shell)).toMatchObject({ width: "0.83", depth: "0.55" });
  });

  it("AC-11: a width of 12 stays red with its text, the ghost keeps its last good size, and a click places that", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83" });
    type(shell, "wardrobe", { width: "12" });
    expect(fields(shell)).toEqual({ kind: "wardrobe", width: "12", depth: "0.60", height: "2.05", bad: ["width"] });
    expect(ghost(shell)).toMatchObject({ w: 0.83 });
    shell.click(MIDDLE);
    expect(objects(shell)).toEqual([expect.objectContaining({ w: { standard: 0.83 } })]);
    expect(shell.view().toast).toBeNull(); // no toast for a bad field
  });

  it.each(["abc", "", "0.01", "10.01"])("a width of %j stays red and changes nothing", (text) => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: text });
    expect(fields(shell)).toEqual({ kind: "wardrobe", width: text, depth: "0.60", height: "2.05", bad: ["width"] });
    expect(ghost(shell)).toMatchObject({ w: 1.2, d: 0.6 });
    expect(shell.state.armed["wardrobe"]).toBeUndefined();
  });

  it("two bad fields at once, then a good width clears only width", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "x", depth: "y" });
    expect(fields(shell)?.bad).toEqual(["width", "depth"]);
    type(shell, "wardrobe", { width: "0.9" });
    expect(fields(shell)).toEqual({ kind: "wardrobe", width: "0.90", depth: "y", height: "2.05", bad: ["depth"] });
  });

  it("a preset pick and arming another kind clear a bad text", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "x" });
    pick(shell, "wardrobe", "100 × 60");
    expect(fields(shell)?.bad).toEqual([]);
    type(shell, "wardrobe", { depth: "y" });
    shell.ui({ type: "pickKind", kind: "bed" });
    shell.ui({ type: "pickKind", kind: "wardrobe" });
    expect(fields(shell)).toMatchObject({ depth: "0.60", bad: [] });
  });

  it("AC-13: a typed depth on a Murphy bed is its closed depth; the open depth stays the preset's", () => {
    const shell = armed("murphyBed");
    type(shell, "murphyBed", { depth: "0.45" });
    shell.click(MIDDLE);
    expect(objects(shell)).toEqual([expect.objectContaining({ kind: "murphyBed", d: { folded: 0.45, down: 2.1 } })]);
  });

  it("a typed size equal to a preset to the shown centimetre becomes that preset", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "1.003", depth: "0.6" });
    expect(picker(shell)?.current).toBe("100 × 60");
    expect(shell.state.armed["wardrobe"]).toEqual({ preset: "100 × 60" });
  });

  it("AC-16: a set and a stair kind have no fields, and a typed size changes nothing for them", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickSet", set: "bedAndNightstands" });
    expect(fields(shell)).toBeNull();
    const before = shell.state;
    type(shell, shell.state.objectKind, { width: "0.5" });
    expect(shell.state).toBe(before);
    shell.ui({ type: "pickKind", kind: "stair" });
    expect(fields(shell)).toBeNull();
    const stair = shell.state;
    type(shell, "stair", { width: "0.5" });
    expect(shell.state).toBe(stair);
  });

  it("the ghost follows a typed size and a preset pick at once, with the pointer still", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83" });
    expect(ghost(shell)?.w).toBe(0.83);
    pick(shell, "wardrobe", "150 × 60");
    expect(ghost(shell)?.w).toBe(1.5);
  });

  it.each([["83cm", 0.83], ["2' 9\"", 0.838], ["0.5+0.33", 0.83]])("%s is read as Properties reads it", (text, w) => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: text });
    expect(ghost(shell)?.w).toBeCloseTo(w, 3);
  });

  it("a typed size is not an edit: nothing sent, nothing to undo", () => {
    const shell = armed("wardrobe");
    const undo = shell.state.undo;
    shell.clearEffects();
    type(shell, "wardrobe", { width: "0.83" });
    expect(shell.state.undo).toBe(undo);
    expect(shell.effects.map((e) => e.type)).toEqual(["render"]); // a redraw, nothing sent
  });

  it("a preset card after a typed size resets it; a plain kind card keeps it", () => {
    const shell = armed("wardrobe");
    type(shell, "wardrobe", { width: "0.83" });
    shell.ui({ type: "pickKind", kind: "wardrobe" }); // a plain card
    expect(fields(shell)?.width).toBe("0.83");
    shell.ui({ type: "pickKind", kind: "wardrobe" }); // a preset card: pickKind, then pickPreset
    pick(shell, "wardrobe", "200 × 60");
    expect(fields(shell)?.width).toBe("2.00");
  });
});

describe("the click places exactly the ghost, with a typed size (sizing step 02)", () => {
  it("fuzz (seeded): a typed width and depth over five kinds in the Studio", () => {
    let seed = 23;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const cmIn = (lo: number, hi: number): number => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
    const kinds = ["bed", "wardrobe", "desk", "chair", "block"];
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const shell = FakeShell.withDocument(studioDoc());
      const kind = kinds[Math.floor(rand() * kinds.length)] ?? "bed";
      shell.ui({ type: "pickKind", kind });
      const w = cmIn(0.1, 2.4);
      const d = cmIn(0.1, 2.2);
      type(shell, kind, { width: String(w), depth: String(d) });
      const p = { x: cmIn(-0.3, 6.3), y: cmIn(-0.3, 4.3) };
      const tag = `#${i} ${kind} ${w} × ${d} at (${p.x}, ${p.y})`;
      shell.moveTo(p);
      const g = ghost(shell);
      if (!g) {
        failures.push(`${tag}: no ghost`);
        continue;
      }
      if (g.w !== w || g.d !== d) failures.push(`${tag}: ghost is ${g.w} × ${g.d}`);
      const before = new Set(Object.keys(shell.doc().placements));
      shell.click(p);
      const added = Object.entries(shell.doc().placements).filter(([id, q]) => !before.has(id) && q.state === "s0").map(([, q]) => {
        const o = shell.doc().objects[q.object];
        return { at: q.at, rotation: q.rotation, w: o?.w[q.config], d: o?.d[q.config] };
      });
      const want = g.fits ? [{ at: g.at, rotation: g.rotation, w: g.w, d: g.d }] : [];
      if (JSON.stringify(added) !== JSON.stringify(want)) failures.push(`${tag}: ghost ${JSON.stringify(g)}, placed ${JSON.stringify(added)}`);
    }
    expect(failures).toEqual([]);
  });
});
