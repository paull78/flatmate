import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { MIN_HEIGHT, OBJECT_KINDS, defaultSize, kindConfigs, presetOf, presetSize } from "../src/kinds";
import type { Document } from "../src/model";
import { deserialize, serialize } from "../src/serialize";
import { parseLayoutObject } from "../src/shape";
import { place, rectDoc } from "./helpers";

// Presets with heights (catalog.07, .22, step 11): a preset may carry a height and an elevation per configuration,
// read through presetSize; heights go down to MIN_HEIGHT (0.01 m), width and depth keep their 0.10 m minimum.

const run = (doc: Document, cmd: Command) => execute(doc, cmd);
const ok = (doc: Document, cmd: Command): Document => unwrap(run(doc, cmd)).doc;
const refusal = (doc: Document, cmd: Command): string => {
  const r = run(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
/** A 6 × 4 room; inner faces at x 0.1 / 5.9, y 0.1 / 3.9. */
const room = (): Document => rectDoc(0, 0, 6, 4);
const placeKind = (kind: string, object: { preset?: string; size?: { w: number; d: number } } = {}): Command => ({
  type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind, ...object }, at: { x: 3, y: 3.9 },
});
const washer = (h: number) => ({ kind: "washingMachine", w: { standard: 0.6 }, d: { standard: 0.6 }, h: { standard: h }, z: { standard: 0 } });

describe("presetSize (catalog.17)", () => {
  it("gives the full sizes: the preset's width, depths and heights, else the kind's defaults", () => {
    expect(presetSize("washingMachine", "Washer-dryer")).toEqual({ w: { standard: 0.6 }, d: { standard: 0.6 }, h: { standard: 1.7 }, z: { standard: 0 } });
    expect(presetSize("washingMachine", "Washer")).toEqual({ w: { standard: 0.6 }, d: { standard: 0.6 }, h: { standard: 0.85 }, z: { standard: 0 } });
    expect(presetSize("bed", "Single")).toEqual({ w: { standard: 1 }, d: { standard: 2.1 }, h: { standard: 1 }, z: { standard: 0 } });
    expect(presetSize("bed", "Nope")).toBeNull();
    expect(presetSize("piano", "Single")).toBeNull();
  });

  it("from a piece's sizes, a preset without a height keeps the piece's height and elevation (spec Preset lists)", () => {
    const raised = { w: { standard: 1.7 }, d: { standard: 2.1 }, h: { standard: 0.6 }, z: { standard: 0.3 } };
    expect(presetSize("bed", "Single", raised)).toEqual({ w: { standard: 1 }, d: { standard: 2.1 }, h: { standard: 0.6 }, z: { standard: 0.3 } });
    expect(presetSize("washingMachine", "Washer-dryer", washer(1))?.h).toEqual({ standard: 1.7 });
  });
});

describe("placing a preset with a height", () => {
  it("placeObject washingMachine preset Washer-dryer gives h 1.70", () => {
    expect(ok(room(), placeKind("washingMachine", { preset: "Washer-dryer" })).objects["a/o0"]).toMatchObject(washer(1.7));
  });

  it("a preset without h keeps the kind's default height", () => {
    const bed = ok(room(), placeKind("bed", { preset: "Single" })).objects["a/o0"];
    expect(bed).toMatchObject({ w: { standard: 1 }, d: { standard: 2.1 }, h: defaultSize("bed")?.h, z: defaultSize("bed")?.z });
  });

  it("a drawn size with a preset takes the drawn width and depth and the preset's heights (the Object tool's drawn ghost)", () => {
    const drawn = ok(room(), placeKind("washingMachine", { preset: "Washer-dryer", size: { w: 0.7, d: 0.65 } })).objects["a/o0"];
    expect(drawn).toMatchObject({ w: { standard: 0.7 }, d: { standard: 0.65 }, h: { standard: 1.7 } });
  });
});

describe("setObjectSize and presetOf with heights", () => {
  it("setObjectSize with a preset's sizes round-trips through storage", () => {
    const doc = place(room(), { object: "m", kind: "washingMachine", at: [3, 3.9] });
    const size = presetSize("washingMachine", "Washer-dryer", doc.objects.m);
    if (!size) throw new Error("no preset");
    const sized = ok(doc, { type: "setObjectSize", objectId: "m", ...size, w: 0.6 });
    expect(sized.objects.m).toMatchObject(washer(1.7));
    expect(unwrap(deserialize(JSON.parse(JSON.stringify(serialize(sized)))))).toEqual(sized);
  });

  it("presetOf tells the two washer presets apart by height alone", () => {
    expect(presetOf(washer(1.7))?.id).toBe("Washer-dryer");
    expect(presetOf(washer(0.85))?.id).toBe("Washer");
    expect(presetOf(washer(0.854))?.id).toBe("Washer"); // to the shown centimetre, as width and depth
    expect(presetOf(washer(1.2))).toBeNull();
    expect(presetOf({ kind: "washingMachine", w: { standard: 0.6 }, d: { standard: 0.6 } })).toBeNull(); // a missing height never matches
  });

  it("presetOf ignores the height for a preset without one", () => {
    expect(presetOf({ kind: "bed", w: { standard: 1 }, d: { standard: 2.1 }, h: { standard: 0.4 }, z: { standard: 0.5 } })?.id).toBe("Single");
  });
});

describe("heights from MIN_HEIGHT (catalog.22)", () => {
  it("setObjectSize accepts a height of 0.01 and refuses 0.005; width and depth keep 0.02", () => {
    expect(MIN_HEIGHT).toBe(0.01);
    const doc = place(room(), { object: "m", kind: "washingMachine", at: [3, 3.9] });
    expect(ok(doc, { type: "setObjectSize", objectId: "m", w: 0.6, d: {}, h: { standard: 0.01 } }).objects.m?.h).toEqual({ standard: 0.01 });
    expect(refusal(doc, { type: "setObjectSize", objectId: "m", w: 0.6, d: {}, h: { standard: 0.005 } })).toBe("Height must be between 0.01 and 10 m");
    expect(refusal(doc, { type: "setObjectSize", objectId: "m", w: 0.6, d: {}, h: { standard: 10.5 } })).toBe("Height must be between 0.01 and 10 m");
    expect(refusal(doc, { type: "setObjectSize", objectId: "m", w: 0.6, d: { standard: 0.01 } })).toBe("Size must be between 0.02 and 10 m");
    expect(refusal(doc, { type: "setObjectSize", objectId: "m", w: 0.01, d: {} })).toBe("Size must be between 0.02 and 10 m");
  });

  it("setObjectSize takes a height of 0.01 on every kind, in every configuration", () => {
    for (const k of OBJECT_KINDS) {
      const doc = ok(rectDoc(0, 0, 12, 12), { type: "placeObject", deck: null, opId: "a", state: "s0", object: { kind: k.id }, at: { x: 6, y: 8 } });
      const h = Object.fromEntries(kindConfigs(k.id).map((c) => [c.id, 0.01]));
      const w = kindConfigs(k.id)[0]?.w ?? 1;
      expect(refusal(doc, { type: "setObjectSize", objectId: "a/o0", w, d: {}, h }), k.id).toBe("accepted");
    }
  });

  it("a stored row with h 0.01 parses; 0.005 and a 0.01 width don't", () => {
    const row = { id: "m", name: "Washing machine", ...washer(0.01) };
    expect(parseLayoutObject(row)).toEqual(row);
    expect(parseLayoutObject({ ...row, h: { standard: 0.005 } })).toBeNull();
    expect(parseLayoutObject({ ...row, w: { standard: 0.01 } })).toBeNull();
  });
});
