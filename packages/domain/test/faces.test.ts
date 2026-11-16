import { describe, expect, it } from "vitest";
import { signedArea } from "../src/geometry";
import { emptyDocument, MIN_FACE_AREA, type Document } from "../src/model";
import { boundedFaces, type BoundedFace } from "../src/queries/faces";
import { zones } from "../src/queries/zones";
import { validateDocument } from "../src/validate";
import { A, C, docOf, K, loops, rectDoc, rectLoop } from "./helpers";

describe("boundedFaces", () => {
  it("finds one counter-clockwise face in a rectangle and drops the exterior", () => {
    const faces = boundedFaces(rectDoc(0, 0, 6, 4));
    expect(faces).toHaveLength(1);
    expect(faces[0]?.centreArea).toBe(24);
    expect(faces[0]?.simple).toBe(true);
    expect([...(faces[0]?.wallIds ?? [])].sort()).toEqual(["W1", "W2", "W3", "W4"]);
  });

  it("splits a room in two with a divider", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S1", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
      walls: [["B1", "J1", "S1"], ["B2", "S1", "J2"], ["R", "J2", "J3"], ["T1", "J3", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["D", "S1", "S2"]],
    });
    const faces = boundedFaces(doc);
    expect(faces.map((f) => f.centreArea)).toEqual([12, 12]);
    expect(faces.every((f) => f.wallIds.includes("D"))).toBe(true);
  });

  it("keeps half-edges apart when IDs contain ':' (wall x leaving y:z, wall x:y leaving z)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["y:z", 3, 0], ["J2", 6, 0], ["z", 6, 4], ["S2", 3, 4], ["J4", 0, 4]],
      walls: [["B1", "J1", "y:z"], ["B2", "y:z", "J2"], ["R", "J2", "z"], ["x:y", "z", "S2"], ["T2", "S2", "J4"], ["L", "J4", "J1"], ["x", "y:z", "S2"]],
    });
    expect(validateDocument(doc).ok).toBe(true);
    expect(boundedFaces(doc).map((f) => f.centreArea)).toEqual([12, 12]);
  });

  it("ignores dangling walls (bridges)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["S", 3, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T", 3, 1]],
      walls: [["B1", "J1", "S"], ["B2", "S", "J2"], ["R", "J2", "J3"], ["Top", "J3", "J4"], ["L", "J4", "J1"], ["Stub", "S", "T"]],
    });
    const faces = boundedFaces(doc);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.wallIds).not.toContain("Stub");
  });

  it("handles separate components, each with its own exterior", () => {
    const a = rectDoc(0, 0, 2, 2);
    const doc = docOf({
      joints: [["K1", 5, 0], ["K2", 7, 0], ["K3", 7, 2], ["K4", 5, 2]],
      walls: [["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"]],
    });
    const faces = boundedFaces({ ...emptyDocument(), joints: { ...a.joints, ...doc.joints }, walls: { ...a.walls, ...doc.walls }, zoneLabels: {} });
    expect(faces.map((f) => f.centreArea)).toEqual([4, 4]);
  });

  it("marks a face whose walk repeats a joint as not simple (triangle hanging from a room corner)", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 6, 0], ["J3", 6, 4], ["J4", 0, 4], ["T1", 2, 1], ["T2", 1, 2]],
      walls: [
        ["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"],
        ["A1", "J1", "T1"], ["A2", "T1", "T2"], ["A3", "T2", "J1"],
      ],
    });
    expect(validateDocument(doc).ok).toBe(true);
    // Triangle area 1.5; the room's walk goes J1 J2 J3 J4 J1 T2 T1 and encloses 24 − 1.5.
    expect(boundedFaces(doc).map((f) => ({ simple: f.simple, area: f.centreArea, joints: f.jointIds.length }))).toEqual([
      { simple: true, area: 1.5, joints: 3 },
      { simple: false, area: 22.5, joints: 7 },
    ]);
  });

  it("keeps both rooms of a dumbbell; the bridging wall is in neither face", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 2, 0], ["J3", 2, 2], ["J4", 0, 2], ["K1", 5, 0], ["K2", 7, 0], ["K3", 7, 2], ["K4", 5, 2]],
      walls: [
        ["W1", "J1", "J2"], ["W2", "J2", "J3"], ["W3", "J3", "J4"], ["W4", "J4", "J1"],
        ["V1", "K1", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "K1"],
        ["Br", "J3", "K1"],
      ],
    });
    expect(validateDocument(doc).ok).toBe(true);
    const faces = boundedFaces(doc);
    expect(faces.map((f) => f.centreArea)).toEqual([4, 4]);
    expect(faces.some((f) => f.wallIds.includes("Br"))).toBe(false);
  });

  it("finds two simple faces for two rooms sharing one corner joint", () => {
    const doc = docOf({
      joints: [["J1", 0, 0], ["J2", 2, 0], ["S", 2, 2], ["J4", 0, 2], ["K2", 4, 2], ["K3", 4, 4], ["K4", 2, 4]],
      walls: [
        ["W1", "J1", "J2"], ["W2", "J2", "S"], ["W3", "S", "J4"], ["W4", "J4", "J1"],
        ["V1", "S", "K2"], ["V2", "K2", "K3"], ["V3", "K3", "K4"], ["V4", "K4", "S"],
      ],
    });
    expect(validateDocument(doc).ok).toBe(true);
    expect(boundedFaces(doc).map((f) => ({ simple: f.simple, area: f.centreArea, key: f.key }))).toEqual([
      { simple: true, area: 4, key: "V1|V2|V3|V4" },
      { simple: true, area: 4, key: "W1|W2|W3|W4" },
    ]);
  });

  it("finds no faces in an empty document", () => {
    expect(boundedFaces(emptyDocument())).toEqual([]);
  });

  it("ignores walks smaller than 0.01 m²", () => {
    expect(boundedFaces(rectDoc(0, 0, 0.05, 0.1))).toHaveLength(0);
  });
});

