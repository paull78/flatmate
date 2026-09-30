import { describe, expect, it } from "vitest";
import { faceAt, orphanLabelIds, zoneOfLabel, zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

const divided = () =>
  docOf({
    joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    labels: [["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"], ["L9", 20, 20, "Lost"]],
  });

describe("zones", () => {
  it("gives each demo room 10.64 m² and resolves labels by containment", () => {
    const z = zones(divided());
    expect(z.map((x) => x.area?.toFixed(2))).toEqual(["10.64", "10.64"]);
    expect(z.flatMap((x) => x.labelIds).sort()).toEqual(["L1", "L2"]);
    expect(orphanLabelIds(divided())).toEqual(["L9"]);
  });

  it("looks up a label's room from the cached result (P2)", () => {
    const doc = divided();
    const kitchen = zones(doc).find((z) => z.labelIds.includes("L1"));
    expect(kitchen).toBeDefined();
    expect(zoneOfLabel(doc, "L1")).toBe(kitchen);
    expect(zoneOfLabel(doc, "L9")).toBeNull(); // orphan
    expect(zoneOfLabel(doc, "missing")).toBeNull();
    expect(zoneOfLabel(doc, "constructor")).toBeNull(); // not an inherited Object member
  });

  it("memoizes by document identity", () => {
    const doc = divided();
    expect(zones(doc)).toBe(zones(doc));
  });

  it("reports unavailable area without failing", () => {
    const narrow = rectDoc(0, 0, 0.15, 3);
    const [z] = zones(narrow);
    expect(z?.area).toBeNull();
    expect(z?.unavailable).toBe("Area unavailable: unsupported geometry");
    expect(validateDocument(narrow).ok).toBe(true);
  });

  it("reports unavailable area for a 0.10 m square, and the drawing stays valid (spec §9)", () => {
    const square = rectDoc(0, 0, 0.1, 0.1);
    const [z] = zones(square);
    expect(z?.area).toBeNull();
    expect(z?.unavailable).toBe("Area unavailable: unsupported geometry");
    expect(validateDocument(square).ok).toBe(true);
  });

  it("gives a face whose walk repeats a joint no area and no labels: a label inside it is an orphan", () => {
    // A triangle hangs from the room's corner J1, so the room's walk passes J1 twice (spec §3.6 step 3).
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T1", 2, 1], ["T2", 1, 2]],
      walls: [
        ["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"],
        ["A1", "J1", "T1"], ["A2", "T1", "T2"], ["A3", "T2", "J1"],
      ],
      labels: [["L1", 4, 3, "Hall"]],
    });
    const room = zones(doc).find((z) => z.face.wallIds.includes("W1"));
    expect(room).toMatchObject({ area: null, floor: null, unavailable: "Area unavailable: unsupported boundary", labelIds: [] });
    expect(orphanLabelIds(doc)).toEqual(["L1"]);
    expect(faceAt(doc, { x: 4, y: 3 })).toBeNull();
  });

  it("resolves a label in a room whose area is unavailable to that room (spec §3.6 step 6)", () => {
    const narrow = rectDoc(0, 0, 0.15, 3); // too narrow for its walls: the inset fails
    narrow.zoneLabels.L1 = { id: "L1", at: { x: 0.075, y: 1.5 }, name: "Duct" };
    const [z] = zones(narrow);
    expect(z?.area).toBeNull();
    expect(z?.unavailable).toBe("Area unavailable: unsupported geometry");
    expect(z?.labelIds).toEqual(["L1"]);
    expect(orphanLabelIds(narrow)).toEqual([]);
  });

  it("finds the face under a point, but not on a boundary or outside", () => {
    const doc = divided();
    expect(faceAt(doc, { x: 1, y: 1 })?.wallIds).toContain("D");
    expect(faceAt(doc, { x: 3, y: 2 })).toBeNull();
    expect(faceAt(doc, { x: 3.0005, y: 2 })).toBeNull();
    expect(faceAt(doc, { x: 9, y: 2 })).toBeNull();
  });

  it("prefers the innermost face for a free-standing room inside another", () => {
    const outer = rectDoc(0, 0, 10, 10);
    const inner = docOf({
      joints: [["K1", 4, 4], ["K2", 6, 4], ["K3", 6, 6], ["K4", 4, 6]],
      walls: [["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"]],
    });
    const doc = { joints: { ...outer.joints, ...inner.joints }, walls: { ...outer.walls, ...inner.walls }, zoneLabels: {} };
    expect([...(faceAt(doc, { x: 5, y: 5 })?.wallIds ?? [])].sort()).toEqual(["V1", "V2", "V3", "V4"]);
    expect([...(faceAt(doc, { x: 1, y: 1 })?.wallIds ?? [])].sort()).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("does not fall back to the outer room for a point in an unsupported inner room", () => {
    // Outer room 0..10 around a free-standing inner room 3..7; a triangle hangs inside the inner room
    // from its corner K1, so the inner room's walk passes K1 twice and it is not simple.
    const outer = rectDoc(0, 0, 10, 10);
    const inner = docOf({
      joints: [["K1", 3, 3], ["K2", 7, 3], ["K3", 7, 7], ["K4", 3, 7], ["T1", 4, 3.5], ["T2", 3.5, 4]],
      walls: [
        ["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"],
        ["A1", "K1", "T1"], ["A2", "T1", "T2"], ["A3", "T2", "K1"],
      ],
      labels: [["L1", 6, 6, "Store"], ["L2", 1, 1, "Hall"]],
    });
    const doc = { joints: { ...outer.joints, ...inner.joints }, walls: { ...outer.walls, ...inner.walls }, zoneLabels: inner.zoneLabels };
    expect(orphanLabelIds(doc)).toEqual(["L1"]);
    expect(faceAt(doc, { x: 6, y: 6 })).toBeNull();
    const hall = zones(doc).find((z) => z.face.wallIds.includes("W1"));
    expect(hall?.labelIds).toEqual(["L2"]);
    expect([...(faceAt(doc, { x: 1, y: 1 })?.wallIds ?? [])].sort()).toEqual(["W1", "W2", "W3", "W4"]);
    // Just outside the inner room's wall is still within EPS of a room boundary.
    expect(faceAt(doc, { x: 2.9995, y: 5 })).toBeNull();
    // The hanging triangle is itself a simple room.
    expect([...(faceAt(doc, { x: 3.6, y: 3.6 })?.wallIds ?? [])].sort()).toEqual(["A1", "A2", "A3"]);
  });

  it("types shared results as read-only all the way down (checked by pnpm typecheck)", () => {
    const doc = divided();
    // Never called: it only has to fail to compile, and calling it would corrupt the memo.
    const mutations = (): void => {
      // @ts-expect-error ring points of a zone's face are read-only
      zones(doc)[0]!.face.ring[0]!.x = 1;
      // @ts-expect-error floor points are read-only
      zones(doc)[0]!.floor![0]!.x = 1;
      // @ts-expect-error faceAt returns a ring shared with the memo
      faceAt(doc, { x: 1, y: 1 })!.ring[0]!.y = 1;
    };
    expect(mutations).toBeTypeOf("function");
  });
});
