import { describe, expect, it } from "vitest";
import { unwrap } from "@fm/protocol";
import { execute } from "../src/commands/execute";
import { OBJECT_KINDS, canSwitchKind } from "../src/kinds";
import type { Document } from "../src/model";
import { validateDocument } from "../src/validate";
import { place, rectDoc } from "./helpers";

// The Kind switch and the `L` (spec "Around the pieces", catalog.28): an `ell` kind switches only to another `ell`
// kind, keeping its width, depth and arms; a straight kind never switches to an `ell` one.

const ELL = OBJECT_KINDS.filter((k) => k.outline === "ell").map((k) => k.id);
/** The kinds a piece's Kind field offers besides its own: every kind `canSwitchKind` allows. */
const kindList = (from: string) => OBJECT_KINDS.filter((k) => canSwitchKind(from, k.id)).map((k) => k.id);

/** A 6 × 5 room with a corner desk "k" against the back wall, arms 0.50 / 0.70 of its own. */
function withDesk(): Document {
  const doc = place(rectDoc(0, 0, 6, 5), { object: "k", kind: "cornerDesk", at: [3, 4.9] });
  const desk = doc.objects.k;
  if (!desk) throw new Error("no desk");
  return { ...doc, objects: { ...doc.objects, k: { ...desk, arms: { back: 0.5, left: 0.7 } } } };
}

describe("switching an L piece's kind", () => {
  it("cornerDesk → cornerWardrobe is allowed and keeps the width, depth and arms; the height becomes the wardrobe's", () => {
    expect(canSwitchKind("cornerDesk", "cornerWardrobe")).toBe(true);
    const doc = unwrap(execute(withDesk(), { type: "setObjectKind", objectId: "k", kind: "cornerWardrobe" })).doc;
    expect(doc.objects.k).toMatchObject({ kind: "cornerWardrobe", name: "Corner wardrobe", w: { standard: 1.6 }, d: { standard: 1.2 }, h: { standard: 2.05 }, arms: { back: 0.5, left: 0.7 } });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("desk → cornerDesk and cornerDesk → desk are refused", () => {
    expect(canSwitchKind("desk", "cornerDesk")).toBe(false);
    expect(canSwitchKind("cornerDesk", "desk")).toBe(false);
    const doc = place(rectDoc(0, 0, 6, 5), { object: "d", kind: "desk", at: [3, 4.9] });
    const r = execute(doc, { type: "setObjectKind", objectId: "d", kind: "cornerDesk" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("Can't switch Desk to Corner desk");
  });

  it("an L piece's Kind field lists only the other L kinds", () => {
    expect(ELL).toEqual(expect.arrayContaining(["cornerDesk", "cornerWardrobe", "cornerCounter", "cornerSofa"]));
    for (const id of ELL) expect(kindList(id), id).toEqual(ELL.filter((k) => k !== id));
  });

  it("a wardrobe's Kind field lists no L kind, nor does any straight kind's", () => {
    expect(kindList("wardrobe").filter((k) => ELL.includes(k))).toEqual([]);
    for (const k of OBJECT_KINDS.filter((x) => x.outline !== "ell")) expect(kindList(k.id).filter((id) => ELL.includes(id)), k.id).toEqual([]);
  });
});
