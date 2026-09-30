import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import * as domain from "../src";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { zones } from "../src/queries/zones";
import { rectangleRoom } from "../src/scripts";
import { deepFreeze, rectDoc } from "./helpers";

describe("execute", () => {
  it("builds a 4 × 5 m room from a script (spec §3.1): 3.8 × 4.8 = 18.24 m²", () => {
    // Through the public entry, as the spec's example uses it.
    let doc = domain.emptyDocument();
    for (const cmd of domain.rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = domain.unwrap(domain.execute(doc, cmd)).doc;
    expect(Object.keys(doc.walls)).toHaveLength(4);
    expect(domain.zones(doc).map((z) => z.area?.toFixed(2))).toEqual(["18.24"]);
  });

  it("rectangleRoom's IDs are deterministic (spec §3.4); a used prefix is refused, a new one builds a second room", () => {
    const script = rectangleRoom({ x: 0, y: 0 }, 4, 5);
    let doc = emptyDocument();
    for (const cmd of script) doc = unwrap(execute(doc, cmd)).doc;
    expect(Object.keys(doc.joints).sort()).toEqual(["room-1/j0", "room-1/j1", "room-2/j0", "room-3/j0"]);
    expect(Object.keys(doc.walls).sort()).toEqual(["room-1/w0", "room-2/w0", "room-3/w0", "room-4/w0"]);
    const used = { kind: "invalidInput", message: "Operation ID already used", violations: [] };
    for (const cmd of script) expect(execute(doc, cmd)).toEqual({ ok: false, error: used });
    for (const cmd of rectangleRoom({ x: 10, y: 0 }, 4, 5, "b")) doc = unwrap(execute(doc, cmd)).doc;
    expect(zones(doc).map((z) => z.area?.toFixed(2))).toEqual(["18.24", "18.24"]);
  });

  // Every command's patch must undo exactly: apply(doc', invert(patch)) === doc. The input is frozen,
  // so a command that writes to it throws.
  const base = (): Document => {
    let doc = rectDoc(0, 0, 6, 4);
    doc = unwrap(execute(doc, { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } })).doc;
    doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen" })).doc;
    return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining" })).doc;
  };
  const unlabelled = (): Document => rectDoc(0, 0, 6, 4);
  const cases: [string, () => Document, Command][] = [
    ["addWall", base, { type: "addWall", opId: "x", from: { at: { x: 1, y: 0 } }, to: { at: { x: 1, y: 1 } } }],
    ["moveJoints", base, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6.5, y: 4.5 } }] }],
    ["setWallLength", base, { type: "setWallLength", wallId: "W2", length: 3.5, keep: "a" }],
    ["labelZone", unlabelled, { type: "labelZone", id: "L3", at: { x: 1, y: 1 }, name: "x" }],
    ["renameZone", base, { type: "renameZone", id: "L1", name: "Cook" }],
    ["deleteEntities", base, { type: "deleteEntities", ids: [{ table: "walls", id: "d/w0" }] }],
  ];
  for (const [name, build, cmd] of cases) {
    it(`${name}: the inverse patch restores the document`, () => {
      const doc = deepFreeze(build());
      const r = unwrap(execute(doc, cmd));
      expect(r.patch.puts.length + r.patch.deletes.length).toBeGreaterThan(0);
      expect(unwrap(applyPatch(r.doc, invertPatch(r.patch)))).toEqual(doc);
      expect(unwrap(applyPatch(doc, r.patch))).toEqual(r.doc);
    });
  }

  it("a command that changes nothing returns an empty patch and the input document", () => {
    const doc = base();
    const noOps: Command[] = [
      { type: "renameZone", id: "L1", name: "Kitchen" },
      { type: "setWallLength", wallId: "W2", length: 4, keep: "a" },
      { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6, y: 4 } }] },
    ];
    for (const cmd of noOps) {
      const r = unwrap(execute(doc, cmd));
      expect(r.patch.puts, cmd.type).toEqual([]);
      expect(r.patch.deletes, cmd.type).toEqual([]);
      expect(r.patch.before, cmd.type).toEqual([]);
      expect(r.doc, cmd.type).toBe(doc);
    }
  });

  it("refuses IDs that are not valid IDs, including Object.prototype names", () => {
    const doc = base();
    const bad: Command[] = [
      { type: "setWallLength", wallId: "constructor", length: 3, keep: "a" },
      { type: "renameZone", id: "toString", name: "x" },
      { type: "moveJoints", moves: [{ jointId: "__proto__", to: { x: 1, y: 1 } }] },
      { type: "deleteEntities", ids: [{ table: "walls", id: "has space" }] },
      { type: "addWall", opId: "y", from: { existing: "valueOf" }, to: { at: { x: 1, y: 1 } } },
      { type: "addWall", opId: "z", from: { at: { x: 1, y: 1 } }, to: { existing: "isPrototypeOf" } },
      // labelZone would answer "Invalid label ID" itself; the guard answers first.
      { type: "labelZone", id: "hasOwnProperty", at: { x: 100, y: 100 }, name: "x" },
      { type: "deleteEntities", ids: [{ table: "joints", id: "__proto__" }] },
      { type: "deleteEntities", ids: [{ table: "zoneLabels", id: "toLocaleString" }] },
      { type: "moveJoints", moves: [{ jointId: "J1", to: { x: 0, y: 0 } }, { jointId: "propertyIsEnumerable", to: { x: 1, y: 1 } }] },
    ];
    for (const cmd of bad) expect(execute(doc, cmd)).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid ID" } });
  });
});
