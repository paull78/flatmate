import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, LayoutObject } from "../src/model";
import { OBJECT_KINDS } from "../src/kinds";
import type { ObjectOption } from "../src/options";
import { fitViolations } from "../src/queries/fit";
import { freeFloor } from "../src/queries/free-floor";
import { deserialize, serialize } from "../src/serialize";
import { parseLayoutObject } from "../src/shape";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// One mechanism for per-object options (spec "Round chairs", AC-05; library.10): the kinds column lists the options a
// kind takes, the object stores the ones that are on as `true` keys, and `setOption` turns one on or off. The room: 4 × 4 m
// (inner faces 0.1–3.9); the piece stands against the top wall.

const room = (): Document => rectDoc(0, 0, 4, 4);
const withPiece = (kind: string, object = "o"): Document => place(room(), { object, kind, at: [2, 3.9] });
const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command): Document => {
  const r = unwrap(run(doc, cmd));
  expect(validateDocument(r.doc).ok).toBe(true);
  return r.doc;
};
const setOption = (option: ObjectOption, on: boolean, objectId = "o"): Command => ({ type: "setOption", objectId, option, on });
const objectOf = (doc: Document, id = "o"): LayoutObject => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no object ${id}`);
  return o;
};
const errorOf = (doc: Document, cmd: Command): string => {
  const r = run(doc, cmd);
  if (r.ok) throw new Error("expected a refusal");
  return r.error.message;
};
const roundTrip = (doc: Document): Document => unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))));

describe("the options column", () => {
  it("lists the computer on the desks and round chairs on the three sets and the loose chair", () => {
    const listing = OBJECT_KINDS.filter((k) => k.options.length > 0).map((k) => [k.id, k.options]);
    expect(listing).toEqual([["desk", ["computer"]], ["deskSet", ["computer", "roundChairs"]], ["chair", ["roundChairs"]], ["rungLadder", ["hooks"]], ["winderStair", ["leftEntry"]], ["seatedDining", ["roundChairs"]], ["seatedRound", ["roundChairs"]]]);
  });
});

describe("setOption (AC-05)", () => {
  it("setOption sets and clears", () => {
    const set = withPiece("seatedDining");
    const on = ok(set, setOption("roundChairs", true));
    expect(objectOf(on).options).toEqual({ roundChairs: true });
    expect(roundTrip(on)).toEqual(on);

    const off = ok(on, setOption("roundChairs", false));
    expect(Object.hasOwn(objectOf(off), "options")).toBe(false); // removing the last option removes the key
    expect(objectOf(off)).toEqual(objectOf(set));
    expect(roundTrip(off)).toEqual(off);
  });

  it("options keep one key per option on", () => {
    const set = withPiece("deskSet"); // takes both
    const both = ok(ok(set, setOption("roundChairs", true)), setOption("computer", true));
    expect(objectOf(both).options).toEqual({ computer: true, roundChairs: true });
    const again = unwrap(run(both, setOption("roundChairs", true)));
    expect(again.doc).toBe(both);
    expect(again.patch.puts).toEqual([]);
    const one = ok(both, setOption("computer", false));
    expect(objectOf(one).options).toEqual({ roundChairs: true });
    expect(roundTrip(both)).toEqual(both);
  });

  it("is one object put, and turning off an option that is off changes nothing", () => {
    const r = unwrap(run(withPiece("seatedRound"), setOption("roundChairs", true)));
    expect(r.patch.puts.map((p) => [p.table, p.entity.id])).toEqual([["objects", "o"]]);
    const offAgain = unwrap(run(withPiece("seatedRound"), setOption("roundChairs", false)));
    expect(offAgain.patch.puts).toEqual([]);
  });

  it("refused for an option the kind doesn't list", () => {
    expect(errorOf(withPiece("desk"), setOption("roundChairs", true))).toBe("Only a chair, or a table or desk with chairs, takes round chairs");
    expect(errorOf(withPiece("seatedDining"), setOption("computer", true))).toBe("Only a desk takes a computer");
    expect(errorOf(withPiece("chair"), setOption("computer", true))).toBe("Only a desk takes a computer");
    expect(errorOf(withPiece("sofa"), setOption("roundChairs", true))).toBe("Only a chair, or a table or desk with chairs, takes round chairs");
    expect(errorOf(withPiece("sofa"), setOption("roundChairs", false))).toBe("Only a chair, or a table or desk with chairs, takes round chairs");
  });

  it("refuses an unknown option, a non-boolean on and a missing object (commands come from JSON)", () => {
    const wheels: unknown = JSON.parse('{"type":"setOption","objectId":"o","option":"wheels","on":true}');
    const maybe: unknown = JSON.parse('{"type":"setOption","objectId":"o","option":"roundChairs","on":"yes"}');
    const asCommand = (v: unknown): Command => {
      if (typeof v !== "object" || v === null) throw new Error("not a command");
      return { ...setOption("roundChairs", true), ...v };
    };
    expect(errorOf(withPiece("seatedDining"), asCommand(wheels))).toBe("Unknown option");
    expect(errorOf(withPiece("seatedDining"), asCommand(maybe))).toBe("Invalid option");
    expect(errorOf(withPiece("seatedDining"), setOption("roundChairs", true, "nope"))).toBe("Object not found");
  });
});

describe("options through other commands", () => {
  const setOn = (): Document => ok(ok(withPiece("deskSet"), setOption("computer", true)), setOption("roundChairs", true));

  it("a set can't switch kind, so its options can't be lost that way (seated)", () => {
    expect(errorOf(setOn(), { type: "setObjectKind", objectId: "o", kind: "desk" })).toBeTruthy();
    expect(objectOf(setOn()).options).toEqual({ computer: true, roundChairs: true });
  });

  it("duplicate copies them", () => {
    const doc = ok(setOn(), { type: "duplicatePlacements", opId: "d", copies: [{ placementId: "o/s0", at: { x: 2, y: 2 }, rotation: 0 }] });
    expect(objectOf(doc, "d/o0").options).toEqual({ computer: true, roundChairs: true });
    expect(objectOf(doc, "d/o0").options).not.toBe(objectOf(doc).options); // a fresh object
  });

  it("placeObject never sets them", () => {
    const doc = ok(room(), { type: "placeObject", opId: "p", state: "s0", object: { kind: "seatedDining" }, at: { x: 2, y: 3.9 }, deck: null });
    expect(Object.hasOwn(objectOf(doc, "p/o0"), "options")).toBe(false);
  });

  it("fit and free floor unchanged with options on", () => {
    const off = withPiece("seatedDining");
    const on = ok(off, setOption("roundChairs", true));
    expect(fitViolations(on)).toEqual(fitViolations(off));
    expect(freeFloor(on, "s0")).toEqual(freeFloor(off, "s0"));
  });
});

describe("parseLayoutObject: the options key", () => {
  const row = (kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...objectOf(withPiece(kind)), ...extra });

  it("accepts the options a kind lists, each true", () => {
    expect(parseLayoutObject(row("deskSet", { options: { computer: true, roundChairs: true } }))?.options).toEqual({ computer: true, roundChairs: true });
    expect(parseLayoutObject(row("seatedDining", { options: { roundChairs: true } }))?.options).toEqual({ roundChairs: true });
    expect(parseLayoutObject(row("desk", { options: { computer: true } }))?.options).toEqual({ computer: true });
  });

  it("parse refuses an unlisted option, an empty record, a value other than true, the old computer key", () => {
    expect(parseLayoutObject(row("desk", { options: { roundChairs: true } }))).toBeNull();
    expect(parseLayoutObject(row("sofa", { options: { computer: true } }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: { wheels: true } }))).toBeNull();
    expect(parseLayoutObject(row("deskSet", { options: { computer: true, wheels: true } }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: {} }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: { roundChairs: false } }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: { roundChairs: "yes" } }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: ["roundChairs"] }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: "roundChairs" }))).toBeNull();
    expect(parseLayoutObject(row("seatedDining", { options: null }))).toBeNull();
    expect(parseLayoutObject(row("desk", { computer: true }))).toBeNull();
  });

  it("an absent key still parses", () => {
    expect(parseLayoutObject(row("seatedDining"))).toEqual(objectOf(withPiece("seatedDining")));
  });
});

describe("a loose chair's round chairs (seated.05)", () => {
  it("turns on and off, and its fit stays the rectangle: two round chairs whose square corners meet are refused", () => {
    const one = ok(withPiece("chair"), setOption("roundChairs", true));
    expect(objectOf(one).options).toEqual({ roundChairs: true });
    expect(Object.hasOwn(objectOf(ok(one, setOption("roundChairs", false))), "options")).toBe(false);
    // The two chairs' rectangles overlap by 2 cm at a corner, where the round ring's cut corners would leave them apart.
    const other = ok(one, { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2 } });
    expect(errorOf(other, { type: "movePlacement", placementId: "c/p0", at: { x: 2.43, y: 3.47 }, rotation: 0 })).toMatch(/overlap/i);
    expect(ok(other, { type: "movePlacement", placementId: "c/p0", at: { x: 2.46, y: 3.47 }, rotation: 0 }).placements["c/p0"]?.at.x).toBe(2.46);
  });
});
