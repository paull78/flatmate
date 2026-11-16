import { describe, expect, it } from "vitest";
import { emptyDocument, type Document } from "../src/model";
import { faceAt, orphanLabelIds, zoneOfLabel, zones, type Zone } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { A, C, docOf, K, loops, rectDoc, rectLoop, type Spec } from "./helpers";

const divided = () =>
  docOf({
    joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
    walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    labels: [["L1", 1.5, 2, "Kitchen"], ["L2", 4.5, 2, "Dining"], ["L9", 20, 20, "Lost"]],
  });

describe("zones", () => {
  it("gives each sample room 10.64 m² and resolves labels by containment", () => {
    const z = zones(divided());
    expect(z.map((x) => x.area?.toFixed(2))).toEqual(["10.64", "10.64"]);
    expect(z.flatMap((x) => x.labelIds).sort()).toEqual(["L1", "L2"]);
    expect(orphanLabelIds(divided())).toEqual(["L9"]);
  });

  it("gives each sample room 0.05 m more width when the divider is 0.10 m: 2.85 × 3.8 = 10.83 m² (layout-states.27)", () => {
    const base = divided();
    const doc = { ...base, walls: { ...base.walls, D: { id: "D", a: "S1", b: "S2", thickness: 0.1, top: "ceiling" as const, base: "floor", column: false } } };
    expect(zones(doc).map((z) => z.area?.toFixed(4))).toEqual(["10.8300", "10.8300"]);
  });

  it("passes a face's holes on to its zone", () => {
    const doc = loops(rectLoop("A", 0, 0, 10, 8), rectLoop("C", 3.5, 2.5, 6.5, 5.5));
    const apartment = zones(doc).find((z) => z.face.key === "A1|A2|A3|A4");
    expect(apartment?.face.holes.map((h) => [...h.wallIds].sort().join("|"))).toEqual(["C1|C2|C3|C4"]);
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

  it("reports unavailable area for a 0.10 m square, and the drawing stays valid (docs/architecture.md)", () => {
    const square = rectDoc(0, 0, 0.1, 0.1);
    const [z] = zones(square);
    expect(z?.area).toBeNull();
    expect(z?.unavailable).toBe("Area unavailable: unsupported geometry");
    expect(validateDocument(square).ok).toBe(true);
  });

  it("gives a face whose walk repeats a joint no area and no labels: a label inside it is an orphan", () => {
    // A triangle hangs from the room's corner J1, so the room's walk passes J1 twice (spec: walls-rooms step 3).
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

  it("resolves a label in a room whose area is unavailable to that room (spec: walls-rooms step 6)", () => {
    const narrow = rectDoc(0, 0, 0.15, 3); // too narrow for its walls: the inset fails
    narrow.zoneLabels.L1 = { id: "L1", at: { x: 0.075, y: 1.5 }, name: "Duct", finish: null };
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
    const doc = { ...emptyDocument(), joints: { ...outer.joints, ...inner.joints }, walls: { ...outer.walls, ...inner.walls }, zoneLabels: {} };
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
    const doc = { ...emptyDocument(), joints: { ...outer.joints, ...inner.joints }, walls: { ...outer.walls, ...inner.walls }, zoneLabels: inner.zoneLabels };
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
      // @ts-expect-error hole ring points are read-only
      zones(doc)[0]!.face.holes[0]!.ring[0]!.x = 1;
      // @ts-expect-error faceAt returns a ring shared with the memo
      faceAt(doc, { x: 1, y: 1 })!.ring[0]!.y = 1;
    };
    expect(mutations).toBeTypeOf("function");
  });
});

describe("rooms with holes", () => {
  const zoneOf = (doc: Document, key: string): Zone => {
    const z = zones(doc).find((x) => x.face.key === key);
    if (!z) throw new Error(`no zone ${key} in ${zones(doc).map((x) => x.face.key).join(", ")}`);
    return z;
  };
  const areaOf = (doc: Document, key: string): number | null => zoneOf(doc, key).area;
  const round9 = (n: number | null | undefined): number | null => (n === null || n === undefined ? null : +n.toFixed(9));
  const apt = "A1|A2|A3|A4";

  it("AC-01: the apartment around core C is 76.44 − 10.24 = 66.20; the core's interior is 7.84", () => {
    const doc = loops(A, C);
    const apartment = zoneOf(doc, apt);
    expect(apartment.area).toBeCloseTo(66.2, 9);
    expect(apartment.floor).toHaveLength(4);
    expect(apartment.holes).toHaveLength(1);
    expect(apartment.holes[0]?.outline).toEqual(apartment.face.holes[0]?.ring);
    expect(apartment.holes[0]?.footprint).toHaveLength(4);
    const core = zoneOf(doc, "C1|C2|C3|C4");
    expect(core.area).toBeCloseTo(7.84, 9);
    expect(core.holes).toEqual([]);
  });

  it("AC-02: one tie wall changes nothing (66.20); ties from both sides give two U rooms of 32.44", () => {
    const joints: [string, number, number][] = [
      ["Aj1", 0, 0], ["Aj2", 10, 0], ["Aj3", 10, 8], ["Aj4", 0, 8], ["L4", 0, 4],
      ["Cj1", 3.5, 2.5], ["Cj2", 6.5, 2.5], ["Cj3", 6.5, 5.5], ["Cj4", 3.5, 5.5], ["C5", 3.5, 4],
    ];
    const one = docOf({
      joints,
      walls: [
        ["A1", "Aj1", "Aj2"], ["A2", "Aj2", "Aj3"], ["A3", "Aj3", "Aj4"], ["A4a", "Aj4", "L4"], ["A4b", "L4", "Aj1"],
        ["C1", "Cj1", "Cj2"], ["C2", "Cj2", "Cj3"], ["C3", "Cj3", "Cj4"], ["C4a", "Cj4", "C5"], ["C4b", "C5", "Cj1"],
        ["T1", "L4", "C5"],
      ],
    });
    expect(validateDocument(one).ok).toBe(true);
    const apartment = zones(one).find((z) => z.face.wallIds.includes("A1"));
    expect(apartment?.area).toBeCloseTo(66.2, 9);
    expect(zones(one).find((z) => z.face.wallIds.includes("C1"))?.area).toBeCloseTo(7.84, 9);

    const two = docOf({
      joints: [...joints, ["R4", 10, 4], ["C6", 6.5, 4]],
      walls: [
        ["A1", "Aj1", "Aj2"], ["A2a", "Aj2", "R4"], ["A2b", "R4", "Aj3"], ["A3", "Aj3", "Aj4"], ["A4a", "Aj4", "L4"], ["A4b", "L4", "Aj1"],
        ["C1", "Cj1", "Cj2"], ["C2a", "Cj2", "C6"], ["C2b", "C6", "Cj3"], ["C3", "Cj3", "Cj4"], ["C4a", "Cj4", "C5"], ["C4b", "C5", "Cj1"],
        ["T1", "L4", "C5"], ["T2", "R4", "C6"],
      ],
    });
    expect(validateDocument(two).ok).toBe(true);
    expect(zones(two)).toHaveLength(3);
    const us = zones(two).filter((z) => z.face.wallIds.includes("T1"));
    expect(us.map((z) => round9(z.area))).toEqual([32.44, 32.44]);
    expect(us.map((z) => z.holes)).toEqual([[], []]);
    expect(zoneOf(two, "C1|C2a|C2b|C3|C4a|C4b").area).toBeCloseTo(7.84, 9);
  });

  it("AC-03: three levels: 66.20, 7.84 − 0.49 = 7.35, and 0.25", () => {
    const doc = loops(A, C, K);
    expect(areaOf(doc, apt)).toBeCloseTo(66.2, 9);
    expect(areaOf(doc, "C1|C2|C3|C4")).toBeCloseTo(7.35, 9);
    expect(areaOf(doc, "K1|K2|K3|K4")).toBeCloseTo(0.25, 9);
  });

  it("AC-04: two 1 × 1 cores give 73.56; moving one by 1 m keeps 73.56; widening it to 2 × 1 gives 72.36", () => {
    const P = rectLoop("P", 2, 2, 3, 3);
    expect(areaOf(loops(A, P, rectLoop("Q", 6, 4, 7, 5)), apt)).toBeCloseTo(73.56, 9);
    expect(areaOf(loops(A, P, rectLoop("Q", 7, 4, 8, 5)), apt)).toBeCloseTo(73.56, 9);
    expect(areaOf(loops(A, P, rectLoop("Q", 6, 4, 8, 5)), apt)).toBeCloseTo(72.36, 9);
  });

  it("AC-05: a thick group whose body reaches into the floor makes the room unavailable; a flush one does not", () => {
    const R = rectLoop("R", 0, 0, 4, 3);
    // The group's footprint reaches x = 0.3 − 0.25 = 0.05; the floor starts at 0.1.
    const into = loops(R, rectLoop("G", 0.3, 1, 1.3, 2, 0.5));
    const room = zoneOf(into, "R1|R2|R3|R4");
    expect(room).toMatchObject({ area: null, floor: null, unavailable: "Area unavailable: unsupported geometry" });
    expect(room.holes).toHaveLength(1);
    expect(room.holes[0]?.footprint).toBeNull();
    expect(room.holes[0]?.outline).toHaveLength(4);
    expect(validateDocument(into).ok).toBe(true);
    const flush = loops(R, rectLoop("G", 0.2, 1, 1.2, 2)); // footprint from x = 0.1, the floor's edge
    expect(areaOf(flush, "R1|R2|R3|R4")).toBeCloseTo(10.64 - 1.44, 9);
    expect(validateDocument(flush).ok).toBe(true);
  });

  it("AC-05: a footprint that covers the whole floor makes the room unavailable", () => {
    // Floor 0.25..0.75 (0.25 m²), footprint 0.15..0.85: without the check the area would be 0.25 − 0.49 = −0.24.
    const doc = loops(rectLoop("R", 0, 0, 1, 1, 0.5), rectLoop("G", 0.4, 0.4, 0.6, 0.6, 0.5));
    expect(areaOf(doc, "R1|R2|R3|R4")).toBeNull();
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("two footprints that overlap make the room unavailable; footprints that touch are accepted", () => {
    // P's footprint ends at x = 3.25, Q's starts at 3.15.
    const overlap = loops(A, rectLoop("P", 2, 3, 3, 4, 0.5), rectLoop("Q", 3.4, 3, 4.4, 4, 0.5));
    expect(areaOf(overlap, apt)).toBeNull();
    expect(validateDocument(overlap).ok).toBe(true);
    const touch = loops(A, rectLoop("P", 2, 3, 3, 4), rectLoop("Q", 3.2, 3, 4.2, 4)); // both reach x = 3.1
    expect(areaOf(touch, apt)).toBeCloseTo(76.44 - 2 * 1.44, 9);
  });

  it("a footprint that fails the offset checks makes the room unavailable: a U group whose notch is one wall thick", () => {
    // The notch walls at x = 3.9 and 4.1 touch face to face, so the outset has a zero-length edge at y = 4.1.
    const u: Spec = {
      joints: [["U1", 3, 3], ["U2", 5, 3], ["U3", 5, 5], ["U4", 4.1, 5], ["U5", 4.1, 4], ["U6", 3.9, 4], ["U7", 3.9, 5], ["U8", 3, 5]],
      walls: [["V1", "U1", "U2"], ["V2", "U2", "U3"], ["V3", "U3", "U4"], ["V4", "U4", "U5"], ["V5", "U5", "U6"], ["V6", "U6", "U7"], ["V7", "U7", "U8"], ["V8", "U8", "U1"]],
    };
    const doc = loops(A, u);
    expect(validateDocument(doc).ok).toBe(true);
    const apartment = zoneOf(doc, apt);
    expect(apartment).toMatchObject({ area: null, unavailable: "Area unavailable: unsupported geometry" });
    expect(apartment.holes).toHaveLength(1);
    expect(apartment.holes[0]?.footprint).toBeNull();
  });

  it("a footprint that fills the floor exactly leaves no floor: the room is unavailable", () => {
    // Floor 0.25..0.75; the group's footprint is 0.35 − 0.10 .. 0.65 + 0.10, the same square.
    const doc = loops(rectLoop("R", 0, 0, 1, 1, 0.5), rectLoop("G", 0.35, 0.35, 0.65, 0.65));
    expect(validateDocument(doc).ok).toBe(true);
    expect(zoneOf(doc, "R1|R2|R3|R4")).toMatchObject({ area: null, unavailable: "Area unavailable: unsupported geometry" });
  });

  it("AC-12: a lone 0.30 × 0.30 wall leaves 76.44; a 0.10 m four-wall square subtracts 0.09 at both positions", () => {
    const lone: Spec = { joints: [["w1", 5, 4], ["w2", 5.3, 4]], walls: [["W", "w1", "w2", 0.3]] };
    expect(areaOf(loops(A, lone), apt)).toBeCloseTo(76.44, 9);
    expect(round9(areaOf(loops(A, rectLoop("S", 1, 1, 1.1, 1.1)), apt))).toBe(76.35);
    expect(round9(areaOf(loops(A, rectLoop("S", 5, 4, 5.1, 4.1)), apt))).toBe(76.35);
  });

  it("a room that is not simple lists its hole outlines with no footprints", () => {
    // The room 0..6 × 0..4 of the hanging-triangle case above, with a 2 × 2 group clear of the triangle.
    const doc = loops(
      {
        joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T1", 2, 1], ["T2", 1, 2]],
        walls: [["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"], ["A1", "J1", "T1"], ["A2", "T1", "T2"], ["A3", "T2", "J1"]],
      },
      rectLoop("C", 3.5, 1, 5.5, 3),
    );
    const room = zones(doc).find((z) => z.face.wallIds.includes("W1"));
    expect(room?.unavailable).toBe("Area unavailable: unsupported boundary");
    expect(room?.holes).toHaveLength(1);
    expect(room?.holes[0]?.footprint).toBeNull();
  });
});
