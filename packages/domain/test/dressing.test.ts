import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { SHEER, SHUTTER_BOX, dressingOf, roomSideOf } from "../src/queries/dressing";
import { deserialize, serialize } from "../src/serialize";
import { rehost, runFrom } from "../src/commands/split-openings";
import { docOf } from "./helpers";

// A window's dressing (hangings step 04, AC-05, AC-06, AC-07, AC-10): a sheer curtain to the glass or the floor and a
// shutter box, two optional fields on the opening row, only on a window kind, on the room side (hangings.04).

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, cmd) => {
  const r = execute(d, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}, doc);
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};

/**
 * A 6 × 4 room (walls 0.2 thick, 2.5 tall) split at x = 3 into Bath and Main, labelled; AB runs +x along the bottom
 * (its left faces +y, into the room), CD runs −x along the top (its left faces −y, into the room), BE is the divider.
 */
function rooms(): Document {
  return docOf({
    joints: [["A", 0, 0], ["B", 3, 0], ["C", 6, 0], ["D", 6, 4], ["E", 3, 4], ["F", 0, 4]],
    walls: [["AB", "A", "B"], ["BC", "B", "C"], ["CD", "C", "D"], ["DE", "D", "E"], ["EF", "E", "F"], ["FA", "F", "A"], ["BE", "B", "E"]],
    labels: [["Bath", 1.5, 2, "Bath"], ["Main", 4.5, 2, "Main"]],
  });
}
const withWindow = (doc: Document, wall: string, opId = "w", extra: Partial<Extract<Command, { type: "addOpening" }>> = {}): Document =>
  run(doc, { type: "addOpening", opId, wall, kind: "window", offset: 1, width: 1, ...extra });

