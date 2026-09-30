import { describe, expect, it } from "vitest";
import { boundedFaces } from "../src/queries/faces";
import { validateDocument } from "../src/validate";
import { docOf, rectDoc } from "./helpers";

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
    const faces = boundedFaces({ joints: { ...a.joints, ...doc.joints }, walls: { ...a.walls, ...doc.walls }, zoneLabels: {} });
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
    expect(boundedFaces({ joints: {}, walls: {}, zoneLabels: {} })).toEqual([]);
  });

  it("ignores walks smaller than 0.01 m²", () => {
    expect(boundedFaces(rectDoc(0, 0, 0.05, 0.1))).toHaveLength(0);
  });
});
