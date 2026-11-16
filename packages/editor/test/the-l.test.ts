import { describe, expect, it } from "vitest";
import { emptyDocument, execute, levels, rectangleRoom, reachesLevel, unwrap, type Command, type Document, type Level } from "@fm/domain";
import { objectsLayer } from "../src/view/objects-layer";
import { CANVAS_STYLE } from "../src/view/plan-style";
import { floorView, viewAt } from "../src/view/plan-view";
import type { Primitive } from "../src/view/scene-types";
import { faces3d } from "../src/view3d/faces";
import { view3dItems } from "../src/view3d/items";
import type { Face3d, PieceItem } from "../src/view3d/types";
import { FakeShell } from "./fake-shell";
import { visibleFrom } from "./view3d/visible";

// The L on the plan and in 3D (AC-07, stairs.49). A 4.8 × 2.3 room (inner faces x 0.1–4.9, y 0.1–2.4) under a 3.20
// ceiling, so the floor's cut is 1.20; the loft (loft/k0, hollow, top 2.15) over x 3.0–4.9; the landing (plat/k0, a
// 0.90 × 0.90 platform at +1.08) over x 0.73–1.63, y 1.5–2.4, below the cut and so no level.
//   flight 1  x 0.73–1.63, y 0.15–1.5, rising +y to the platform: 6 risers of 0.180, going 0.270
//   flight 2  x 1.63–3.0, y 1.5–2.4, rising +x from the platform's edge to the loft: 6 risers of 0.178, going 0.274;
//             its first tread's top is 1.08 + 0.178 = 1.258, above the cut, so it breaks at its front edge

const LOFT = "loft/k0";
const room: readonly Command[] = [
  ...rectangleRoom({ x: 0, y: 0 }, 5, 2.5, "lr"),
  { type: "setCeiling", height: 3.2 },
  { type: "addDeck", opId: "loft", preset: "loft", at: { x: 3.95, y: 1.25 }, w: 1.9, d: 2.3, name: "Loft" },
  { type: "addDeck", opId: "plat", preset: "platform", at: { x: 1.18, y: 1.95 }, w: 0.9, d: 0.9, top: 1.08, name: "Platform" },
];
const flight1: Command = { type: "placeObject", opId: "f1", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 1.35 } }, at: { x: 1.18, y: 1.5 }, rotation: 0, deck: null, reaches: "plat/k0" };
const flight2 = (kind = "stair"): Command => ({ type: "placeObject", opId: "f2", state: "s0", object: { kind, size: { w: 0.9, d: 1.37 } }, at: { x: 3, y: 1.95 }, rotation: 270, deck: null, reaches: LOFT });
/** The L: links are explicit (stairdraw.08) and nothing sets startsAt before the gesture's L, so flight 2's is written here. */
function theL(kind = "stair"): Document {
  const doc = [...room, flight1, flight2(kind)].reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument());
  const f2 = doc.objects["f2/o0"];
  if (!f2) throw new Error("no flight 2");
  return { ...doc, objects: { ...doc.objects, "f2/o0": { ...f2, startsAt: "plat/k0" } } };
}

const loftLevel = (doc: Document): Level => {
  const level = levels(doc).find((l) => l.deckIds.includes(LOFT));
  if (!level) throw new Error("no loft level");
  return level;
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const segments = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "segment" ? [p] : []));
const texts = (ps: readonly Primitive[]) => ps.flatMap((p) => (p.kind === "text" ? [p.text] : []));
/** Flight 1's nosings: horizontal, 0.90 long, strictly between its front (y 0.15) and back (y 1.5) edges. */
const treads1 = (ps: readonly Primitive[]) =>
  segments(ps).filter((s) => near(s.a.y, s.b.y) && near(Math.abs(s.a.x - s.b.x), 0.9) && near(Math.min(s.a.x, s.b.x), 0.73) && s.a.y > 0.15 + 1e-6 && s.a.y < 1.5 - 1e-6);
/** Flight 2's nosings: vertical, 0.90 long, strictly between its front (x 1.63) and back (x 3.0) edges. */
const treads2 = (ps: readonly Primitive[]) =>
  segments(ps).filter((s) => near(s.a.x, s.b.x) && near(Math.abs(s.a.y - s.b.y), 0.9) && near(Math.min(s.a.y, s.b.y), 1.5) && s.a.x > 1.63 + 1e-6 && s.a.x < 3 - 1e-6);
/** Segments within flight 2's box (with the break line's overshoot), neither horizontal nor vertical: the break line. */
const slanted2 = (ps: readonly Primitive[]) =>
  segments(ps).filter((s) => !near(s.a.x, s.b.x) && !near(s.a.y, s.b.y) && [s.a, s.b].every((q) => q.x > 1.5 && q.x < 3.1 && q.y > 1.3 && q.y < 2.6));

