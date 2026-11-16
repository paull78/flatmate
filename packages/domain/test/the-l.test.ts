import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { emptyDocument, type Document } from "../src/model";
import { levels } from "../src/queries/levels";
import { stairBase, stairGeometry } from "../src/queries/stairs";
import { placementRange } from "../src/queries/vertical";
import { stairRuleOf } from "../src/kinds";
import { validateDocument } from "../src/validate";
import { LOFT, PLATFORM, THE_L, startingAtPlatform } from "./the-l";

// AC-07: the L of three pieces, a flight to a 0.90 × 0.90 platform at +1.08 and a second flight from the platform's
// edge to the loft; no new kind, no shortcut (stairs.16).

const theL = (): Document => startingAtPlatform(THE_L.reduce((d, c) => unwrap(execute(d, c)).doc, emptyDocument()));
const numbers = (doc: Document, placement: string) => {
  const p = doc.placements[placement];
  const o = p ? doc.objects[p.object] : undefined;
  const rule = o ? stairRuleOf(o.kind) : null;
  const range = placementRange(doc, placement);
  const base = stairBase(doc, placement);
  if (!p || !o || !rule || !range || base === null) throw new Error("no stair");
  return stairGeometry(rule, o.w[p.config] ?? 0, o.d[p.config] ?? 0, range.top - base, null);
};

describe("the L (AC-07)", () => {
  it("flight 1 to the platform: 6 risers of 0.180; flight 2 from the platform to the loft: 6 risers of 0.178", () => {
    const doc = theL();
    expect(validateDocument(doc).ok).toBe(true);
    expect(doc.objects["f1/o0"]).toMatchObject({ reaches: PLATFORM, startsAt: null, h: { standard: 1.08 } });
    expect(doc.objects["f2/o0"]).toMatchObject({ reaches: LOFT, startsAt: PLATFORM, h: { standard: 2.15 } });
    const [f1, f2] = [numbers(doc, "f1/p0"), numbers(doc, "f2/p0")];
    expect([f1.risers, f1.riser]).toEqual([6, expect.closeTo(0.18, 9)]);
    expect([f2.risers, f2.riser]).toEqual([6, expect.closeTo(0.178, 3)]);
    expect(f2.rise).toBeCloseTo(1.07, 9);
  });

  it("the landing is below the floor's cut, so it isn't a level: the levels are the floor and the loft", () => {
    expect(levels(theL()).map((l) => l.deckIds)).toEqual([[], [LOFT]]);
  });
});
