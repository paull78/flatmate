import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { armsFit } from "../src/arms";
import { execute } from "../src/commands/execute";
import { kindOf } from "../src/kinds";
import { placementFit } from "../src/queries/fit";
import { freeFloor } from "../src/queries/free-floor";
import type { Document } from "../src/model";
import { parseLayoutObject } from "../src/shape";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// An `L` object stores its arms (catalog.17): only `ell` kinds, always present on them; a new one takes its kind's
// default; a copy keeps them; arms that break the rule are refused.

const ARM_RULE = "An arm must be 0.10 m or more and 0.10 m shallower than the side it runs across";

/** A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a corner desk "k" against the back wall: x 2.2–3.8, y 3.7–4.9. */
const withDesk = (): Document => place(rectDoc(0, 0, 6, 5), { object: "k", kind: "cornerDesk", at: [3, 4.9] });

describe("corner desk objects", () => {
  it("placeObject gives a new corner desk its kind's arms, 0.60 and 0.60", () => {
    const doc = unwrap(execute(rectDoc(0, 0, 6, 5), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "cornerDesk" }, at: { x: 3, y: 4.9 } })).doc;
    expect(doc.objects["a/o0"]).toMatchObject({ kind: "cornerDesk", w: { standard: 1.6 }, d: { standard: 1.2 }, arms: { back: 0.6, left: 0.6 } });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("other kinds get no arms", () => {
    const doc = unwrap(execute(rectDoc(0, 0, 6, 5), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 4.9 } })).doc;
    expect(doc.objects["a/o0"]).not.toHaveProperty("arms");
  });

  it("a stored corner desk needs its arms, and a desk may not have any", () => {
    const desk = withDesk().objects.k;
    if (!desk) throw new Error("no desk");
    expect(parseLayoutObject(desk)).toEqual(desk);
    const bare = { id: desk.id, kind: desk.kind, name: desk.name, w: desk.w, d: desk.d, h: desk.h, z: desk.z };
    expect(parseLayoutObject(bare)).toBeNull();
    expect(parseLayoutObject({ ...desk, arms: { back: 0.6 } })).toBeNull();
    expect(parseLayoutObject({ ...desk, arms: { back: "0.6", left: 0.6 } })).toBeNull();
    const plain = { id: "d", kind: "desk", name: "Desk", w: { standard: 1.2 }, d: { standard: 0.6 }, h: { standard: 0.75 }, z: { standard: 0 } };
    expect(parseLayoutObject(plain)).toEqual(plain);
    expect(parseLayoutObject({ ...plain, arms: { back: 0.3, left: 0.3 } })).toBeNull();
  });

  it("duplicatePlacements copies the arms", () => {
    const doc = withDesk();
    const desk = doc.objects.k;
    if (!desk) throw new Error("no desk");
    const custom = { ...doc, objects: { ...doc.objects, k: { ...desk, arms: { back: 0.5, left: 0.7 } } } };
    const out = unwrap(execute(custom, { type: "duplicatePlacements", opId: "d", copies: [{ placementId: "k/s0", at: { x: 3, y: 2.9 }, rotation: 0 }] })).doc;
    expect(out.objects["d/o0"]?.arms).toEqual({ back: 0.5, left: 0.7 });
    expect(out.objects["d/o0"]?.arms).not.toBe(custom.objects.k?.arms);
  });

  it("takes w·t1 + t2·(d − t1) of free floor, with its own arms", () => {
    const empty = [...freeFloor(rectDoc(0, 0, 6, 5), "s0").values()][0] ?? Number.NaN;
    const doc = withDesk();
    expect([...freeFloor(doc, "s0").values()][0]).toBeCloseTo(empty - 1.32, 9); // 1.6·0.6 + 0.6·0.6
    const desk = doc.objects.k;
    if (!desk) throw new Error("no desk");
    const custom = { ...doc, objects: { ...doc.objects, k: { ...desk, arms: { back: 0.5, left: 0.7 } } } };
    expect([...freeFloor(custom, "s0").values()][0]).toBeCloseTo(empty - (1.6 * 0.5 + 0.7 * 0.7), 9);
  });

  it("validation refuses arms that break the rule, with its message", () => {
    const doc = withDesk();
    const desk = doc.objects.k;
    if (!desk) throw new Error("no desk");
    const withArms = (back: number, left: number): Document => ({ ...doc, objects: { ...doc.objects, k: { ...desk, arms: { back, left } } } });
    expect(validateDocument(withArms(0.65, 0.65)).ok).toBe(true);
    for (const [back, left] of [[1.15, 0.6], [0.6, 1.55], [0.05, 0.6], [0.6, 0.0999]] as const) {
      const result = validateDocument(withArms(back, left));
      expect(result.ok, `${back} / ${left}`).toBe(false);
      if (!result.ok) expect(result.error.map((v) => v.message).join("\n"), `${back} / ${left}`).toContain(ARM_RULE);
    }
  });
});

describe("a new `L` piece at a size of its own (sizing step 04, sizing.04)", () => {
  const ELLS = ["cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa"];
  const placeSized = (kind: string, w: number, d: number) =>
    execute(rectDoc(0, 0, 8, 8), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind, size: { w, d } }, at: { x: 4, y: 7.9 } });
  const mm = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

  for (const kind of ELLS) {
    it.each([[0.6, 0.6], [0.8, 0.8], [1, 2], [0.63, 0.47]])(`${kind} at %s × %s is placed with its arms clamped into the box, on the millimetre`, (w, d) => {
      const r = placeSized(kind, w, d);
      expect(r.ok).toBe(true);
      const arms = r.ok ? r.value.doc.objects["a/o0"]?.arms : undefined;
      if (!arms) throw new Error("no arms");
      expect(armsFit(arms, w, d)).toBe(true);
      expect(mm(arms.back) && mm(arms.left)).toBe(true);
    });

    it(`${kind} at its default size keeps its kind's arms`, () => {
      const r = execute(rectDoc(0, 0, 8, 8), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind }, at: { x: 4, y: 7.9 } });
      expect(r.ok && r.value.doc.objects["a/o0"]?.arms).toEqual(kindOf(kind)?.arms);
    });
  }

  it("a box too small for any arm (0.15 × 0.15) is refused with the arm rule", () => {
    const r = placeSized("cornerDesk", 0.15, 0.15);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.message).toBe(ARM_RULE);
  });

  it("placementFit says no where the arms can't fit, and yes at 0.60 × 0.60", () => {
    const doc = rectDoc(0, 0, 8, 8);
    const at = { x: 4, y: 4 };
    expect(placementFit(doc, { kind: "cornerSofa", state: "s0", at, rotation: 0, config: "standard", w: 0.15, d: 0.15, surface: null }).fits).toBe(false);
    expect(placementFit(doc, { kind: "cornerSofa", state: "s0", at, rotation: 0, config: "standard", w: 0.6, d: 0.6, surface: null }).fits).toBe(true);
  });
});

describe("a winder's depth in the shared size check (sizing.32)", () => {
  it("placementFit says no to a winder wider than deep, yes to one 0.05 m deeper than wide", () => {
    const doc = rectDoc(0, 0, 8, 8);
    const at = { x: 4, y: 4 };
    expect(placementFit(doc, { kind: "winderStair", state: "s0", at, rotation: 0, config: "standard", w: 1.4, d: 0.6, surface: null }).fits).toBe(false);
    expect(placementFit(doc, { kind: "winderStair", state: "s0", at, rotation: 0, config: "standard", w: 0.8, d: 0.85, surface: null }).fits).toBe(true);
  });
});
