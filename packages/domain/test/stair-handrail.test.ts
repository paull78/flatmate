import { describe, expect, it } from "vitest";
import { isRecord, parseStoredDocument, unwrap } from "@fm/protocol";
import {
  emptyDocument, execute, flightHandrails, fromStored, rectangleRoom, spiralRails, toStored, validateDocument, type Command, type Document, type LayoutObject,
} from "../src";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { pitchLineOf } from "../src/queries/underside";

// A stair's handrail setting (AC-13, guards.28): Railing or Glass, stored on a stair that has rails, chosen once when it's
// placed from the deck it reaches and kept. The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5, top 2.15; a stair's back
// edge on its edge at (2.1, 3) runs +x.

const LOFT = "l/k0";
const STAIR = "ps/s0/o0";
const build = (...cmds: Command[]): Document => {
  let doc = emptyDocument();
  for (const c of cmds) {
    const r = execute(doc, c);
    if (!r.ok) throw new Error(`${c.type}: ${r.error.message}`);
    doc = r.value.doc;
  }
  return doc;
};
const room = (...more: Command[]): Document => build(
  ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
  { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 3 }, w: 2, d: 3 },
  ...more,
);
const guard = (g: "railing" | "glass" | "none"): Command => ({ type: "setDeck", deckId: LOFT, guard: g });
const place = (kind = "stair", shape: "straight" | "l-right" = "straight"): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y: 3 }, shape });
const object = (doc: Document, id = STAIR): LayoutObject => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no ${id}`);
  return o;
};
/** A spiral's one rail; a flight's when both sides agree, else both (edges.06). */
const handrailOf = (doc: Document, id = STAIR): unknown => {
  const o = object(doc, id);
  const s = o.handrails;
  return s === undefined ? o.handrail : s.left === s.right ? s.left : s;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "" : r.error.message;
};
/** A free stair in the room's open floor, reaching nothing. */
const free: Command = { type: "placeObject", opId: "f", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 2 } }, at: { x: 6, y: 5.8 }, rotation: 0, deck: null };

describe("chosen once when it's placed", () => {
  it.each([["glass", "glass"], ["railing", "railing"], ["none", "railing"]] as const)("on a %s loft a stair starts %s", (g, want) => {
    expect(handrailOf(room(guard(g), place()))).toBe(want);
  });

  it("an L's two flights both take the loft's, though the lower one reaches the landing", () => {
    const doc = room(guard("glass"), place("stair", "l-right"));
    expect(handrailOf(doc, "ps/s0/o0")).toBe("glass");
    expect(handrailOf(doc, "ps/s1/o0")).toBe("glass");
    expect(doc.decks["ps/k0"]?.guardFront.kind).not.toBe("glass");
  });

  it("a spiral takes it; a rung ladder has none, and no field", () => {
    expect(handrailOf(room(guard("glass"), place("spiralStair")))).toBe("glass");
    expect(Object.keys(object(room(guard("glass"), place("rungLadder"))))).not.toContain("handrail");
  });

  it.each(["openStair", "storageStair", "shipsLadder", "alternatingTread"])("a %s takes it", (kind) => {
    expect(handrailOf(room(guard("glass"), place(kind)))).toBe("glass");
  });

  it("placed as an object, it goes by the deck it reaches, and Railing reaching nothing", () => {
    const linked: Command = { type: "placeObject", opId: "o", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 2.988 } }, at: { x: 2.1, y: 3 }, rotation: 90, deck: null, reaches: LOFT };
    expect(handrailOf(room(guard("glass"), linked), "o/o0")).toBe("glass");
    expect(handrailOf(room(guard("glass"), free), "f/o0")).toBe("railing");
  });

  it("given one, placeStair takes it over the loft's, and refuses a bad one with its reason", () => {
    expect(handrailOf(room(guard("glass"), { ...place(), handrail: "railing" } as Command))).toBe("railing");
    expect(handrailOf(room({ ...place(), handrail: "glass" } as Command))).toBe("glass");
    expect(handrailOf(room(guard("glass"), { ...place("stair", "l-right"), handrail: "railing" } as Command), "ps/s1/o0")).toBe("railing");
    expect(refusal(room(), { ...place(), handrail: "wood" } as unknown as Command)).toBe("Invalid handrail: railing, glass or none");
  });
});

describe("kept", () => {
  it("when the loft's guard changes afterwards", () => {
    const doc = room(guard("glass"), place(), guard("railing"));
    expect(handrailOf(doc)).toBe("glass");
    expect(handrailOf(room(place(), guard("glass")))).toBe("railing");
  });

  it("when the stair moves or stops reaching the loft", () => {
    const moved = room(guard("glass"), place(), { type: "movePlacement", placementId: "ps/s0/p0", at: { x: 2.1, y: 2.8 }, rotation: 90 });
    expect(handrailOf(moved)).toBe("glass");
    const later = room(guard("glass"), place(), guard("railing"), { type: "movePlacement", placementId: "ps/s0/p0", at: { x: 2.1, y: 2.8 }, rotation: 90 });
    expect(handrailOf(later)).toBe("glass"); // not picked again from the deck as it is now
    expect(handrailOf(room(guard("glass"), place(), { type: "setStairReaches", objectId: STAIR, deck: null }))).toBe("glass");
  });

  it("by a duplicate", () => {
    const doc = room(free, { type: "setStair", objectId: "f/o0", handrail: "glass" }, { type: "duplicatePlacements", opId: "dup", copies: [{ placementId: "f/p0", at: { x: 4.5, y: 5.8 }, rotation: 0 }] });
    expect(handrailOf(doc, "dup/o0")).toBe("glass");
  });

  it("switching to a rung ladder drops it; switching back picks it again from the deck", () => {
    const ladder = room(guard("glass"), place(), { type: "setObjectKind", objectId: STAIR, kind: "rungLadder" });
    expect(Object.keys(object(ladder))).not.toContain("handrail");
    expect(handrailOf(room(guard("glass"), place(), { type: "setObjectKind", objectId: STAIR, kind: "openStair" }))).toBe("glass");
    expect(handrailOf(room(guard("glass"), place("rungLadder"), { type: "setObjectKind", objectId: STAIR, kind: "stair" }))).toBe("glass");
  });
});

describe("setStair", () => {
  it("sets it, and only it", () => {
    const before = room(place());
    const doc = unwrap(execute(before, { type: "setStair", objectId: STAIR, handrail: "glass" })).doc;
    expect(object(doc)).toEqual({ ...object(before), handrails: { left: "glass", right: "glass" } });
    expect(handrailOf(unwrap(execute(doc, { type: "setStair", objectId: STAIR, riser: 0.16 })).doc)).toBe("glass");
  });

  it("refuses a bad value with its reason", () => {
    expect(refusal(room(place()), { type: "setStair", objectId: STAIR, handrail: "wood" } as unknown as Command)).toBe("Invalid handrail: railing, glass or none");
  });

  it("a rung ladder takes none", () => {
    expect(refusal(room(place("rungLadder")), { type: "setStair", objectId: STAIR, handrail: "glass" })).toBe("Rung ladder has no handrail");
  });
});

describe("an older stored stair, with no field", () => {
  /** The stored drawing with every object's handrail taken out, and the decks' guards too when `guards` is false. */
  const without = (doc: Document, guards = true): Record<string, unknown> => {
    const json: Record<string, unknown> = { ...serialize(doc) };
    const strip = (table: unknown, ...keys: string[]): unknown => isRecord(table)
      ? Object.fromEntries(Object.entries(table).map(([id, row]) => {
        const rest: Record<string, unknown> = isRecord(row) ? { ...row } : {};
        for (const key of keys) delete rest[key];
        return [id, rest];
      }))
      : table;
    return { ...json, objects: strip(json.objects, "handrail", "handrails"), ...(guards ? {} : { decks: strip(json.decks, "guardFront", "guardRight", "guardBack", "guardLeft") }) };
  };
  const loaded = (json: Record<string, unknown>): Document => unwrap(deserialize(json));
  const fromServer = (json: Record<string, unknown>): Document => {
    const stored = parseStoredDocument(json);
    if (!stored) throw new Error("not a stored document");
    return unwrap(fromStored(upgradeStored(stored)));
  };

  it.each([["a file", loaded], ["the server's", fromServer]] as const)("%s reads its deck's setting once on load, and one with no deck Railing", (_, load) => {
    const doc = room(guard("glass"), place(), free);
    const back = load(without(doc));
    expect(handrailOf(back)).toBe("glass");
    expect(handrailOf(back, "f/o0")).toBe("railing");
    expect(validateDocument(back).ok).toBe(true);
  });

  it.each([["a file", loaded], ["the server's", fromServer]] as const)("%s gives an L's two flights the loft's, as placing does, though the lower one reaches the landing", (_, load) => {
    const l = load(without(room(guard("glass"), place("stair", "l-right"))));
    expect(l.decks["ps/k0"]?.guardFront.kind).not.toBe("glass");
    expect(handrailOf(l, "ps/s0/o0")).toBe("glass");
    expect(handrailOf(l, "ps/s1/o0")).toBe("glass");
  });

  it("a rung ladder gets none", () => {
    expect(Object.keys(object(loaded(without(room(guard("glass"), place("rungLadder"))))))).not.toContain("handrail");
  });

  it("a deck stored with no guard is read by its top first", () => {
    expect(handrailOf(loaded(without(room(guard("glass"), place()), false)))).toBe("railing");
  });

  it("a stored value is kept on load, however the deck is set now", () => {
    expect(handrailOf(loaded(serialize(room(place(), guard("glass")))))).toBe("railing");
  });

  it("past loading, a row must have it: a stair with none or a ladder with one is refused", () => {
    const doc = room(guard("glass"), place());
    const stored = toStored(doc);
    const bare: LayoutObject = { ...object(doc) };
    delete bare.handrails;
    expect(fromStored({ ...stored, objects: { ...stored.objects, [STAIR]: bare } }).ok).toBe(false);
    const ladder = room(place("rungLadder"));
    const ladderStored = toStored(ladder);
    expect(fromStored({ ...ladderStored, objects: { ...ladderStored.objects, [STAIR]: { ...object(ladder), handrail: "railing" } } }).ok).toBe(false);
    const wood: Record<string, unknown> = { ...object(doc), handrail: "wood" };
    expect(fromStored(parseStoredDocument({ ...stored, objects: { ...stored.objects, [STAIR]: wood } }) ?? stored).ok).toBe(false);
  });
});

describe("the rails the views read", () => {
  it("a flight's rows carry the setting, and each knot its pitch line's height", () => {
    const doc = room(guard("glass"), place());
    const rails = flightHandrails(doc).get(STAIR) ?? [];
    expect(rails).toHaveLength(2);
    const line = pitchLineOf(doc, "ps/s0/p0");
    for (const r of rails) {
      expect(r.kind).toBe("glass");
      for (const k of r.knots) expect(k.foot).toBeCloseTo(line?.at(k.a) ?? Number.NaN, 6);
    }
    expect((flightHandrails(room(place())).get(STAIR) ?? []).map((r) => r.kind)).toEqual(["railing", "railing"]);
  });

  it("a spiral's carry it, and its knots the treads' line, 0.90 under the rail where the ceiling doesn't cut it", () => {
    const rails = spiralRails(room(guard("glass"), place("spiralStair"))).get(STAIR);
    expect(rails?.kind).toBe("glass");
    for (const k of rails?.knots ?? []) expect(k.foot).toBeCloseTo(k.top - 0.9, 6);
    expect(spiralRails(room(place("spiralStair"))).get(STAIR)?.kind).toBe("railing");
  });
});
