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
  it("builds a 4 × 5 m room from a script (spec: domain): 3.8 × 4.8 = 18.24 m²", () => {
    // Through the public entry, as the spec's example uses it.
    let doc = domain.emptyDocument();
    for (const cmd of domain.rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = domain.unwrap(domain.execute(doc, cmd)).doc;
    expect(Object.keys(doc.walls)).toHaveLength(4);
    expect(domain.zones(doc).map((z) => z.area?.toFixed(2))).toEqual(["18.24"]);
  });

  it("rectangleRoom's IDs are deterministic (spec: walls-rooms); a used prefix is refused, a new one builds a second room", () => {
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

  it("rectangleRoom with thickness 0.1 gives four 0.10 walls; without it, 0.20 (layout-states.27)", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5, "t", 0.1)) doc = unwrap(execute(doc, cmd)).doc;
    expect(Object.values(doc.walls).map((w) => w.thickness)).toEqual([0.1, 0.1, 0.1, 0.1]);
    for (const cmd of rectangleRoom({ x: 10, y: 0 }, 4, 5, "d")) doc = unwrap(execute(doc, cmd)).doc;
    expect(Object.values(doc.walls).filter((w) => w.id.startsWith("d-")).map((w) => w.thickness)).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(rectangleRoom({ x: 0, y: 0 }, 4, 5)[0]).not.toHaveProperty("thickness");
  });

  // Every command's patch must undo exactly: apply(doc', invert(patch)) === doc. The input is frozen,
  // so a command that writes to it throws.
  const base = (): Document => {
    let doc = rectDoc(0, 0, 6, 4);
    doc = unwrap(execute(doc, { type: "addWall", opId: "d", from: { at: { x: 3, y: 0 } }, to: { at: { x: 3, y: 4 } } })).doc;
    doc = unwrap(execute(doc, { type: "labelZone", id: "L1", at: { x: 1.5, y: 2 }, name: "Kitchen", finish: null })).doc;
    return unwrap(execute(doc, { type: "labelZone", id: "L2", at: { x: 4.5, y: 2 }, name: "Dining", finish: null })).doc;
  };
  const unlabelled = (): Document => rectDoc(0, 0, 6, 4);
  const cases: [string, () => Document, Command][] = [
    ["addWall", base, { type: "addWall", opId: "x", from: { at: { x: 1, y: 0 } }, to: { at: { x: 1, y: 1 } } }],
    ["moveJoints", base, { type: "moveJoints", moves: [{ jointId: "J3", to: { x: 6.5, y: 4.5 } }] }],
    ["setWallLength", base, { type: "setWallLength", wallId: "W2", length: 3.5, keep: "a" }],
    ["setWallThickness", base, { type: "setWallThickness", wallId: "W2", thickness: 0.3 }],
    ["labelZone", unlabelled, { type: "labelZone", id: "L3", at: { x: 1, y: 1 }, name: "x", finish: null }],
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
      { type: "setWallThickness", wallId: "W2", thickness: 0.2 },
    ];
    for (const cmd of noOps) {
      const r = unwrap(execute(doc, cmd));
      expect(r.patch.puts, cmd.type).toEqual([]);
      expect(r.patch.deletes, cmd.type).toEqual([]);
      expect(r.patch.before, cmd.type).toEqual([]);
      expect(r.doc, cmd.type).toBe(doc);
    }
  });

  it("setWallThickness changes one wall; the patch's before value restores it (layout-states.27)", () => {
    const doc = base();
    const r = unwrap(execute(doc, { type: "setWallThickness", wallId: "W2", thickness: 0.1 }));
    expect(r.doc.walls.W2?.thickness).toBe(0.1);
    expect(r.patch.puts).toEqual([{ table: "walls", entity: { id: "W2", a: "J2", b: "J3", thickness: 0.1, top: "ceiling", base: "floor", column: false } }]);
    expect(r.patch.before).toEqual([{ table: "walls", id: "W2", value: { id: "W2", a: "J2", b: "J3", thickness: 0.2, top: "ceiling", base: "floor", column: false } }]);
    for (const [id, w] of Object.entries(r.doc.walls)) if (id !== "W2") expect(w).toBe(doc.walls[id]);
  });

  it("setWallThickness outside 0.05 to 0.50 m is refused with I13 naming the wall; a missing wall is notFound", () => {
    const doc = base();
    for (const thickness of [0.6, 0.04]) {
      const r = execute(doc, { type: "setWallThickness", wallId: "W2", thickness });
      expect(r).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Wall thickness must be between 0.05 and 0.50 m" } });
      expect(r.ok ? [] : r.error.violations).toEqual([
        { invariant: "I13", message: `Wall W2 thickness ${thickness} m is outside 0.05 to 0.50 m`, entities: [{ table: "walls", id: "W2" }] },
      ]);
    }
    expect(execute(doc, { type: "setWallThickness", wallId: "W2", thickness: Number.NaN })).toMatchObject({ ok: false, error: { kind: "invalidInput" } });
    expect(execute(doc, { type: "setWallThickness", wallId: "W9", thickness: 0.1 })).toMatchObject({ ok: false, error: { kind: "notFound" } });
  });

  it("refuses IDs that are not valid IDs, including Object.prototype names", () => {
    const doc = base();
    const bad: Command[] = [
      { type: "setWallLength", wallId: "constructor", length: 3, keep: "a" },
      { type: "renameZone", id: "toString", name: "x" },
      { type: "setWallThickness", wallId: "constructor", thickness: 0.1 },
      { type: "placeObject", deck: null, opId: "q", state: "toString", object: { kind: "bed" }, at: { x: 1, y: 1 } },
      { type: "placeObject", deck: null, opId: "q", state: "s0", object: { existing: "__proto__" }, at: { x: 1, y: 1 } },
      { type: "movePlacement", placementId: "valueOf", at: { x: 1, y: 1 }, rotation: 0 },
      { type: "movePlacements", moves: [{ placementId: "valueOf", at: { x: 1, y: 1 }, rotation: 0 }] },
      { type: "movePlacements", moves: [{ placementId: "a/s0", at: { x: 1, y: 1 }, rotation: 0 }, { placementId: "__proto__", at: { x: 1, y: 1 }, rotation: 0 }] },
      { type: "duplicatePlacements", opId: "q", copies: [{ placementId: "constructor", at: { x: 1, y: 0 }, rotation: 0 }] },
      { type: "setConfiguration", placementId: "constructor", config: "down" },
      { type: "setObjectSize", objectId: "hasOwnProperty", w: 1, d: {} },
      { type: "setObjectKind", objectId: "hasOwnProperty", kind: "murphyBed" },
      { type: "resizePlacement", placementId: "constructor", side: "right", size: 1 },
      { type: "renameObject", objectId: "toString", name: "x" },
      { type: "removePlacement", placementId: "constructor" },
      { type: "setZoneSides", placementId: "constructor", sides: { front: true, back: false, left: false, right: false } },
      { type: "setZoneExtent", placementId: "constructor", side: "left", extent: null },
      { type: "copyState", opId: "q", from: "constructor", name: "x" },
      { type: "renameState", stateId: "valueOf", name: "x" },
      { type: "deleteState", stateId: "__proto__" },
      { type: "moveJoints", moves: [{ jointId: "__proto__", to: { x: 1, y: 1 } }] },
      { type: "deleteEntities", ids: [{ table: "walls", id: "has space" }] },
      { type: "addWall", opId: "y", from: { existing: "valueOf" }, to: { at: { x: 1, y: 1 } } },
      { type: "addWall", opId: "z", from: { at: { x: 1, y: 1 } }, to: { existing: "isPrototypeOf" } },
      // labelZone would answer "Invalid label ID" itself; the guard answers first.
      { type: "labelZone", id: "hasOwnProperty", at: { x: 100, y: 100 }, name: "x", finish: null },
      { type: "deleteEntities", ids: [{ table: "joints", id: "__proto__" }] },
      { type: "deleteEntities", ids: [{ table: "zoneLabels", id: "toLocaleString" }] },
      { type: "moveJoints", moves: [{ jointId: "J1", to: { x: 0, y: 0 } }, { jointId: "propertyIsEnumerable", to: { x: 1, y: 1 } }] },
      { type: "setDimensionOffset", id: "__proto__", offset: 0 },
      { type: "deleteEntities", ids: [{ table: "dimensions", id: "toString" }] },
      { type: "placeUnderlay", pictureId: "__proto__", data: "x", width: 1, height: 1, at: { x: 0, y: 0 } },
      { type: "deleteEntities", ids: [{ table: "underlays", id: "toString" }] },
    ];
    for (const cmd of bad) expect(execute(doc, cmd)).toMatchObject({ ok: false, error: { kind: "invalidInput", message: "Invalid ID" } });
  });
});
