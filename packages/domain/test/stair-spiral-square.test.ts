import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// A spiral's width always equals its depth (stairs.21; fixes AC-10). `setObjectSize` and `resizePlacement` already square
// it; a switch of kind and a drawn footprint didn't, so its treads no longer reached its back edge.

const room = (): Document => rectDoc(0, 0, 10, 8);
const ok = (doc: Document, c: Command) => unwrap(execute(doc, c)).doc;
const sizeOf = (doc: Document, id: string) => {
  const o = doc.objects[id];
  if (!o) throw new Error(`no ${id}`);
  return [o.w.standard, o.d.standard];
};

describe("a spiral stays square", () => {
  it("a straight stair switched to Spiral stair stores width equal to depth, and stays valid", () => {
    const placed = ok(room(), { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "stair" }, at: { x: 5, y: 7 } });
    const doc = ok(placed, { type: "setObjectKind", objectId: "s/o0", kind: "spiralStair" });
    const [w, d] = sizeOf(doc, "s/o0");
    expect(w).toBe(d);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("a spiral drawn 1.40 × 2.20 stores a square", () => {
    const doc = ok(room(), { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "spiralStair", size: { w: 1.4, d: 2.2 } }, at: { x: 5, y: 7 } });
    const [w, d] = sizeOf(doc, "s/o0");
    expect(w).toBe(d);
  });

  it("a straight stair keeps its own drawn size", () => {
    const doc = ok(room(), { type: "placeObject", deck: null, opId: "s", state: "s0", object: { kind: "stair", size: { w: 1.1, d: 3 } }, at: { x: 5, y: 7 } });
    expect(sizeOf(doc, "s/o0")).toEqual([1.1, 3]);
  });
});
