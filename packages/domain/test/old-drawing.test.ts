import { describe, expect, it } from "vitest";
import { isRecord, parseStoredDocument, unwrap, type Result } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { kindOf, presetOf } from "../src/kinds";
import type { Document } from "../src/model";
import { clearanceWarnings } from "../src/queries/clearance";
import { zoneExtent } from "../src/queries/footprints";
import { freeFloor } from "../src/queries/free-floor";
import { zones } from "../src/queries/zones";
import { deserialize, serialize, upgradeStored } from "../src/serialize";
import { fromStored } from "../src/shape-tables";
import { nullZones } from "../src/use-zone";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// AC-11 (smart.14, .16, .23): a drawing saved before the cycle stored no placement sides; it opens, from a local file
// and from the server's store, with each kind's default sides and nothing else changed.

const ok = (doc: Document, cmd: Command): Document => unwrap(execute(doc, cmd)).doc;
const placeNew = (doc: Document, opId: string, kind: string, x: number, y: number, rotation = 0): Document =>
  ok(doc, { type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, rotation });

/**
 * The 6 × 4 room (inner faces at 0.1 and 5.9 / 3.9) in Day, copied to Night, where the folding table is folded and
 * the sofa bed is a bed. Placement anchors are back-edge midpoints:
 *   bed      b/o0  1.60 × 2.00, x 0.15–1.75, y 1.9–3.9, its left side 5 cm from the left wall
 *   desk     d/o0  x 4.4–5.6, y 3.3–3.9; front zone y 2.5–3.3, with chair c/o0 (y 2.75–3.2) in it
 *   folding  t/o0  turned 180°, open y 0.1–0.9; front zone y 0.9–1.5, with chair e/o0 (y 0.95–1.4) in it
 *   wardrobe w/o0  x 2.4–3.6, y 3.3–3.9
 *   sofa bed s/o0  turned 180° at x 4.8; 2.10 wide as a sofa (the "3 seats" size) and 1.80 as a bed, as pre-cycle
 *                  code could store, so only a check of every configuration's width finds no preset
 */
function original(): Document {
  let doc = rectDoc(0, 0, 6, 4);
  doc = placeNew(doc, "b", "bed", 2, 3.9); // placed clear at the default size, then sized and moved to the wall
  doc = ok(doc, { type: "setObjectSize", objectId: "b/o0", w: 1.6, d: { standard: 2 } });
  doc = ok(doc, { type: "movePlacement", placementId: "b/p0", at: { x: 0.95, y: 3.9 }, rotation: 0 });
  doc = placeNew(doc, "d", "desk", 5, 3.9);
  doc = placeNew(doc, "c", "chair", 5, 3.2);
  doc = placeNew(doc, "t", "foldingTable", 3, 0.1, 180);
  doc = ok(doc, { type: "setConfiguration", placementId: "t/p0", config: "open" });
  doc = placeNew(doc, "e", "chair", 3, 1.4);
  doc = placeNew(doc, "w", "wardrobe", 3, 3.9);
  doc = placeNew(doc, "s", "sofaBed", 4.8, 0.1, 180);
  doc = ok(doc, { type: "renameState", stateId: "s0", name: "Day" });
  doc = ok(doc, { type: "copyState", opId: "n", from: "s0", name: "Night" });
  const night = (object: string) => Object.values(doc.placements).find((p) => p.state === "n/s0" && p.object === object)?.id ?? "";
  doc = ok(doc, { type: "setConfiguration", placementId: night("t/o0"), config: "folded" });
  doc = ok(doc, { type: "setConfiguration", placementId: night("s/o0"), config: "bed" });
  const sofaBed = doc.objects["s/o0"];
  if (!sofaBed) throw new Error("no sofa bed");
  // Old defaults, with widths that differ per configuration (no command writes them any more, smart.16).
  return { ...doc, objects: { ...doc.objects, "s/o0": { ...sofaBed, w: { sofa: 2.1, bed: 1.8 }, d: { sofa: 0.9, bed: 1.6 } } } };
}

