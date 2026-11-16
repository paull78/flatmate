import { describe, expect, it } from "vitest";
import { emptyDocument, execute, nullZones, rectangleRoom, toStored } from "@fm/domain";
import { emptyStored, unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";

describe("domainValidator", () => {
  it("accepts a valid room built through the domain API", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    expect(domainValidator.validate(toStored(doc))).toEqual({ ok: true });
  });

  it("reports crossing walls as I5 violations", () => {
    const doc = emptyStored();
    doc.joints = {
      j1: { id: "j1", x: 0, y: 0 },
      j2: { id: "j2", x: 2, y: 2 },
      j3: { id: "j3", x: 0, y: 2 },
      j4: { id: "j4", x: 2, y: 0 },
    };
    doc.walls = { w1: { id: "w1", a: "j1", b: "j2", thickness: 0.2, top: "ceiling", base: "floor", column: false }, w2: { id: "w2", a: "j3", b: "j4", thickness: 0.2, top: "ceiling", base: "floor", column: false } };
    const result = domainValidator.validate(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.startsWith("I5"))).toBe(true);
  });

  it("reports malformed entities", () => {
    const doc = emptyStored();
    doc.joints = { j1: { id: "j1", x: "zero", y: 0 } };
    expect(domainValidator.validate(doc).ok).toBe(false);
  });

  it("upgrade gives walls stored before per-wall thickness 0.20, and the result validates (layout-states.32)", () => {
    const doc = emptyStored();
    doc.joints = { j1: { id: "j1", x: 0, y: 0 }, j2: { id: "j2", x: 2, y: 0 } };
    doc.walls = { w1: { id: "w1", a: "j1", b: "j2" } };
    expect(domainValidator.validate(doc).ok).toBe(false);
    const upgraded = domainValidator.upgrade(doc);
    expect(upgraded.walls.w1).toEqual({ id: "w1", a: "j1", b: "j2", thickness: 0.2, top: "ceiling", base: "floor", column: false });
    expect(domainValidator.validate(upgraded)).toEqual({ ok: true });
  });

  it("upgrade gives a placement stored without sides its kind's defaults, and the result validates (smart.14)", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    doc = unwrap(execute(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 2.5 } })).doc;
    const stored = toStored(doc);
    const bed = stored.placements["b/p0"];
    if (!bed) throw new Error("no bed");
    const old = { ...bed };
    delete old.sides;
    const before = { ...stored, placements: { "b/p0": old } };
    expect(domainValidator.validate(before).ok).toBe(false);
    const upgraded = domainValidator.upgrade(before);
    expect(upgraded.placements["b/p0"]?.sides).toEqual({ front: false, back: false, left: true, right: true });
    expect(domainValidator.validate(upgraded)).toEqual({ ok: true });
  });

  it("upgrade fills zones on a placement stored with sides but no zones, and the result validates (furnish.21)", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    doc = unwrap(execute(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 2.5 } })).doc;
    const stored = toStored(doc);
    const bed = stored.placements["b/p0"];
    if (!bed) throw new Error("no bed");
    const old = { ...bed };
    delete old.zones;
    const before = { ...stored, placements: { "b/p0": old } };
    expect(domainValidator.validate(before).ok).toBe(false);
    const upgraded = domainValidator.upgrade(before);
    expect(upgraded.placements["b/p0"]?.zones).toEqual(nullZones());
    expect(upgraded.placements["b/p0"]?.sides).toEqual({ front: false, back: false, left: true, right: true });
    expect(domainValidator.validate(upgraded)).toEqual({ ok: true });
  });

  it("refuses a document with a bed across a wall as I10, naming the bed and the layout (layout-states.18)", () => {
    let doc = emptyDocument();
    for (const cmd of rectangleRoom({ x: 0, y: 0 }, 4, 5)) doc = unwrap(execute(doc, cmd)).doc;
    doc = unwrap(execute(doc, { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bed" }, at: { x: 2, y: 2.5 } })).doc;
    const stored = toStored(doc);
    const bed = stored.placements["b/p0"];
    if (!bed) throw new Error("no bed");
    const crafted = { ...stored, placements: { "b/p0": { ...bed, at: { x: 2, y: 0.5 } } } };
    expect(domainValidator.validate(crafted)).toEqual({ ok: false, violations: ["I10: Bed (0.00–1.00) overlaps a wall in Layout"] });
  });
});

