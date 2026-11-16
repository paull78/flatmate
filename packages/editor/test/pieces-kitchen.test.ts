import { describe, expect, it } from "vitest";
import { execute, placementRange, unwrap, type Command, type Document } from "@fm/domain";
import { objectLook } from "../src/view/furniture";
import { objectsLayer } from "../src/view/objects-layer";
import { PALETTE_KINDS } from "../src/view/palette";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The range, cooker hood and tall pantry (spec pieces, step 02): their symbols as the mock-up draws them (pieces.07),
// the hood dashed above the cut, their palette places, and sizes free in Properties. Footprint space: x from −w/2 to
// w/2, y from −d (the front) to 0 (the back).

type Segment = Extract<Primitive, { kind: "segment" }>;
const D = (kind: string, w: number, d: number) => objectLook(kind, "standard", w, d, { line: "L", frontPx: 1, detail: "D" }).filter((p) => p.color === "D");
const segs = (ps: readonly Primitive[]): Segment[] => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const fullArcs = (ps: readonly Primitive[]) => ps.filter((p) => p.kind === "arc" && Math.abs(p.to - p.from - 2 * Math.PI) < 1e-12);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const across = (s: Segment, y: number, x0: number, x1: number) => near(s.a.y, y) && near(s.b.y, y) && near(Math.min(s.a.x, s.b.x), x0) && near(Math.max(s.a.x, s.b.x), x1);
const place = (opId: string, kind: string, x: number, y: number, rotation = 0, preset?: string): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: preset === undefined ? { kind } : { kind, preset }, at: { x, y }, rotation });
const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

describe("the range, cooker hood and tall pantry on the plan (AC-03, AC-04)", () => {
  it("the range draws its plate, four rings and the oven door's line", () => {
    const ps = D("range", 0.6, 0.6);
    expect(fullArcs(ps)).toHaveLength(4);
    expect(segs(ps).some((s) => across(s, -0.88 * 0.6, -0.3, 0.3))).toBe(true);
  });

  it("the tall pantry draws three shelves, its door band and a joint per 0.50 m: one at 0.80 wide, none at 0.60", () => {
    const ps = segs(D("tallPantry", 0.8, 0.6));
    const shelves = ps.filter((s) => near(s.a.y, s.b.y) && [0.25, 0.45, 0.65].some((f) => near(s.a.y, -f * 0.6)));
    expect(shelves).toHaveLength(3);
    expect(ps.some((s) => across(s, -0.9 * 0.6, -0.4, 0.4))).toBe(true);
    const joints = (w: number) => segs(D("tallPantry", w, 0.6)).filter((s) => near(s.a.x, s.b.x) && !near(s.a.y, s.b.y));
    expect(joints(0.8)).toHaveLength(1);
    expect(joints(0.6)).toHaveLength(0);
  });

  it("the cooker hood's card shows its canopy and the chimney's square at the back", () => {
    const ps = segs(D("cookerHood", 0.6, 0.5));
    const chimney = ps.filter((s) => Math.max(Math.abs(s.a.x), Math.abs(s.b.x)) <= 0.15 + 1e-6 && Math.min(s.a.y, s.b.y) >= -0.3 - 1e-6);
    expect(chimney.length).toBeGreaterThanOrEqual(4);
  });

  it("a cooker hood draws dashed above the cut, with no polygon and no symbol, at its default and as the slim one", () => {
    for (const preset of [undefined, "Slim"]) {
      const doc = ok(roomDoc(), place("h", "cookerHood", 3, 0.1, 180, preset)); // x 2.7–3.3, y 0.1–0.6
      const ps = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80).filter((p) => {
        const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : [];
        return pts.length > 0 && pts.every((q) => q.x >= 2.7 - 1e-6 && q.x <= 3.3 + 1e-6 && q.y >= 0.1 - 1e-6 && q.y <= 0.6 + 1e-6);
      });
      expect(ps.length, String(preset)).toBe(4);
      expect(ps.every((p) => p.kind === "segment" && p.dash !== undefined), String(preset)).toBe(true);
    }
  });
});

describe("the palette (AC-02)", () => {
  it("Kitchen gains the range after the hob, the tall pantry after the oven column and the hood after the wall cabinet", () => {
    const kitchen = PALETTE_KINDS.find((g) => g.group === "Kitchen")?.cards.map((c) => c.kind);
    expect([...new Set(kitchen)]).toEqual(["hobUnit", "range", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "tallPantry", "wallCabinet", "cookerHood", "cornerCounter"]);
  });
});

describe("sizes stay free (AC-07, pieces.06)", () => {
  it("a tall pantry takes 0.45 deep and 2.30 high in Properties, in one step each", () => {
    const shell = FakeShell.withDocument(ok(roomDoc(), place("p", "tallPantry", 3, 3.9)));
    shell.click({ x: 3, y: 3.6 });
    shell.ui({ type: "setField", fieldId: "depth", value: "0.45" });
    shell.ui({ type: "setField", fieldId: "height.standard", value: "2.30" });
    expect(shell.view().toast).toBeNull();
    const object = Object.values(shell.doc().objects)[0];
    expect([object?.d.standard, object?.h?.standard]).toEqual([0.45, 2.3]);
  });

  it("the Tall preset places a 2.40 m pantry", () => {
    const doc = ok(roomDoc(), place("p", "tallPantry", 3, 3.9, 0, "Tall"));
    expect(placementRange(doc, Object.keys(doc.placements)[0] ?? "")).toMatchObject({ bottom: 0, top: 2.4 });
  });
});
