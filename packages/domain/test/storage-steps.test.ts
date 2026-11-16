import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { stairRuleOf } from "../src/kinds";
import { emptyDocument, type Document } from "../src/model";
import { stairChecks } from "../src/queries/stair-checks";
import { stairEdges } from "../src/queries/stair-edge";
import { risersFor } from "../src/queries/stairs";
import { rectangleRoom } from "../src/scripts";
import { STAIR_RULES } from "../src/stairs";

// Storage steps (steps.03, .09, AC-01): two or three deep steps up to a low platform, a drawer in each riser.

const run = (doc: Document, cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);

/** An 8 m square room with a 2.00 × 1.40 deck at `top` (x 0.60–2.60, y 4.80–6.20), a platform or a loft: room for 12 deep steps. */
function withDeck(top: number): { doc: Document; deck: string } {
  const doc = run(emptyDocument(), [
    ...rectangleRoom({ x: 0.37, y: 0.21 }, 8, 8, "r"),
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "d", preset: top >= 1.2 ? "loft" : "platform", at: { x: 1.6, y: 5.5 }, w: 2, d: 1.4, name: "Deck" },
  ]);
  return { doc: run(doc, [{ type: "setDeck", deckId: "d/k0", top }]), deck: "d/k0" };
}

/** Storage steps drawn up to the deck's front edge (y 4.80) at x 1.6, standing on the floor. */
function stepsTo(top: number): { doc: Document; object: string } {
  const { doc, deck } = withDeck(top);
  const edge = stairEdges(doc, null, 0.6).find((e) => e.deck === deck && e.normal.y === -1);
  if (!edge) throw new Error("no front edge");
  const placed = run(doc, [{ type: "placeStair", opId: "st", state: "s0", kind: "storageSteps", deck, at: { x: 1.6, y: edge.a.y }, shape: "straight", surface: null }]);
  const object = Object.values(placed.objects).find((o) => o.kind === "storageSteps");
  if (!object) throw new Error("not placed");
  return { doc: placed, object: object.id };
}

const size = (doc: Document, id: string) => {
  const o = doc.objects[id];
  return { d: o?.d.standard, h: o?.h.standard };
};
const risers = (doc: Document, id: string): number => {
  const o = doc.objects[id];
  const rule = o ? stairRuleOf(o.kind) : null;
  return rule && o ? risersFor(rule, o.h.standard ?? 0, o.riser ?? null) : 0;
};

describe("Storage steps (AC-01)", () => {
  it("rule: a straight flight of 0.35 m treads, 0.19 risers at most, never an L", () => {
    const rule = STAIR_RULES.drawers;
    expect(rule.shape).toBe("flight");
    expect(rule.maxRiser).toBe(0.19);
    expect(rule.going).toEqual({ kind: "step", length: 0.63, min: 0.35, max: 0.35 });
    expect(rule.turns).toBe(false);
    expect(rule.minRisers).toBe(2);
    expect(stairRuleOf("storageSteps")).toBe(rule);
  });

  it.each([
    [0.45, 3, 0.7],
    [0.3, 2, 0.35],
    [0.55, 3, 0.7],
  ])("risers and run at a %s m platform's edge: %i risers over %s m, no warning", (top, n, run) => {
    const { doc, object } = stepsTo(top);
    expect(risers(doc, object)).toBe(n);
    expect(size(doc, object).d).toBeCloseTo(run, 6);
    expect(size(doc, object).h).toBeCloseTo(top, 6);
    expect(stairChecks(doc, object).filter((c) => !c.ok)).toEqual([]);
  });

  it("rise warning: up to a 2.15 m loft the steps warn that they are for platforms", () => {
    const { doc, object } = stepsTo(2.15);
    const failing = stairChecks(doc, object).filter((c) => !c.ok);
    // Headroom warns for every stair to a loft under 3.20 (stairs.05); the rise warning is the steps' own.
    expect(failing.map((c) => c.id)).toEqual(["rise", "headroom"]);
    expect(failing[0]).toMatchObject({ id: "rise", value: 2.15, min: null, max: 0.76 });
  });

  it("start with no handrails up to a platform (no higher than 0.76, as its guard) and with Railing up to a loft (steps.16)", () => {
    const low = stepsTo(0.45);
    expect(low.doc.objects[low.object]?.handrails).toEqual({ left: "none", right: "none" });
    const high = stepsTo(2.15);
    expect(high.doc.objects[high.object]?.handrails).toEqual({ left: "railing", right: "railing" });
  });

  it("minRisers is the rule's: a rule asking five risers gets five for a tiny rise", () => {
    expect(risersFor({ ...STAIR_RULES.solid, minRisers: 5 }, 0.1, null)).toBe(5);
    expect(risersFor(STAIR_RULES.solid, 0.1, null)).toBe(2);
  });
});