describe("a window's dressing (step 04, AC-05)", () => {
  it("a window takes a sheer to the glass or the floor and a shutter box; none and false remove them", () => {
    let doc = withWindow(rooms(), "AB");
    doc = run(doc, { type: "setOpening", openingId: "w/d0", sheer: "floor", shutterBox: true });
    expect([doc.openings["w/d0"]?.sheer, doc.openings["w/d0"]?.shutterBox]).toEqual(["floor", true]);
    doc = run(doc, { type: "setOpening", openingId: "w/d0", sheer: "glass" });
    expect(doc.openings["w/d0"]?.sheer).toBe("glass");
    doc = run(doc, { type: "setOpening", openingId: "w/d0", sheer: "none", shutterBox: false });
    expect(Object.keys(doc.openings["w/d0"] ?? {})).not.toContain("sheer");
    expect(Object.keys(doc.openings["w/d0"] ?? {})).not.toContain("shutterBox");
  });

  it("addOpening takes them too; a casement and a two-leaf window take them", () => {
    const doc = withWindow(rooms(), "AB", "w", { sheer: "glass", shutterBox: true });
    expect([doc.openings["w/d0"]?.sheer, doc.openings["w/d0"]?.shutterBox]).toEqual(["glass", true]);
    for (const kind of ["casement", "twoLeaf"] as const) {
      expect(refusal(rooms(), { type: "addOpening", opId: kind, wall: "AB", kind, offset: 1, width: 0.8, sheer: "floor" }), kind).toBe("accepted");
    }
  });

  it("a door, a doorway or a sliding glass door refuses them, naming what", () => {
    for (const kind of ["swing", "slidingGlass", "passage", "curtain"] as const) {
      const r = refusal(rooms(), { type: "addOpening", opId: kind, wall: "AB", kind, offset: 0.5, width: 1, sheer: "floor" });
      expect(r, kind).toMatch(/takes no sheer curtain or shutter box/);
    }
  });

  it("setting a dressing on a door refuses it; taking one off a door is no change", () => {
    const doc = run(rooms(), { type: "addOpening", opId: "d", wall: "AB", kind: "swing", offset: 0.5, width: 0.8 });
    expect(refusal(doc, { type: "setOpening", openingId: "d/d0", sheer: "floor" })).toBe("A door takes no sheer curtain or shutter box");
    expect(refusal(doc, { type: "setOpening", openingId: "d/d0", shutterBox: true })).toBe("A door takes no sheer curtain or shutter box");
    expect(refusal(doc, { type: "setOpening", openingId: "d/d0", sheer: "none", shutterBox: false })).toBe("accepted");
  });

  it("switching a dressed window to a door drops the dressing", () => {
    const doc = run(withWindow(rooms(), "AB", "w", { sheer: "floor", shutterBox: true }), { type: "setOpening", openingId: "w/d0", kind: "swing" });
    expect([doc.openings["w/d0"]?.sheer, doc.openings["w/d0"]?.shutterBox]).toEqual([undefined, undefined]);
  });

  it("setting only the sheer changes the row: one patch, one undo step", () => {
    const doc = withWindow(rooms(), "AB");
    const r = execute(doc, { type: "setOpening", openingId: "w/d0", sheer: "glass" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.patch.puts.map((p) => p.table)).toEqual(["openings"]);
  });
});

describe("the shutter box's room (step 04, AC-06)", () => {
  it("needs 0.25 m of wall above the head: refused naming 0.25 under a high head", () => {
    const high = withWindow(rooms(), "AB", "w", { sill: 1, head: 2.3 }); // 0.20 left under 2.50
    expect(refusal(high, { type: "setOpening", openingId: "w/d0", shutterBox: true })).toMatch(/0\.25 m/);
    const ok = withWindow(rooms(), "AB", "w", { sill: 1, head: 2.25 });
    expect(refusal(ok, { type: "setOpening", openingId: "w/d0", shutterBox: true })).toBe("accepted");
  });
});

describe("stacked windows (step 04, AC-06)", () => {
  it("a window above one with a shutter box keeps the box's 0.25 m clear of it", () => {
    const low = withWindow(rooms(), "AB", "w", { sill: 0.3, head: 1, shutterBox: true });
    expect(refusal(low, { type: "addOpening", opId: "up", wall: "AB", kind: "window", offset: 1, width: 1, sill: 1.15, head: 1.8 })).toMatch(/0\.25 m of wall between/);
    expect(refusal(low, { type: "addOpening", opId: "up", wall: "AB", kind: "window", offset: 1, width: 1, sill: 1.25, head: 1.8 })).toBe("accepted");
  });

  it("a doorway refuses a dressing as an opening", () => {
    expect(refusal(rooms(), { type: "addOpening", opId: "p", wall: "AB", kind: "passage", offset: 0.5, width: 1, shutterBox: true })).toBe("An opening takes no sheer curtain or shutter box");
  });
});

describe("the room side (step 04, AC-07)", () => {
  it("an outer window's room side faces its room whichever way the wall runs", () => {
    expect(roomSideOf(withWindow(rooms(), "AB"), "w/d0")).toBe("left"); // AB runs +x: its left is +y, the Bath
    expect(roomSideOf(withWindow(rooms(), "CD"), "w/d0")).toBe("left"); // CD runs +y on the east: its left is −x, Main
    expect(roomSideOf(withWindow(rooms(), "EF"), "w/d0")).toBe("left"); // EF runs −x along the top: its left is −y, the Bath
    expect(roomSideOf(withWindow(rooms(), "AB", "w", { side: "right" }), "w/d0")).toBe("left"); // the stored side doesn't matter outside
  });

  it("a divider's is the opening's own side", () => {
    expect(roomSideOf(withWindow(rooms(), "BE", "w", { side: "right" }), "w/d0")).toBe("right");
    expect(roomSideOf(withWindow(rooms(), "BE", "w", { side: "left" }), "w/d0")).toBe("left");
  });
});

describe("the dressing's geometry (step 04, AC-07)", () => {
  it("the box sits on the room-side face above the head, the window's width, 0.25 tall and 0.12 deep", () => {
    const doc = withWindow(rooms(), "AB", "w", { shutterBox: true, sill: 0.9, head: 2.1 });
    const g = dressingOf(doc, "w/d0");
    const box = g?.box;
    expect(box && [box.bottom, box.top]).toEqual([2.1, 2.1 + SHUTTER_BOX.height]);
    const ys = (box?.quad ?? []).map((p) => p.y);
    expect([Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.1, 0.1 + SHUTTER_BOX.depth]); // AB's inner face at y 0.1
    const xs = (box?.quad ?? []).map((p) => p.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([1, 2]);
  });

  it("the curtain hangs from 0.05 above the head, 0.06 off the face, to the sill or the floor; in front of the box with one", () => {
    const plain = dressingOf(withWindow(rooms(), "AB", "w", { sheer: "glass", sill: 0.9, head: 2.1 }), "w/d0")?.curtain;
    expect(plain && [plain.bottom, plain.top]).toEqual([0.9, 2.1 + SHEER.rail]);
    expect(plain?.line.map((p) => Math.round(p.y * 1e6) / 1e6)).toEqual([0.1 + SHEER.off, 0.1 + SHEER.off]);
    const floor = dressingOf(withWindow(rooms(), "AB", "w", { sheer: "floor", shutterBox: true, sill: 0.9, head: 2.1 }), "w/d0")?.curtain;
    expect(floor && [floor.bottom, floor.top]).toEqual([0, 2.1 + SHUTTER_BOX.height]);
    expect(floor?.line.map((p) => Math.round(p.y * 1e6) / 1e6)).toEqual([0.1 + SHUTTER_BOX.depth + SHEER.off, 0.1 + SHUTTER_BOX.depth + SHEER.off]);
  });

  it("a plain window has no dressing", () => {
    expect(dressingOf(withWindow(rooms(), "AB"), "w/d0")).toBeNull();
  });
});

describe("stored rows (step 04, AC-10)", () => {
  it("rows with and without the fields round-trip", () => {
    const doc = withWindow(withWindow(rooms(), "AB", "a", { sheer: "floor", shutterBox: true }), "CD", "b");
    const back = deserialize(serialize(doc));
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.openings).toEqual(doc.openings);
    expect(Object.keys(back.value.openings["b/d0"] ?? {})).toEqual(["id", "wall", "kind", "offset", "width", "side", "hinge", "glazed", "sill", "head"]);
  });
});

describe("a dressed window moved onto another wall in its line (step 08 check)", () => {
  it("keeps its sheer and its box, its side flipped with a wall that runs the other way", () => {
    const doc = withWindow(rooms(), "BE", "w", { side: "right", sheer: "floor", shutterBox: true });
    const o = doc.openings["w/d0"];
    if (!o) throw new Error("no window");
    const same = rehost(o, runFrom({ x: 3, y: 0 }, { x: 3, y: 4 }), runFrom({ x: 3, y: 0 }, { x: 3, y: 4 }), "BE");
    const reversed = rehost(o, runFrom({ x: 3, y: 0 }, { x: 3, y: 4 }), runFrom({ x: 3, y: 4 }, { x: 3, y: 0 }), "EB");
    expect([same.sheer, same.shutterBox, same.side]).toEqual(["floor", true, "right"]);
    expect([reversed.sheer, reversed.shutterBox, reversed.side]).toEqual(["floor", true, "left"]);
  });
});