describe("half walls (heights.10)", () => {
  it("a half wall still bounds rooms: the same rooms and areas with top 1.10 (AC-03)", () => {
    const divided = docOf({
      joints: [["A", 0, 0], ["B", 6, 0], ["C", 6, 4], ["D", 0, 4], ["E", 3, 0], ["F", 3, 4]],
      walls: [["W1", "A", "E"], ["W2", "E", "B"], ["W3", "B", "C"], ["W4", "C", "F"], ["W5", "F", "D"], ["W6", "D", "A"], ["M", "E", "F"]],
    });
    const m = divided.walls.M;
    if (!m) throw new Error("no M");
    const half: Document = { ...divided, walls: { ...divided.walls, M: { ...m, top: 1.1 } } };
    const areas = (doc: Document) => zones(doc).map((z) => z.area?.toFixed(4));
    expect(areas(divided)).toHaveLength(2);
    expect(areas(half)).toEqual(areas(divided));
    expect(boundedFaces(half).length).toBe(boundedFaces(divided).length);
  });
});

describe("boundedFaces: holes", () => {
  const sorted = (ids: readonly string[]): string => [...ids].sort().join("|");
  const faceOf = (faces: readonly BoundedFace[], key: string): BoundedFace => {
    const f = faces.find((x) => x.key === key);
    if (!f) throw new Error(`no face ${key} in ${faces.map((x) => x.key).join(", ")}`);
    return f;
  };
  const holeKeys = (f: BoundedFace): string[] => f.holes.map((h) => sorted(h.wallIds));
  const valid = (doc: Document): Document => {
    expect(validateDocument(doc).ok).toBe(true);
    return doc;
  };

  it("attaches a free-standing core to the apartment (AC-01)", () => {
    const doc = valid(loops(A, C));
    const faces = boundedFaces(doc);
    expect(faces).toHaveLength(2);
    const apartment = faceOf(faces, "A1|A2|A3|A4");
    expect(apartment.holes).toHaveLength(1);
    const hole = apartment.holes[0]!;
    expect([...hole.wallIds].sort()).toEqual(["C1", "C2", "C3", "C4"]);
    expect(signedArea(hole.ring)).toBeCloseTo(-9, 9);
    hole.wallIds.forEach((id, i) => {
      const w = doc.walls[id]!;
      expect(new Set([w.a, w.b])).toEqual(new Set([hole.jointIds[i], hole.jointIds[(i + 1) % hole.jointIds.length]]));
    });
    const core = faceOf(faces, "C1|C2|C3|C4");
    expect(core.holes).toEqual([]);
    expect(core.centreArea).toBe(9);
  });

  it("keeps the apartment's key when a core is drawn and when it is removed (AC-14)", () => {
    expect(boundedFaces(loops(A)).map((f) => f.key)).toEqual(["A1|A2|A3|A4"]);
    expect(boundedFaces(loops(A, C)).map((f) => f.key)).toContain("A1|A2|A3|A4");
    const opened = loops(A, C);
    delete opened.walls["C2"];
    // C1, C3 and C4 are bridges now: they close no loop and make no hole.
    const faces = boundedFaces(valid(opened));
    expect(faces.map((f) => ({ key: f.key, holes: f.holes }))).toEqual([{ key: "A1|A2|A3|A4", holes: [] }]);
  });

  it.each([["A"], ["Z"]])("attaches each level to the innermost face, whichever face the index lists first (AC-03, apartment %s)", (p) => {
    const outer = rectLoop(p, 0, 0, 10, 8);
    const faces = boundedFaces(valid(loops(outer, C, K)));
    expect(faces).toHaveLength(3);
    expect(holeKeys(faceOf(faces, `${p}1|${p}2|${p}3|${p}4`))).toEqual(["C1|C2|C3|C4"]);
    expect(holeKeys(faceOf(faces, "C1|C2|C3|C4"))).toEqual(["K1|K2|K3|K4"]);
    expect(faceOf(faces, "K1|K2|K3|K4").holes).toEqual([]);
  });

  it("never attaches a component's walk to its own face", () => {
    // Cj1, C's leftmost joint, lies on face C's ring: the face test must skip C's own component.
    const faces = boundedFaces(loops(A, C));
    expect(faceOf(faces, "C1|C2|C3|C4").holes).toEqual([]);
    expect(holeKeys(faceOf(faces, "A1|A2|A3|A4"))).toEqual(["C1|C2|C3|C4"]);
  });

  it("a core split into two rooms is one wall group: its outside walk hangs on the apartment", () => {
    // b1, the core's smallest joint ID, is on the right room; the outside walk's leftmost joint x1 is on the left room's ring.
    const faces = boundedFaces(valid(loops(A, {
      joints: [["x1", 3.5, 2.5], ["d1", 5, 2.5], ["b1", 6.5, 2.5], ["b2", 6.5, 5.5], ["d2", 5, 5.5], ["x2", 3.5, 5.5]],
      walls: [["C1", "x1", "d1"], ["C2", "d1", "b1"], ["C3", "b1", "b2"], ["C4", "b2", "d2"], ["C5", "d2", "x2"], ["C6", "x2", "x1"], ["D", "d1", "d2"]],
    })));
    expect(faces.map((f) => [f.key, holeKeys(f)])).toEqual([
      ["A1|A2|A3|A4", ["C1|C2|C3|C4|C5|C6"]], ["C1|C5|C6|D", []], ["C2|C3|C4|D", []],
    ]);
  });

  it("a hole goes to the face that contains its leftmost joint, not to a smaller face whose box does (L-shaped notch)", () => {
    const faces = boundedFaces(valid(loops(A, {
      joints: [["l1", 2, 2], ["l2", 6, 2], ["l3", 6, 3], ["l4", 3, 3], ["l5", 3, 6], ["l6", 2, 6]],
      walls: [["L1", "l1", "l2"], ["L2", "l2", "l3"], ["L3", "l3", "l4"], ["L4", "l4", "l5"], ["L5", "l5", "l6"], ["L6", "l6", "l1"]],
    }, rectLoop("K", 4.5, 4.5, 4.8, 4.8, 0.1))));
    expect(holeKeys(faceOf(faces, "A1|A2|A3|A4"))).toEqual(["K1|K2|K3|K4", "L1|L2|L3|L4|L5|L6"]);
    expect(faceOf(faces, "L1|L2|L3|L4|L5|L6").holes).toEqual([]);
  });

  it("sorts holes by leftmost joint ID, ties on x broken by smallest y (AC-04)", () => {
    const doc = valid(loops(A, {
      joints: [["m", 2, 2], ["p3", 3, 2], ["p4", 3, 3], ["a", 2, 3], ["k", 6, 4], ["q3", 7, 4], ["q4", 7, 5], ["z", 6, 5]],
      walls: [
        ["P1", "m", "p3"], ["P2", "p3", "p4"], ["P3", "p4", "a"], ["P4", "a", "m"],
        ["Q1", "k", "q3"], ["Q2", "q3", "q4"], ["Q3", "q4", "z"], ["Q4", "z", "k"],
      ],
    }));
    // Leftmost joints: m for P (x tie with a, smaller y), k for Q; k < m although P lies further left.
    expect(holeKeys(faceOf(boundedFaces(doc), "A1|A2|A3|A4"))).toEqual(["Q1|Q2|Q3|Q4", "P1|P2|P3|P4"]);
  });

  it("a core tied to the outer wall by one wall is still a hole; ties from both sides make two U rooms (AC-02)", () => {
    const joints: [string, number, number][] = [
      ["Aj1", 0, 0], ["Aj2", 10, 0], ["Aj3", 10, 8], ["Aj4", 0, 8], ["L4", 0, 4],
      ["Cj1", 3.5, 2.5], ["Cj2", 6.5, 2.5], ["Cj3", 6.5, 5.5], ["Cj4", 3.5, 5.5], ["C5", 3.5, 4],
    ];
    const tie = valid(docOf({
      joints,
      walls: [
        ["A1", "Aj1", "Aj2"], ["A2", "Aj2", "Aj3"], ["A3", "Aj3", "Aj4"], ["A4a", "Aj4", "L4"], ["A4b", "L4", "Aj1"],
        ["C1", "Cj1", "Cj2"], ["C2", "Cj2", "Cj3"], ["C3", "Cj3", "Cj4"], ["C4a", "Cj4", "C5"], ["C4b", "C5", "Cj1"],
        ["T1", "L4", "C5"],
      ],
    }));
    const one = boundedFaces(tie);
    expect(one).toHaveLength(2);
    const apartment = faceOf(one, "A1|A2|A3|A4a|A4b");
    expect(apartment.holes).toHaveLength(1);
    expect(apartment.holes[0]!.jointIds).toHaveLength(5);
    expect(holeKeys(apartment)).toEqual(["C1|C2|C3|C4a|C4b"]);
    expect(one.some((f) => f.wallIds.includes("T1") || f.holes.some((h) => h.wallIds.includes("T1")))).toBe(false);

    const two = boundedFaces(valid(docOf({
      joints: [...joints, ["R4", 10, 4], ["C6", 6.5, 4]],
      walls: [
        ["A1", "Aj1", "Aj2"], ["A2a", "Aj2", "R4"], ["A2b", "R4", "Aj3"], ["A3", "Aj3", "Aj4"], ["A4a", "Aj4", "L4"], ["A4b", "L4", "Aj1"],
        ["C1", "Cj1", "Cj2"], ["C2a", "Cj2", "C6"], ["C2b", "C6", "Cj3"], ["C3", "Cj3", "Cj4"], ["C4a", "Cj4", "C5"], ["C4b", "C5", "Cj1"],
        ["T1", "L4", "C5"], ["T2", "R4", "C6"],
      ],
    })));
    expect(two).toHaveLength(3);
    expect(two.every((f) => f.holes.length === 0)).toBe(true);
    const core = faceOf(two, "C1|C2a|C2b|C3|C4a|C4b");
    expect(core.centreArea).toBeCloseTo(9, 9);
    const us = two.filter((f) => f !== core);
    // Each U is half the apartment less half the core: 40 − 3 × 1.5. Both ties are walls of both U rooms.
    for (const u of us) {
      expect(u.centreArea).toBeCloseTo(35.5, 9);
      expect(u.wallIds).toEqual(expect.arrayContaining(["T1", "T2"]));
    }
  });

  it("walls that close no loop make no hole (AC-12)", () => {
    const column = boundedFaces(valid(loops(A, { joints: [["w1", 5, 4], ["w2", 5.3, 4]], walls: [["W", "w1", "w2", 0.3]] })));
    expect(column.map((f) => ({ key: f.key, holes: f.holes }))).toEqual([{ key: "A1|A2|A3|A4", holes: [] }]);
    const u = boundedFaces(valid(loops(A, {
      joints: [["u1", 3, 3], ["u2", 5, 3], ["u3", 5, 5], ["u4", 3, 5]],
      walls: [["U1", "u1", "u2"], ["U2", "u2", "u3"], ["U3", "u3", "u4"]],
    })));
    expect(u.map((f) => ({ key: f.key, holes: f.holes }))).toEqual([{ key: "A1|A2|A3|A4", holes: [] }]);
  });

  it("a 0.10 m four-wall square is a hole on either side of the 0.01 m² threshold (AC-12, holes.05)", () => {
    const at = (x: number, y: number): { faces: BoundedFace[]; area: number } => {
      const faces = boundedFaces(valid(loops(A, rectLoop("S", x, y, x + 0.1, y + 0.1))));
      const holes = faceOf(faces, "A1|A2|A3|A4").holes;
      expect(holes).toHaveLength(1);
      return { faces, area: -signedArea(holes[0]!.ring) };
    };
    const big = at(1, 1);
    const small = at(5, 4);
    expect(big.area).toBeGreaterThanOrEqual(MIN_FACE_AREA);
    expect(small.area).toBeLessThan(MIN_FACE_AREA);
    // Only the tiny inner face below the threshold is dropped; the hole stays either way.
    expect(big.faces).toHaveLength(2);
    expect(small.faces).toHaveLength(1);
  });

  it("drops an outside walk that no face contains", () => {
    const a = rectDoc(0, 0, 2, 2);
    const b = rectLoop("V", 5, 0, 7, 2);
    const faces = boundedFaces(loops({ joints: Object.values(a.joints).map((j) => [j.id, j.x, j.y]), walls: Object.values(a.walls).map((w) => [w.id, w.a, w.b]) }, b));
    expect(faces.map((f) => f.holes)).toEqual([[], []]);
  });
});
