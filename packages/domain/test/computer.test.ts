import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document, LayoutObject } from "../src/model";
import { fitViolations } from "../src/queries/fit";
import { freeFloor } from "../src/queries/free-floor";
import { deserialize, serialize } from "../src/serialize";
import { parseLayoutObject } from "../src/shape";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// "With computer" (spec "Computer", AC-09; seating.12), now an option (library.10): a yes/no on a desk-kind object,
// shared by every layout, set by `setOption`, dropped on a kind switch. The mechanism itself is options.test.ts. The
// room: 4 × 4 m (inner faces 0.1–3.9); the desk stands against the top wall.

const room = (): Document => rectDoc(0, 0, 4, 4);
const withPiece = (kind: string, object = "o"): Document => place(room(), { object, kind, at: [2, 3.9] });
const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command): Document => {
  const r = unwrap(run(doc, cmd));
  expect(validateDocument(r.doc).ok).toBe(true);
  return r.doc;
};
const computer = (on: boolean, objectId = "o"): Command => ({ type: "setOption", objectId, option: "computer", on });
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

describe("the computer through setOption (AC-09)", () => {
  it("on a desk sets and clears", () => {
    const desk = withPiece("desk");
    const on = ok(desk, computer(true));
    expect(objectOf(on).options).toEqual({ computer: true });
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(on)))))).toEqual(on);

    const off = ok(on, computer(false));
    expect(Object.hasOwn(objectOf(off), "options")).toBe(false); // off removes the key: absent and off are one state
    expect(objectOf(off)).toEqual(objectOf(desk));
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(off)))))).toEqual(off);
  });

  it("is one object put, and a repeat changes nothing", () => {
    const r = unwrap(run(withPiece("desk"), computer(true)));
    expect(r.patch.puts.map((p) => [p.table, p.entity.id])).toEqual([["objects", "o"]]);
    const again = unwrap(run(r.doc, computer(true)));
    expect(again.doc).toBe(r.doc);
    expect(again.patch.puts).toEqual([]);
    const offAgain = unwrap(run(withPiece("desk"), computer(false)));
    expect(offAgain.patch.puts).toEqual([]);
  });

  it("accepted on a desk with chair", () => {
    expect(objectOf(ok(withPiece("deskSet"), computer(true))).options).toEqual({ computer: true });
  });

  it("refused on a chair", () => {
    expect(errorOf(withPiece("chair"), computer(true))).toBe("Only a desk takes a computer");
  });

  it("refused on the built-in desk", () => {
    expect(errorOf(withPiece("builtInDesk"), computer(true))).toBe("Only a desk takes a computer");
  });

  it("refused for a missing object", () => {
    expect(errorOf(withPiece("desk"), computer(true, "nope"))).toBe("Object not found");
  });
});

describe("the computer through other commands", () => {
  const deskOn = (): Document => ok(withPiece("desk"), computer(true));

  it("kind switch drops it (desk → table)", () => {
    const table = ok(deskOn(), { type: "setObjectKind", objectId: "o", kind: "coffeeTable" });
    expect(objectOf(table).kind).toBe("coffeeTable");
    expect(Object.hasOwn(objectOf(table), "options")).toBe(false);
  });

  it("duplicate copies it", () => {
    const doc = ok(deskOn(), { type: "duplicatePlacements", opId: "d", copies: [{ placementId: "o/s0", at: { x: 2, y: 2 }, rotation: 0 }] });
    expect(objectOf(doc, "d/o0").options).toEqual({ computer: true });
  });

  it("placeObject never sets it", () => {
    const doc = ok(room(), { type: "placeObject", opId: "p", state: "s0", object: { kind: "desk" }, at: { x: 2, y: 3.9 }, deck: null });
    expect(Object.hasOwn(objectOf(doc, "p/o0"), "options")).toBe(false);
  });

  it("fit and free floor unchanged with the computer on", () => {
    // A chair tucked 0.20 under the desk: the computer changes neither the tuck, the fit nor the free floor.
    const tucked = (doc: Document): Document => place(doc, { object: "chair", kind: "chair", at: [2, 3.05], rotation: 180 });
    const off = tucked(withPiece("desk"));
    const on = tucked(deskOn());
    expect(fitViolations(on)).toEqual(fitViolations(off));
    expect(freeFloor(on, "s0")).toEqual(freeFloor(off, "s0"));
  });
});

describe("parseLayoutObject: the computer option", () => {
  const row = (kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const o = objectOf(withPiece(kind));
    return { ...o, ...extra };
  };

  it("accepts it on a desk and a desk set", () => {
    expect(parseLayoutObject(row("deskSet", { options: { computer: true } }))?.options).toEqual({ computer: true });
    expect(parseLayoutObject(row("desk", { options: { computer: true } }))?.options).toEqual({ computer: true });
  });

  it("parse refuses computer on a sofa and on the built-in desk", () => {
    expect(parseLayoutObject(row("sofa", { options: { computer: true } }))).toBeNull();
    expect(parseLayoutObject(row("builtInDesk", { options: { computer: true } }))).toBeNull();
  });

  it("refuses the seating cycle's computer key", () => {
    expect(parseLayoutObject(row("desk", { computer: true }))).toBeNull();
    expect(parseLayoutObject(row("desk", { computer: false }))).toBeNull();
  });

  it("an absent key still parses (no fill on load)", () => {
    expect(parseLayoutObject(row("desk"))).toEqual(objectOf(withPiece("desk")));
  });
});
