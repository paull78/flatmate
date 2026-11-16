import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import type { Arms } from "../src/arms";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { validateDocument } from "../src/validate";
import { deepFreeze, place, rectDoc } from "./helpers";

// The arms travel in the size command (catalog.18): setObjectSize carries the final width, depth and arms, checked
// once, so "shrink plus a thinner arm" and "grow plus a thicker arm" both work as one edit.

const ARM_RULE = "An arm must be 0.10 m or more and 0.10 m shallower than the side it runs across";

/** A 6 × 5 room (inner faces at 0.1 and 5.9 / 4.9) with a corner desk "k" against the back wall: x 2.2–3.8, y 3.7–4.9. */
const withDesk = (): Document => deepFreeze(place(rectDoc(0, 0, 6, 5), { object: "k", kind: "cornerDesk", at: [3, 4.9] }));
const size = (d: number | null, arms?: Arms, objectId = "k"): Command => ({
  type: "setObjectSize", objectId, w: 1.6, d: d === null ? {} : { standard: d }, ...(arms ? { arms } : {}),
});

describe("arms in setObjectSize (catalog.18)", () => {
  it("sets the back arm alone, and both arms", () => {
    const back = unwrap(execute(withDesk(), size(null, { back: 0.5, left: 0.6 })));
    expect(back.doc.objects.k).toMatchObject({ w: { standard: 1.6 }, d: { standard: 1.2 }, arms: { back: 0.5, left: 0.6 } });
    const both = unwrap(execute(withDesk(), size(null, { back: 0.4, left: 0.75 })));
    expect(both.doc.objects.k?.arms).toEqual({ back: 0.4, left: 0.75 });
  });

  it("refuses arms on a desk, which has none", () => {
    const doc = deepFreeze(place(rectDoc(0, 0, 6, 5), { object: "d", kind: "desk", at: [3, 4.9] }));
    const r = execute(doc, { type: "setObjectSize", objectId: "d", w: 1.2, d: {}, arms: { back: 0.3, left: 0.3 } });
    expect(r).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Only a corner piece has arms" } });
  });

  it("refuses arms that aren't two finite numbers (commands come from JSON)", () => {
    const bad: unknown[] = [{ back: Number.NaN, left: 0.6 }, { back: 0.6 }, { back: 0.6, left: 0.6, right: 0.6 }, null];
    for (const arms of bad) {
      const r = execute(withDesk(), JSON.parse(JSON.stringify({ ...size(null), arms })));
      expect(r.ok, JSON.stringify(arms)).toBe(false);
    }
  });

  it("refuses an arm under 0.10 m or less than 0.10 m shallower than its side, with the arm message", () => {
    for (const arms of [{ back: 0.05, left: 0.6 }, { back: 1.15, left: 0.6 }, { back: 0.6, left: 0.05 }, { back: 0.6, left: 1.55 }]) {
      const r = execute(withDesk(), size(null, arms));
      expect(r, JSON.stringify(arms)).toMatchObject({ ok: false, error: { message: ARM_RULE } });
    }
  });

  it("the same arms and sizes are a no-op patch", () => {
    const doc = withDesk();
    const r = unwrap(execute(doc, size(1.2, { back: 0.6, left: 0.6 })));
    expect(r.doc).toBe(doc);
    expect(r.patch.puts).toEqual([]);
    expect(r.patch.deletes).toEqual([]);
  });

  it("one undo restores the old arms and sizes", () => {
    const doc = withDesk();
    const r = unwrap(execute(doc, size(0.9, { back: 0.5, left: 0.7 })));
    expect(r.doc.objects.k).toMatchObject({ d: { standard: 0.9 }, arms: { back: 0.5, left: 0.7 } });
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
  });

  it("shrink plus a thinner arm, depth 1.20 → 0.65 with back 0.60 → 0.40, is one accepted edit; the shrink alone is refused", () => {
    const r = unwrap(execute(withDesk(), size(0.65, { back: 0.4, left: 0.6 })));
    expect(r.doc.objects.k).toMatchObject({ d: { standard: 0.65 }, arms: { back: 0.4, left: 0.6 } });
    expect(validateDocument(r.doc).ok).toBe(true);
    expect(execute(withDesk(), size(0.65))).toMatchObject({ ok: false, error: { message: ARM_RULE } });
  });

  it("grow plus a thicker arm, depth 1.20 → 1.60 with back 0.60 → 1.20, is one accepted edit; the thicker arm alone is refused", () => {
    const r = unwrap(execute(withDesk(), size(1.6, { back: 1.2, left: 0.6 })));
    expect(r.doc.objects.k).toMatchObject({ d: { standard: 1.6 }, arms: { back: 1.2, left: 0.6 } });
    expect(validateDocument(r.doc).ok).toBe(true);
    expect(execute(withDesk(), size(null, { back: 1.2, left: 0.6 }))).toMatchObject({ ok: false, error: { message: ARM_RULE } });
  });

  it("refuses a back arm that would reach a chair standing in the empty quarter (fit counts)", () => {
    // The chair: x 3.0–3.45, y 3.75–4.2, in the quarter (x 2.8–3.8, y 3.7–4.3). A 0.80 back arm reaches down to y 4.1.
    const doc = deepFreeze(place(withDesk(), { object: "c", kind: "chair", at: [3.225, 4.2] }));
    expect(validateDocument(doc).ok).toBe(true);
    expect(execute(doc, size(null, { back: 0.65, left: 0.6 })).ok).toBe(true);
    const r = execute(doc, size(null, { back: 0.8, left: 0.6 }));
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid" } });
    if (!r.ok) expect(r.error.violations.map((v) => v.invariant)).toEqual(["I11"]);
  });
});
