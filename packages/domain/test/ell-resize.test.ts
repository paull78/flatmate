import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { ResizeSide } from "../src/commands/types";
import type { Document } from "../src/model";
import { deepFreeze, place, rectDoc } from "./helpers";

// A side grip on an `L` piece (catalog.12): a resize that would break an arm is refused with the arm message, not
// "Invalid drawing".

const ARM_RULE = "An arm must be 0.10 m or more and 0.10 m shallower than the side it runs across";

/** A 6 × 5 room with a 1.60 × 1.20 corner desk "k", arms 0.60, against the back wall: x 2.2–3.8, y 3.7–4.9. */
const withDesk = (): Document => deepFreeze(place(rectDoc(0, 0, 6, 5), { object: "k", kind: "cornerDesk", at: [3, 4.9] }));
const resize = (side: ResizeSide, size: number) => execute(withDesk(), { type: "resizePlacement", placementId: "k/s0", side, size });

describe("resizing an L piece", () => {
  it("the front grip to 0.65 on a desk with a 0.60 back arm is refused with the arm message; to 0.70 accepted", () => {
    expect(resize("front", 0.65)).toMatchObject({ ok: false, error: { message: ARM_RULE } });
    const r = resize("front", 0.7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.doc.objects.k).toMatchObject({ d: { standard: 0.7 }, arms: { back: 0.6, left: 0.6 } });
  });

  it("a side grip to 0.65 against the 0.60 left arm is refused with the arm message; to 0.70 accepted", () => {
    expect(resize("right", 0.65)).toMatchObject({ ok: false, error: { message: ARM_RULE } });
    expect(resize("right", 0.7).ok).toBe(true);
  });
});
