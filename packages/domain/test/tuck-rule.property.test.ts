import { describe, expect, it } from "vitest";
import type { Document } from "../src/model";
import { placementFit } from "../src/queries/fit";
import { tucks } from "../src/queries/tucks";
import { validateDocument } from "../src/validate";
import { place, rectDoc, rng } from "./helpers";

// The tuck rule's two paths agree (spec "Testing approach", ux-polish.12): for seeded random chair poses around a desk
// and a round table, placementFit says the chair fits exactly when validation reports no I10 or I11 naming it.
//
// The room: 4 × 4 m (inner faces 0.1 and 3.9). The desk against the top wall (x 1.4–2.6, y 3.3–3.9); the round table
// (Ø 0.90) centred at (1.5, 1.5); a second desk in another layout, which must never matter.

const base = (): Document => {
  let doc = place(rectDoc(0, 0, 4, 4), { object: "desk", kind: "desk", at: [2, 3.9] });
  doc = place(doc, { object: "round", kind: "roundTable", at: [1.5, 1.95] });
  return place(doc, { object: "other", kind: "desk", at: [1.5, 1.8], state: "s1" });
};

describe("tuck rule: placementFit agrees with validation", () => {
  it("for 600 seeded chair poses around a desk and a round table", () => {
    const doc = base();
    expect(validateDocument(doc).ok).toBe(true);
    const next = rng(20261029);
    // Poses near the desk's front edge and around the round table, every rotation.
    const around = (): [number, number] =>
      next() < 0.5 ? [1.2 + next() * 1.6, 2.7 + next() * 1.0] : [1.5 + (next() - 0.5) * 1.6, 1.5 + (next() - 0.5) * 1.6];
    const failures: string[] = [];
    const seen = { fits: 0, refused: 0, tucked: 0 };
    for (let i = 0; i < 600; i++) {
      const at = around();
      const rotation = next() < 0.3 ? 90 * Math.floor(next() * 4) : Math.round(next() * 360);
      const placed = place(doc, { object: "chair", kind: "chair", at, rotation });
      const r = validateDocument(placed);
      const named = r.ok ? [] : r.error.filter((v) => (v.invariant === "I10" || v.invariant === "I11") && v.entities.some((e) => e.id === "chair/s0"));
      const fits = placementFit(doc, { kind: "chair", state: "s0", at: { x: at[0], y: at[1] }, rotation, config: "standard", surface: null }).fits;
      if (fits !== (named.length === 0)) failures.push(`#${i} at ${at.join(", ")} r ${rotation}: fit ${fits}, validation ${named.map((v) => v.message).join("; ")}`);
      if (fits) seen.fits++;
      else seen.refused++;
      if (fits && tucks(placed).length > 0) seen.tucked++;
    }
    expect(failures).toEqual([]);
    // The stream exercises both answers, and tucked chairs among those that fit.
    expect(seen.fits).toBeGreaterThan(50);
    expect(seen.refused).toBeGreaterThan(50);
    expect(seen.tucked).toBeGreaterThan(20);
  });
});
