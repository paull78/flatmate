import { describe, expect, it } from "vitest";
import { TABLE_NAMES, unwrap, type TableName } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { emptyDocument, type Document, sameGuards } from "../src/model";
import { rectangleRoom } from "../src/scripts";
import { deserialize, serialize } from "../src/serialize";
import { validateDocument } from "../src/validate";

// Every table, looped from TABLE_NAMES (arch-review R-08): a table added to the protocol must be saved, shape-checked
// (I8) and covered by the operation-ID reuse check, or these tests fail instead of the table being dropped silently.

function run(doc: Document, commands: Command[]): Document {
  return commands.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
}

/**
 * A room with a label, a second layout, a placed bed, a door, a dimension, a project field, an underlay, a logo, a
 * ceiling, a sheet, a section, a platform with the bed on it and a hole in it, a named area: at least one row in every table.
 */
function fullDocument(): Document {
  const doc = run(emptyDocument(), [
    ...rectangleRoom({ x: 0, y: 0 }, 4, 3),
    { type: "labelZone", id: "L1", at: { x: 2, y: 1.5 }, name: "Studio", finish: null },
    { type: "addState", opId: "night", name: "Night" },
    { type: "placeObject", deck: null, opId: "bed", state: "night/s0", object: { kind: "bed" }, at: { x: 2, y: 2.8 }, linked: false },
    { type: "addOpening", opId: "door", wall: "room-1/w0", kind: "swing", offset: 1 },
    { type: "addDimension", opId: "dim", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, offset: 0.5 },
    { type: "setProjectField", key: "client", value: "Rossi" },
    { type: "placeUnderlay", pictureId: "pic", data: "/9j/4AAQ", width: 3, height: 2, at: { x: -1, y: 4 } },
    { type: "setLogo", data: "/9j/4AAQ", width: 3, height: 2 },
    { type: "setCeiling", height: 2.4 },
    { type: "addSheet", opId: "sheet", after: null, kind: "plan", drawings: [{ layout: "s0", deck: null }] },
    { type: "addSection", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, side: 1 },
  ]);
  // No deck command until step 02 (deck rules and commands): the row and the bed's surface go in directly.
  // The platform's edges hold the bed's footprint (1.15–2.85 × 0.7–2.8, inside the deck since step 06) and keep off
  // the walls' inner faces.
  // Its east strip, clear of the bed, holds a hole (stairwell.03): written directly until the hole commands exist.
  const platform = { id: "stage/k0", name: "Platform", at: { x: 2, y: 1.7 }, w: 2.6, d: 2.2, rotation: 0, top: 0.45, solid: true, finish: null, ...sameGuards("none") };
  const hole = { id: "well/h0", deck: platform.id, at: { x: 3.1, y: 1.5 }, w: 0.4, d: 0.5, guard: { kind: "none" as const, height: 1 } };
  // A named area, written directly until the area commands exist (areas step 02).
  const area = { id: "nook/a0", name: "Kitchen", at: { x: 1, y: 1 }, w: 1, d: 0.8 };
  const bed = doc.placements["bed/p0"];
  if (!bed) throw new Error("the fixture has no bed");
  return { ...doc, decks: { [platform.id]: platform }, deckHoles: { [hole.id]: hole }, areas: { [area.id]: area }, placements: { ...doc.placements, [bed.id]: { ...bed, deck: platform.id } } };
}

/** The first row of a table, preferring one whose ID derives from an operation ID, and that operation ID. */
function firstRow(doc: Document, table: TableName): { id: string; opId: string | null } {
  const ids = Object.keys(doc[table]);
  const id = ids.find((i) => i.indexOf("/") > 0) ?? ids[0];
  if (id === undefined) throw new Error(`the fixture has no ${table} row`);
  const slash = id.indexOf("/");
  return { id, opId: slash > 0 ? id.slice(0, slash) : null };
}

/** The same document with one row of `table` given a mismatched ID (an I8 shape error). */
function withBadRow(doc: Document, table: TableName): Document {
  const { id } = firstRow(doc, table);
  const copy = JSON.parse(JSON.stringify(doc));
  copy[table][id].id = `${id}x`;
  return copy;
}

const doc = fullDocument();

describe("every table", () => {
  it("the fixture is a valid drawing", () => {
    expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  });

  it.each(TABLE_NAMES)("%s has a row in the fixture", (table) => {
    expect(Object.keys(doc[table]).length).toBeGreaterThan(0);
  });

  it.each(TABLE_NAMES)("%s survives a serialize → deserialize round trip", (table) => {
    const back = unwrap(deserialize(JSON.parse(JSON.stringify(serialize(doc)))));
    expect(back[table]).toEqual(doc[table]);
  });

  it.each(TABLE_NAMES)("a malformed %s row raises I8 naming the table", (table) => {
    const r = validateDocument(withBadRow(doc, table));
    expect(r.ok).toBe(false);
    const i8 = r.ok ? [] : r.error.filter((v) => v.invariant === "I8");
    expect(i8.some((v) => v.entities.some((k) => k.table === table))).toBe(true);
  });

  const creates = (opId: string): Command[] => [
    { type: "addWall", opId, from: { at: { x: 10, y: 10 } }, to: { at: { x: 12, y: 10 } } },
    { type: "placeObject", deck: null, opId, state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 } },
    { type: "addOpening", opId, wall: "room-3/w0", kind: "window", offset: 1 },
    { type: "addState", opId, name: "Other" },
    { type: "copyState", opId, from: "s0", name: "Copy" },
    { type: "addDimension", opId, a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, offset: 0 },
    { type: "addSheet", opId, after: null, kind: "plan", drawings: [{ layout: "s0", deck: null }] },
  ];
  const opIdTables = TABLE_NAMES.filter((t) => firstRow(doc, t).opId !== null);

  it("the fixture derives IDs from operation IDs in every table that has opId-derived rows", () => {
    expect(opIdTables).toEqual(["joints", "walls", "decks", "deckHoles", "states", "objects", "placements", "openings", "dimensions", "sheets", "areas"]);
  });

  it.each(opIdTables)("an operation ID already used in %s is refused by every create command", (table) => {
    const opId = firstRow(doc, table).opId ?? "";
    for (const command of creates(opId)) {
      const r = execute(doc, command);
      expect({ command: command.type, error: r.ok ? null : r.error.message }).toEqual({ command: command.type, error: "Operation ID already used" });
    }
  });
});
