import { describe, expect, it } from "vitest";
import { parseStoredDocument, unwrap } from "@fm/protocol";
import { emptyDocument, execute, flightHandrails, rectangleRoom, spiralRails, toStored, fromStored, validateDocument, type Command, type Document, type LayoutObject } from "../src";
import { deserialize, serialize, upgradeStored } from "../src/serialize";

// A flight's rails per side (edges.06; AC-05, AC-08, AC-09): left and right walking up, each Railing, Glass or None; an
// L's flights share each side; a spiral keeps one, now with None; a new stair reads the guard where its top arrives.
// The 8 × 6 room's loft is at x 0.1–2.1, y 1.5–4.5, top 2.15; a stair placed at (2.1, 3) arrives on its right side (+x).
// Left and right are as you walk up: a rail's x across the flight is negative on its left (handrails.ts).

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
const place = (kind = "stair", shape: "straight" | "l-right" = "straight", y = 3): Command => ({ type: "placeStair", opId: "ps", state: "s0", kind, surface: null, deck: LOFT, at: { x: 2.1, y }, shape });
const object = (doc: Document, id = STAIR): LayoutObject => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no ${id}`);
  return o;
};
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
/** A free stair in the room's open floor, reaching nothing, with walls on neither long side. */
const free: Command = { type: "placeObject", opId: "f", state: "s0", object: { kind: "stair", size: { w: 0.9, d: 2 } }, at: { x: 6, y: 5.8 }, rotation: 0, deck: null };
const FREE = "f/o0";
/** The rails a flight draws, by side: x < 0 is its left (handrails.ts). */
const drawn = (doc: Document, id: string): { left: string[]; right: string[] } => {
  const rails = flightHandrails(doc).get(id) ?? [];
  return { left: rails.filter((r) => r.x < 0).map((r) => r.kind), right: rails.filter((r) => r.x > 0).map((r) => r.kind) };
};

describe("what a flight stores", () => {
  it("a new flight stores left and right, and no single handrail", () => {
    const o = object(room(place()));
    expect(o.handrails).toEqual({ left: "railing", right: "railing" });
    expect(o).not.toHaveProperty("handrail");
  });

  it("a spiral stores one handrail; a rung ladder neither", () => {
    expect(object(room(place("spiralStair"))).handrail).toBe("railing");
    expect(object(room(place("spiralStair")))).not.toHaveProperty("handrails");
    const ladder = object(room(place("rungLadder")));
    expect(ladder).not.toHaveProperty("handrail");
    expect(ladder).not.toHaveProperty("handrails");
  });
});

describe("each side drawn by its own setting (AC-08)", () => {
  it("left Railing, right None: a rail on the left only", () => {
    const doc = room(free, { type: "setStair", objectId: FREE, handrailRight: "none" });
    expect(object(doc, FREE).handrails).toEqual({ left: "railing", right: "none" });
    expect(drawn(doc, FREE)).toEqual({ left: ["railing"], right: [] });
  });

  it("left Glass, right Railing: each side its own kind", () => {
    const doc = room(free, { type: "setStair", objectId: FREE, handrailLeft: "glass" });
    expect(drawn(doc, FREE)).toEqual({ left: ["glass"], right: ["railing"] });
  });

  it("both None: no rail at all", () => {
    expect(drawn(room(free, { type: "setStair", objectId: FREE, handrail: "none" }), FREE)).toEqual({ left: [], right: [] });
  });

  it("handrail on a flight sets both sides", () => {
    expect(object(room(free, { type: "setStair", objectId: FREE, handrail: "glass" }), FREE).handrails).toEqual({ left: "glass", right: "glass" });
  });

  it("a side value no choice offers is refused; sides on a spiral are refused", () => {
    expect(refusal(room(free), { type: "setStair", objectId: FREE, handrailLeft: "wood" } as unknown as Command)).toBe("Invalid handrail: railing, glass or none");
    expect(refusal(room(place("spiralStair")), { type: "setStair", objectId: STAIR, handrailLeft: "none" })).toBe("A spiral stair has one handrail");
  });
});

describe("an L's flights share each side (AC-08)", () => {
  it("setting the lower flight's right to Glass sets the upper flight's right; the lefts stay", () => {
    const doc = room(place("stair", "l-right"), { type: "setStair", objectId: "ps/s0/o0", handrailRight: "glass" });
    expect(object(doc, "ps/s0/o0").handrails).toEqual({ left: "railing", right: "glass" });
    expect(object(doc, "ps/s1/o0").handrails).toEqual({ left: "railing", right: "glass" });
  });

  it("setting the upper flight's left sets the lower's left", () => {
    const doc = room(place("stair", "l-right"), { type: "setStair", objectId: "ps/s1/o0", handrailLeft: "none" });
    expect(object(doc, "ps/s0/o0").handrails?.left).toBe("none");
  });
});

describe("a spiral with None (AC-09)", () => {
  it("draws no balustrade and no landing rail", () => {
    const doc = room(place("spiralStair"), { type: "setStair", objectId: STAIR, handrail: "none" });
    expect(object(doc).handrail).toBe("none");
    expect(spiralRails(doc).get(STAIR) ?? null).toBeNull();
  });
});

describe("where a new stair's rails start", () => {
  it("arriving on a Glass side of a mixed loft, both sides Glass; on a Railing side, Railing", () => {
    expect(object(room({ type: "setDeck", deckId: LOFT, guardRight: { kind: "glass" } }, place())).handrails).toEqual({ left: "glass", right: "glass" });
    expect(object(room({ type: "setDeck", deckId: LOFT, guardBack: { kind: "glass" } }, place())).handrails).toEqual({ left: "railing", right: "railing" });
  });

  it("an L's two flights take the side the upper one arrives on", () => {
    const doc = room({ type: "setDeck", deckId: LOFT, guardRight: { kind: "glass" } }, place("stair", "l-right"));
    expect(object(doc, "ps/s0/o0").handrails).toEqual({ left: "glass", right: "glass" });
    expect(object(doc, "ps/s1/o0").handrails).toEqual({ left: "glass", right: "glass" });
  });

  it("arriving in a Glass hole, Glass", () => {
    const doc = build(
      ...rectangleRoom({ x: 0, y: 0 }, 8, 6, "c"), { type: "setCeiling", height: 3.05 },
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 4, y: 3 }, w: 4, d: 4 },
      { type: "addDeckHole", opId: "h", deck: LOFT, at: { x: 4, y: 2.5 }, w: 1, d: 3, guard: { kind: "glass" } },
      { type: "placeStair", opId: "ps", state: "s0", kind: "stair", surface: null, deck: LOFT, at: { x: 4, y: 4 }, shape: "straight" },
    );
    expect(object(doc).handrails).toEqual({ left: "glass", right: "glass" });
  });
});

describe("switching kind", () => {
  it("a flight switched to a spiral takes its value when both sides agree, else Railing; back to a flight, both sides", () => {
    const agreed = room(free, { type: "setStair", objectId: FREE, handrail: "glass" }, { type: "setObjectKind", objectId: FREE, kind: "spiralStair" });
    expect(object(agreed, FREE).handrail).toBe("glass");
    expect(object(agreed, FREE)).not.toHaveProperty("handrails");
    const mixed = room(free, { type: "setStair", objectId: FREE, handrailLeft: "none" }, { type: "setObjectKind", objectId: FREE, kind: "spiralStair" });
    expect(object(mixed, FREE).handrail).toBe("railing");
    const back = room(free, { type: "setStair", objectId: FREE, handrail: "glass" }, { type: "setObjectKind", objectId: FREE, kind: "spiralStair" }, { type: "setObjectKind", objectId: FREE, kind: "stair" });
    expect(object(back, FREE).handrails).toEqual({ left: "glass", right: "glass" });
  });
});

describe("a stored file (AC-05)", () => {
  const old = (doc: Document): Record<string, unknown> => {
    const json: Record<string, unknown> = { ...serialize(doc) };
    const objects = json.objects as Record<string, Record<string, unknown>>;
    json.objects = Object.fromEntries(Object.entries(objects).map(([id, o]) => {
      const rest = { ...o };
      if (rest.handrails !== undefined) {
        rest.handrail = (rest.handrails as { left: string }).left;
        delete rest.handrails;
      }
      return [id, rest];
    }));
    return json;
  };

  it("an old flight's one handrail goes to both sides; an old spiral keeps its one", () => {
    const flight = unwrap(deserialize(old(room(place(), { type: "setStair", objectId: STAIR, handrail: "glass" }))));
    expect(object(flight).handrails).toEqual({ left: "glass", right: "glass" });
    expect(object(flight)).not.toHaveProperty("handrail");
    const spiral = unwrap(deserialize(old(room(place("spiralStair"), { type: "setStair", objectId: STAIR, handrail: "glass" }))));
    expect(object(spiral).handrail).toBe("glass");
    expect(validateDocument(flight).ok).toBe(true);
  });

  it("the server's path does the same", () => {
    const stored = parseStoredDocument(old(room(place(), { type: "setStair", objectId: STAIR, handrail: "glass" })));
    if (!stored) throw new Error("not a stored document");
    expect(object(unwrap(fromStored(upgradeStored(stored)))).handrails).toEqual({ left: "glass", right: "glass" });
  });

  it("past loading, a flight with the old field, or a ladder with handrails, is refused", () => {
    const doc = room(place());
    const stored = toStored(doc);
    const withOld = { ...stored, objects: { ...stored.objects, [STAIR]: { ...stored.objects[STAIR], handrail: "railing" } } };
    expect(fromStored(withOld as typeof stored).ok).toBe(false);
    const ladder = room(place("rungLadder"));
    const s2 = toStored(ladder);
    const railed = { ...s2, objects: { ...s2.objects, [STAIR]: { ...s2.objects[STAIR], handrails: { left: "railing", right: "railing" } } } };
    expect(fromStored(railed as typeof s2).ok).toBe(false);
  });
});
