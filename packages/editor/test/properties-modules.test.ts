import { describe, expect, it } from "vitest";
import { OPENING_KIND_IDS, motifDefaults, motifsFor, type Document } from "@fm/domain";
import type { FieldCommand, Properties } from "../src/properties/fields";
import { objectFieldCommand, objectFields } from "../src/properties/object";
import { openingFieldCommand, openingFields } from "../src/properties/opening";
import { wallFieldCommand, wallFields } from "../src/properties/wall";
import { zoneFieldCommand, zoneFields } from "../src/properties/zone";
import { labelledDoc, nightBedDoc, roomDoc, wallBetween, withCommands } from "./builders";

// Each entity's Properties fields and their decoding live in one module (arch-review R-11): every editable field the
// panel shows sends a command when given its own current value; read-only fields are shown, never decoded.
const editable = (p: Properties) => ("fields" in p ? p.fields.filter((f) => !f.readOnly) : []);

function expectDecoded(p: Properties, decode: (fieldId: string, value: string) => FieldCommand): void {
  expect(p.kind).not.toBe("none");
  for (const f of editable(p)) {
    if (f.id === "preset" && f.value === "custom") continue; // Custom is shown, never applied
    expect(decode(f.id, f.value), f.id).not.toBeNull();
  }
}

describe("Properties modules decode every field they show", () => {
  it("wall", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    expectDecoded(wallFields(doc, wall), (id, v) => wallFieldCommand(doc, wall, id, v));
  });

  it("a half wall: its Top decodes too", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const half = withCommands(doc, { type: "setWallTop", wallId: wall, top: 1.1 });
    expectDecoded(wallFields(half, wall), (id, v) => wallFieldCommand(half, wall, id, v));
  });

  it("zone, without and with a finish", () => {
    for (const motif of [null, ...motifsFor("floor")]) {
      const doc = withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: motif === null ? null : motifDefaults(motif) });
      expectDecoded(zoneFields(doc, "L1", "s0"), (id, v) => zoneFieldCommand(doc, "L1", id, v));
    }
  });

  it("object", () => {
    // nightBedDoc's bed (1.60 × 2.00) shows Preset Custom; a bed at its default shows King, which decodes.
    const atDefault = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } });
    for (const doc of [nightBedDoc(), atDefault]) {
      for (const placement of Object.keys(doc.placements)) {
        expectDecoded(objectFields(doc, placement), (id, v) => objectFieldCommand(doc, placement, id, v));
      }
    }
  });

  it.each(OPENING_KIND_IDS)("opening (%s)", (kind) => {
    const room = roomDoc();
    const doc: Document = withCommands(room, { type: "addOpening", opId: "o", wall: wallBetween(room, { x: 0, y: 0 }, { x: 6, y: 0 }), kind, offset: 1 });
    expectDecoded(openingFields(doc, "o/d0"), (id, v) => openingFieldCommand(doc, "o/d0", id, v));
  });
});