/** The original as pre-cycle code saved it: no placement has `sides` or `zones`. */
function preCycleJson(doc: Document): Record<string, unknown> {
  const json: Record<string, unknown> = JSON.parse(JSON.stringify(serialize(doc)));
  const placements = json.placements;
  if (!isRecord(placements)) throw new Error("no placements");
  for (const p of Object.values(placements)) {
    if (!isRecord(p)) continue;
    delete p.sides;
    delete p.zones;
  }
  return json;
}

const opened = (r: Result<Document, unknown>): Document => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe("a drawing saved before the smart cycle (AC-11)", () => {
  it("a drawing saved before the cycle opens with its kinds' default sides, its sizes, areas and fit unchanged (AC-11)", () => {
    const before = original();
    expect(validateDocument(before).ok).toBe(true);
    const json = preCycleJson(before);
    expect(JSON.stringify(json.placements)).not.toContain("sides");
    expect(JSON.stringify(json.placements)).not.toContain("zones");
    const stored = parseStoredDocument(json);
    if (!stored) throw new Error("unparseable");
    const loads: [string, Document][] = [
      ["deserialize (local file)", opened(deserialize(json))],
      ["fromStored(upgradeStored) (server)", opened(fromStored(upgradeStored(stored)))],
    ];
    const states = Object.keys(before.states).sort();
    expect(states).toEqual(["n/s0", "s0"]);

    for (const [how, doc] of loads) {
      expect(Object.keys(doc.placements).length, how).toBe(14);
      for (const p of Object.values(doc.placements)) {
        const kind = kindOf(doc.objects[p.object]?.kind ?? "");
        expect(p.sides, `${how}: ${p.id}`).toEqual(kind?.sides);
        expect(p.zones, `${how}: ${p.id}`).toEqual(nullZones());
      }
      expect(doc.objects, how).toEqual(before.objects);
      expect(doc.objects["b/o0"], how).toMatchObject({ w: { standard: 1.6 }, d: { standard: 2 } });
      expect(zones(doc).map((z) => z.area), how).toEqual(zones(before).map((z) => z.area));
      for (const s of states) expect([...freeFloor(doc, s)], `${how}: ${s}`).toEqual([...freeFloor(before, s)]);
      expect(validateDocument(doc).ok, how).toBe(true);
      expect(presetOf(doc.objects["s/o0"] ?? { kind: "sofaBed", w: {}, d: {} }), how).toBeNull();
      // AC-21 load: no stored zones, so the bed's left zone reads the kind's default, 0.45 m short of the head.
      const bedP = doc.placements["b/p0"];
      expect(bedP && zoneExtent(doc, bedP, "left"), how).toEqual({ depth: 0.6, start: 0.45, end: 0 });

      for (const s of states) {
        const warnings = clearanceWarnings(doc, s);
        const bed = before.placements[s === "s0" ? "b/p0" : Object.values(before.placements).find((p) => p.state === s && p.object === "b/o0")?.id ?? ""];
        // The bed warns on its left side, against the left wall, and on no other side.
        expect(warnings.filter((w) => w.zone.table === "placements" && w.zone.id === bed?.id), `${how}: ${s}`).toEqual([
          { zone: { table: "placements", id: bed?.id, side: "left" }, against: { table: "walls", id: "W4" } },
        ]);
        // No chair blocks the desk's or the folding table's zone.
        const chairs = new Set(Object.values(doc.placements).filter((p) => doc.objects[p.object]?.kind === "chair").map((p) => p.id));
        expect(warnings.filter((w) => chairs.has(w.against.id)), `${how}: ${s}`).toEqual([]);
        expect(warnings, `${how}: ${s}`).toEqual(clearanceWarnings(before, s));
      }
    }
    // The chairs really sit in the zones the seat rule clears: a block in the desk chair's place warns.
    const noChair = ok(before, { type: "removePlacement", placementId: "c/p0" });
    const blocked = ok(noChair, { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "block" }, at: { x: 5, y: 3.2 } });
    expect(clearanceWarnings(blocked, "s0")).toContainEqual({ zone: { table: "placements", id: "d/p0", side: "front" }, against: { table: "placements", id: "k/p0" } });
  });
});
