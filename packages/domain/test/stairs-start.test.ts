import { describe, expect, it } from "vitest";
import { isRecord, unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document, type LayoutObject } from "../src/model";
import { stairChecks } from "../src/queries/stair-checks";
import { stairBase, stairGeometry } from "../src/queries/stairs";
import { placementRange } from "../src/queries/vertical";
import { stairRuleOf } from "../src/kinds";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";
import { L_ROOM, LOFT, PLACED_L, PLATFORM, flight2, startingAtPlatform } from "./the-l";

// A stair starts at a deck (stairs.49, AC-07): its steps begin at that deck's top (`startsAt`); its box and stored height
// stay from its surface to its top. Only the gesture's L sets it, or deleting the deck clears it (stairdraw.08); a front
// edge touching a deck's edge sets nothing. The platform's numbers come from the hand-built L, its startsAt written
// directly (`startingAtPlatform`); the invariant and loading use the L placeStair makes (PLACED_L).

const run = (doc: Document, ...cmds: readonly Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const F2 = "f2/o0";
const P2 = "f2/p0";
const stair = (doc: Document, id = F2): LayoutObject => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no ${id}`);
  return o;
};
/** The flight's numbers from its base (the start deck's top) to its top. */
const numbers = (doc: Document, placement = P2) => {
  const p = doc.placements[placement];
  const o = p ? doc.objects[p.object] : undefined;
  const rule = o ? stairRuleOf(o.kind) : null;
  const range = placementRange(doc, placement);
  const base = stairBase(doc, placement);
  if (!p || !o || !rule || !range || base === null) throw new Error("no stair");
  return stairGeometry(rule, o.w[p.config] ?? 0, o.d[p.config] ?? 0, range.top - base, null);
};
const withFlight2 = (): Document => startingAtPlatform(run(emptyDocument(), ...L_ROOM, flight2()));

describe("starting at a deck's edge", () => {
  it("a stair that starts at the platform at +1.08 and reaches the loft: rise 1.07, 6 risers of 0.178 (AC-07)", () => {
    const doc = withFlight2();
    expect(stair(doc)).toMatchObject({ reaches: LOFT, startsAt: PLATFORM });
    expect(stairBase(doc, P2)).toBeCloseTo(1.08, 9);
    const g = numbers(doc);
    expect(g.rise).toBeCloseTo(1.07, 9);
    expect(g.risers).toBe(6);
    expect(g.riser).toBeCloseTo(0.178, 3);
  });

  it("its stored height stays 2.15, floor to loft, and its box stays from the floor", () => {
    const doc = withFlight2();
    expect(stair(doc).h.standard).toBe(2.15);
    expect(placementRange(doc, P2)).toEqual({ bottom: 0, top: 2.15 });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("placed or moved with its front edge on the platform's edge, it starts nowhere (stairdraw.08)", () => {
    const placed = run(emptyDocument(), ...L_ROOM, flight2());
    expect(stair(placed)).toMatchObject({ reaches: LOFT, startsAt: null });
    expect(numbers(placed).risers).toBe(12);
    const away = run(placed, { type: "movePlacement", placementId: P2, at: { x: 3, y: 1.0 }, rotation: 270 });
    const back = run(away, { type: "movePlacement", placementId: P2, at: { x: 3, y: 1.95 }, rotation: 270 });
    expect(stair(back).startsAt).toBeNull();
  });

  it("raising the platform to 1.20 makes it 5 risers of 0.19 (rise 0.95)", () => {
    const doc = run(withFlight2(), { type: "setDeck", deckId: PLATFORM, top: 1.2 });
    const g = numbers(doc);
    expect(g.rise).toBeCloseTo(0.95, 9);
    expect(g.risers).toBe(5);
    expect(g.riser).toBeCloseTo(0.19, 9);
    expect(stair(doc).h.standard).toBe(2.15);
  });

  it("raising the platform to the stair's top is refused", () => {
    expect(refusal(withFlight2(), { type: "setDeck", deckId: PLATFORM, top: 2.15 })).toBe("Stair must rise above Platform");
  });

  it("deleting the platform clears startsAt and the stair counts from the floor again", () => {
    const doc = run(withFlight2(), { type: "deleteEntities", ids: [{ table: "decks", id: PLATFORM }] });
    expect(stair(doc)).toMatchObject({ reaches: LOFT, startsAt: null, h: { standard: 2.15 } });
    expect(stairBase(doc, P2)).toBe(0);
    expect(numbers(doc).risers).toBe(12);
  });

  it("moved away it keeps startsAt (stairs.19's rule)", () => {
    const doc = run(withFlight2(), { type: "movePlacement", placementId: P2, at: { x: 3, y: 1.0 }, rotation: 270 });
    expect(stair(doc)).toMatchObject({ reaches: LOFT, startsAt: PLATFORM });
    expect(numbers(doc).risers).toBe(6);
  });

  it("a stair touching no deck at its front starts nowhere", () => {
    const doc = run(emptyDocument(), ...L_ROOM, { type: "placeObject", opId: "f2", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 1.2 } }, at: { x: 3, y: 0.6 }, rotation: 270, deck: null, reaches: LOFT });
    expect(stair(doc)).toMatchObject({ reaches: LOFT, startsAt: null });
    expect(stairBase(doc, P2)).toBe(0);
  });

  it("the headroom of flight 2 counts its pitch from 1.08: the ceiling 3.20 less 1.08 + 5 risers", () => {
    const head = stairChecks(withFlight2(), F2).find((c) => c.id === "headroom");
    expect(head && "value" in head ? head.value : NaN).toBeCloseTo(3.2 - (2.15 - 1.07 / 6), 6);
  });

  it("an open flight 2's underside counts from 1.08", () => {
    const doc = startingAtPlatform(run(emptyDocument(), ...L_ROOM, flight2("openStair")));
    expect(stair(doc).startsAt).toBe(PLATFORM);
    const g = numbers(doc);
    expect(g.risers).toBe(6);
  });
});

describe("the startsAt invariant and loading", () => {
  const UPPER = "ps/s0/o0";
  const placedL = (): Document => run(emptyDocument(), ...PLACED_L);
  const withStair = (doc: Document, patch: Partial<LayoutObject>): Document => ({ ...doc, objects: { ...doc.objects, [UPPER]: { ...stair(doc, UPPER), ...patch } } });

  it("placeStair's L is valid, its upper flight starting at the landing", () => {
    const doc = placedL();
    expect(validateDocument(doc).ok).toBe(true);
    expect(stair(doc, UPPER)).toMatchObject({ reaches: LOFT, startsAt: "ps/k0" });
    expect(numbers(doc, "ps/s0/p0").risers).toBe(6);
  });

  it("I19 refuses startsAt to a missing deck", () => {
    const r = validateDocument(withStair(placedL(), { startsAt: "gone" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.map((v) => v.invariant)).toContain("I19");
  });

  it("I19 refuses startsAt to a deck at or above the stair's top", () => {
    expect(validateDocument(withStair(placedL(), { startsAt: LOFT })).ok).toBe(false);
  });

  it("an old stair row without startsAt loads as null", () => {
    const json = serialize(placedL());
    const objects = isRecord(json.objects) ? json.objects : {};
    const row = objects[UPPER];
    if (!isRecord(row)) throw new Error("no row");
    const old = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "startsAt"));
    expect(old).not.toHaveProperty("startsAt");
    const loaded = unwrap(deserialize({ ...json, objects: { ...objects, [UPPER]: old } }));
    expect(stair(loaded, UPPER).startsAt).toBeNull();
  });

  it("a saved stair keeps its startsAt", () => {
    expect(stair(unwrap(deserialize(serialize(placedL()))), UPPER).startsAt).toBe("ps/k0");
  });
});
