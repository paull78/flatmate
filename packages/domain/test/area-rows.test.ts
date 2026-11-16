import { unwrap } from "@fm/protocol";
import { describe, expect, it } from "vitest";
import { deleteEntities } from "../src/commands/delete-entities";
import type { Area } from "../src/model";
import { applyPatch, invertPatch } from "../src/patch";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// The areas table's rows (areas step 01): shape-checked by I8, deleted by deleteEntities, restored by the inverse.

const kitchen: Area = { id: "nook/a0", name: "Kitchen", at: { x: 2, y: 1.5 }, w: 2, d: 1.5 };
const withArea = (area: Area, key = area.id) => ({ ...rectDoc(0, 0, 6, 4), areas: { [key]: area } });
const i8Areas = (area: Area): boolean => {
  const r = validateDocument(withArea(area, "nook/a0"));
  return !r.ok && r.error.some((v) => v.invariant === "I8" && v.entities.some((k) => k.table === "areas" && k.id === "nook/a0"));
};

describe("area rows", () => {
  it("a well-formed area is a valid drawing", () => {
    expect(validateDocument(withArea(kitchen))).toEqual({ ok: true, value: undefined });
  });

  it("I8 refuses an area with a mismatched ID or a non-finite centre, naming the row", () => {
    expect(i8Areas({ ...kitchen, id: "other/a0" })).toBe(true);
    expect(i8Areas({ ...kitchen, at: { x: Number.POSITIVE_INFINITY, y: 1 } })).toBe(true);
  });

  it("deleteEntities deletes an area, and its inverse restores it", () => {
    const doc = withArea(kitchen);
    const r = unwrap(deleteEntities(doc, { type: "deleteEntities", ids: [{ table: "areas", id: kitchen.id }] }));
    expect(r.doc.areas).toEqual({});
    expect(unwrap(applyPatch(r.doc, invertPatch(r.patch))).areas).toEqual(doc.areas);
  });

  it("deleting an unknown area is refused", () => {
    expect(deleteEntities(withArea(kitchen), { type: "deleteEntities", ids: [{ table: "areas", id: "gone/a0" }] }).ok).toBe(false);
  });
});