describe("the L at the floor (AC-07)", () => {
  const doc = theL();
  const layer = objectsLayer(doc, floorView(doc, "s0"), CANVAS_STYLE, "", 80);

  it("flight 1, below the cut, is solid throughout and labelled UP · 6 R", () => {
    expect(texts(layer)).toContain("UP · 6 R");
    const lines = treads1(layer);
    expect(lines).toHaveLength(4);
    expect(lines.filter((s) => s.dash !== undefined)).toEqual([]);
  });

  it("flight 2 counts from 1.08: its break is at its 1st tread (top 1.258), so every tread past it is dashed, labelled UP · 6 R", () => {
    expect(texts(layer)).toContain("UP · 6 R");
    const lines = treads2(layer);
    expect(lines).toHaveLength(4);
    expect(lines.every((s) => s.dash !== undefined)).toBe(true);
  });

  it("draws flight 2's break line at its front edge, within the flight and off the platform", () => {
    const lines = slanted2(layer);
    expect(lines.length).toBeGreaterThan(0);
    const xs = lines.flatMap((s) => [s.a.x, s.b.x]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1.63 - 1e-6);
    expect(Math.max(...xs)).toBeLessThan(1.63 + 0.274);
  });
});

describe("the L at the loft level (AC-07)", () => {
  const doc = theL();
  const layer = objectsLayer(doc, viewAt("s0", loftLevel(doc)), CANVAS_STYLE, "", 80);

  it("shows both flights whole, no dashes, labelled DN", () => {
    expect(texts(layer)).toEqual(expect.arrayContaining(["DN · 6 R", "DN · 6 R"]));
    expect(treads1(layer)).toHaveLength(4);
    expect(treads2(layer)).toHaveLength(4);
    expect(segments(layer).filter((s) => s.dash !== undefined)).toEqual([]);
  });

  it("reachesLevel follows the L: flight 1 reaches the landing that flight 2 starts at, and flight 2 the loft", () => {
    expect(reachesLevel(doc, "f1/o0", loftLevel(doc))).toBe(true);
    expect(reachesLevel(doc, "f2/o0", loftLevel(doc))).toBe(true);
    expect(reachesLevel(doc, "f1/o0", floorView(doc, "s0").level)).toBe(false);
  });
});

describe("flight 2's Properties", () => {
  it("shows a read-only Starts at row after Reaches, and the rise and its numbers from the platform: 1.07, 6 risers of 0.178", () => {
    const shell = FakeShell.withDocument(theL());
    shell.click({ x: 2.3, y: 1.95 });
    const vm = shell.view();
    const stair = ("fields" in vm.properties ? vm.properties.fields : []).filter((f) => f.section === "Stair" && f.check === undefined);
    expect(stair.map((f) => [f.id, f.label, f.value, f.readOnly])).toEqual([
      ["width", "Width", "0.90", false],
      ["depth", "Run", "1.37", false],
      ["reaches", "Reaches", LOFT, false],
      ["startsAt", "Starts at", "Platform +1.08", true],
      ["rise", "Rise", "1.07", true],
      ["fitRun", "Fit run", "1.37", true],
      ["targetRiser", "Target riser", "", false],
      ["risers", "Risers", "6 × 0.178", true],
      ["going", "Going", "0.274", false],
      ["slope", "Slope", "33.1", true],
      ["handrailLeft", "Left handrail", "railing", false],
      ["handrailRight", "Right handrail", "railing", false],
    ]);
  });
});

describe("the L in 3D", () => {
  const TO_CAMERA = { x: 0.6, y: -0.8 };
  /** Its body alone: its handrails have their own tests (handrail-faces.test.ts). */
  const pieceOf = (doc: Document, placement: string): PieceItem => {
    const item = view3dItems(doc, "s0", null, new Set(), false).find((i): i is PieceItem => i.item === "piece" && i.placement === placement);
    if (!item) throw new Error("no piece");
    const body = { ...item };
    delete body.handrails;
    return body;
  };
  const flat = (f: Face3d): boolean => f.points.every((p) => Math.abs(p.z - (f.points[0]?.z ?? 0)) < 1e-9);
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  const zs = (faces: readonly Face3d[]): number[] => faces.flatMap((f) => f.points.map((p) => p.z));

  it("flight 2's blocks (a solid stair) still reach the floor, their tops at 1.08 + k × 0.178", () => {
    const faces = visibleFrom(faces3d(pieceOf(theL(), "f2/p0")), TO_CAMERA);
    expect(Math.min(...zs(faces))).toBeCloseTo(0, 9);
    const tops = new Set(faces.filter(flat).map((f) => round(f.points[0]?.z ?? 0)));
    for (let k = 1; k <= 5; k++) expect(tops.has(round(1.08 + (k * 1.07) / 6)), `block ${k}`).toBe(true);
    expect(Math.max(...zs(faces))).toBeCloseTo(1.08 + (5 * 1.07) / 6, 9);
  });

  it("an open flight 2's treads start at 1.08 + riser, with nothing below its first step's underside", () => {
    const faces = visibleFrom(faces3d(pieceOf(theL("openStair"), "f2/p0")), TO_CAMERA);
    const tops = new Set(faces.filter(flat).map((f) => round(f.points[0]?.z ?? 0)));
    for (let k = 1; k <= 5; k++) expect(tops.has(round(1.08 + (k * 1.07) / 6)), `tread ${k}`).toBe(true);
    expect(Math.min(...zs(faces))).toBeGreaterThan(1);
  });
});
