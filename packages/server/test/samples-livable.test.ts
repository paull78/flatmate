import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { footprintOf, highSide, missingGuards, inEveryLayout, outsideOf, roofCovering, roofOf, roomWallsOf, sideFinishes, sidesOf } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { SAMPLES } from "../scripts/samples";
import { clearanceWalk, entrances, piecesOverGlass, reachableRooms, swingsCross, warnings, waysUp } from "./livable";
import { seeded } from "./seeded";

// Every sample house is livable (samples.05, AC-05 to AC-08), one describe per house so a failure names it.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-samples-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });


describe("the samples", () => {
  it("are the five houses of the spec, in order (AC-01)", () => {
    expect(SAMPLES.map((s) => s.name)).toEqual(["20 ft studio", "28 ft two lofts", "30 ft gooseneck", "Notched cottage", "Tokyo loft"].slice(0, Math.max(1, SAMPLES.length)));
  });
});

for (const sample of SAMPLES) {
  describe(sample.name, () => {
    it("has an entrance (AC-05)", async () => { expect(entrances(await seeded(sample, dir))).toEqual([]); });
    it("has a way up to every deck in every layout (AC-06)", async () => { expect(waysUp(await seeded(sample, dir))).toEqual([]); });
    it("has every room reachable (AC-07)", async () => { expect(reachableRooms(await seeded(sample, dir))).toEqual([]); });
    it("has no warnings in any layout (AC-08)", async () => { expect(warnings(await seeded(sample, dir))).toEqual([]); });
    it("has every use zone within a person's reach, in every layout (the clearance walk)", async () => { expect(clearanceWalk(await seeded(sample, dir))).toEqual([]); });
    it("has no piece in front of a window's glass, in any layout (showcase.04)", async () => { expect(piecesOverGlass(await seeded(sample, dir))).toEqual([]); });
    it("has no two doors or windows swinging into each other (showcase.30)", async () => { expect(swingsCross(await seeded(sample, dir))).toEqual([]); });
    it("has one section (review.10, AC-15)", async () => { expect(Object.keys((await seeded(sample, dir)).sections)).toHaveLength(1); });
    it("has room walls defaults, a band in a wet room, an outside default on a house and a covering on a slope (inherit AC-12)", async () => {
      const doc = await seeded(sample, dir);
      const defaults = Object.values(doc.zoneLabels).map(roomWallsOf).filter((d) => d !== null);
      expect(defaults.length).toBeGreaterThan(0);
      expect(defaults.some((d) => d?.lower?.height === 1.2)).toBe(true); // every sample has a bathroom tiled to 1.20
      if (roofOf(doc).shape !== "flat") expect(roofCovering(doc)).not.toBeNull();
      if (sample.name !== "Tokyo loft") expect(outsideOf(doc)?.finish).toBeTruthy(); // a flat in a block has no cladding of its own
      const shown = Object.keys(doc.walls).flatMap((id) => Object.values(sideFinishes(doc, id) ?? {}));
      expect(shown.some((s) => s?.source === "room" && s.lower !== null)).toBe(true); // the band reaches the walls
    });

    it("has no custom wall side: rooms and the house set them all (inherit AC-12)", async () => {
      const doc = await seeded(sample, dir);
      expect(Object.values(doc.walls).filter((w) => sidesOf(w) !== undefined).map((w) => w.id)).toEqual([]);
    });
  });
}

describe("20 ft studio: Day and Night", () => {
  it("has the Murphy bed folded by Day and down at Night, the table open by Day and folded at Night, chairs by Day only", async () => {
    const sample = SAMPLES.find((s) => s.name === "20 ft studio");
    if (!sample) throw new Error("no 20 ft studio");
    const doc = await seeded(sample, dir);
    const states = Object.values(doc.states).map((s) => s.name);
    expect(states).toEqual(["Day", "Night"]);
    const stateId = (name: string): string => Object.values(doc.states).find((s) => s.name === name)?.id ?? "";
    const configOf = (kind: string, state: string): string[] => Object.values(doc.placements)
      .filter((p) => p.state === stateId(state) && doc.objects[p.object]?.kind === kind).map((p) => p.config);
    expect(configOf("murphyBed", "Day")).toEqual(["folded"]);
    expect(configOf("murphyBed", "Night")).toEqual(["down"]);
    expect(configOf("foldingTable", "Day")).toEqual(["open"]);
    expect(configOf("foldingTable", "Night")).toEqual(["folded"]);
    expect(configOf("chair", "Day")).toHaveLength(2);
    expect(configOf("chair", "Night")).toHaveLength(0);
  });

  it("has every piece the same in both layouts but the chairs, which are Day's only (review.01, .05, AC-11)", async () => {
    const sample = SAMPLES.find((s) => s.name === "20 ft studio");
    if (!sample) throw new Error("no 20 ft studio");
    const doc = await seeded(sample, dir);
    const pieces = Object.values(doc.objects).filter((o) => !inEveryLayout(o.kind));
    expect(pieces.filter((o) => o.linked !== true).map((o) => o.kind)).toEqual(["chair", "chair"]);
    for (const o of pieces.filter((x) => x.linked === true)) {
      const copies = Object.values(doc.placements).filter((p) => p.object === o.id);
      expect(copies.map((p) => p.state).sort(), o.name).toEqual(["n/s0", "s0"]);
      expect(copies[0]?.at, o.name).toEqual(copies[1]?.at);
    }
    // The user's arrangement (review.01): the sofa under the two-leaf window, the fridge on the south wall, two bookcases.
    const kinds = pieces.map((o) => o.kind);
    expect(kinds).toContain("sofa");
    expect(kinds.filter((k) => k === "shelf")).toHaveLength(2);
    const fridge = Object.values(doc.placements).find((p) => doc.objects[p.object]?.kind === "fridge");
    expect(fridge?.rotation).toBe(180);
  });
});

describe("28 ft two lofts", () => {
  const house = async () => {
    const sample = SAMPLES.find((s) => s.name === "28 ft two lofts");
    if (!sample) throw new Error("no 28 ft two lofts");
    return seeded(sample, dir);
  };

  it("reaches the main loft by a ship's ladder and the guest loft by a rung ladder; the guest loft's open edge has a 0.40 m railing (review.02)", async () => {
    const doc = await house();
    const deckId = (name: string): string => Object.values(doc.decks).find((d) => d.name === name)?.id ?? "";
    const reaching = (deck: string): string[] => Object.values(doc.objects).filter((o) => o.reaches === deck).map((o) => o.kind);
    expect(reaching(deckId("Main loft"))).toEqual(["shipsLadder"]);
    expect(reaching(deckId("Guest loft"))).toEqual(["rungLadder"]);
    expect(doc.decks[deckId("Guest loft")]?.guardLeft).toEqual({ kind: "railing", height: 0.4 });
  });

  it("is 8.53 m long outside, with a bathtub, a bar with two stools, a sofa, a TV unit and wood floors (review.02)", async () => {
    const doc = await house();
    const xs = Object.values(doc.joints).map((j) => j.x);
    expect(Math.max(...xs) - Math.min(...xs) + 0.1).toBeCloseTo(8.53, 6); // centre lines plus the 0.10 m walls
    const kinds = Object.values(doc.objects).map((o) => o.kind);
    for (const k of ["bathtub", "barTable", "sofa", "tvUnit", "rug"]) expect(kinds, k).toContain(k);
    expect(kinds.filter((k) => k === "stool")).toHaveLength(2);
    const finishOf = (name: string) => Object.values(doc.zoneLabels).find((l) => l.name === name)?.finish?.motif;
    expect(finishOf("Living room")).toBe("planks");
    expect(finishOf("Bathroom")).toBe("largeTiles");
  });

  it("stands on a trailer with three axles", async () => {
    const doc = await house();
    expect(doc.projectFields.trailerAxles?.value).toBe("3");
    expect(doc.projectFields.surroundings?.value).toBe("wheels");
  });
});

describe("30 ft gooseneck", () => {
  const house = async () => {
    const sample = SAMPLES.find((s) => s.name === "30 ft gooseneck");
    if (!sample) throw new Error("no 30 ft gooseneck");
    return seeded(sample, dir);
  };
  const box = (ring: readonly Point[]) => ({
    minX: Math.min(...ring.map((p) => p.x)), maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)), maxY: Math.max(...ring.map((p) => p.y)),
  });

  it("raises the bedroom on a solid deck 1.0 m high, guarded, reached by a storage stair", async () => {
    const doc = await house();
    const bedroom = Object.values(doc.decks).find((d) => d.name === "Bedroom");
    expect(bedroom).toMatchObject({ top: 1, solid: true });
    expect(missingGuards(doc).filter((m) => m.deck === bedroom?.id)).toEqual([]);
    expect(Object.values(doc.objects).filter((o) => o.reaches === bedroom?.id).map((o) => o.kind)).toEqual(["storageStair"]);
  });

  it("stands its sofa on the floor, its back to the bedroom deck, facing a free-standing TV unit; no platform or fireplace (review.03)", async () => {
    const doc = await house();
    expect(Object.values(doc.decks).map((d) => d.name)).toEqual(["Bedroom"]);
    const kinds = Object.values(doc.objects).map((o) => o.kind);
    expect(kinds).not.toContain("electricFireplace");
    expect(kinds).not.toContain("storageSteps");
    const sofa = Object.values(doc.placements).find((p) => doc.objects[p.object]?.kind === "sofa");
    const tv = Object.values(doc.placements).find((p) => doc.objects[p.object]?.kind === "tvUnit");
    expect(sofa?.deck).toBeNull();
    expect(sofa?.rotation).toBe(90); // facing east
    expect(tv?.rotation).toBe(270); // facing west, back to it
    const s = sofa ? footprintOf(doc, sofa) : null;
    const t = tv ? footprintOf(doc, tv) : null;
    if (!s || !t) throw new Error("no sofa or TV unit");
    expect(box(s).minX).toBeCloseTo(2.8, 6); // against the deck's face
    expect(box(t)).toMatchObject({ minX: expect.closeTo(4.85, 6), maxX: expect.closeTo(5.25, 6), minY: expect.closeTo(0.2, 6), maxY: expect.closeTo(1.2, 6) }); // 0.65 m to the pantry (the clearance walk)
  });

  it("has a low shed roof, 3.20 to 3.45, so 3D shows it closed (review.27)", async () => {
    const doc = await house();
    expect(roofOf(doc)).toMatchObject({ shape: "shed", falls: "-y" });
    expect(Object.values(doc.ceilings)[0]?.height).toBe(3.2);
    expect(highSide(doc)).toBeCloseTo(3.45, 3);
  });

  it("is shown with Interior surroundings, never on wheels", async () => {
    const doc = await house();
    expect(doc.projectFields.surroundings?.value).toBe("interior");
  });
});

describe("Notched cottage", () => {
  const house = async () => {
    const sample = SAMPLES.find((s) => s.name === "Notched cottage");
    if (!sample) throw new Error("no Notched cottage");
    return seeded(sample, dir);
  };

  it("has wood floors in the main room, the hall and the bedroom, tiles in the shower room, and a TV unit and a rug by the sofa (review.04)", async () => {
    const doc = await house();
    const finishOf = (name: string) => Object.values(doc.zoneLabels).find((l) => l.name === name)?.finish?.motif;
    expect(["Main room", "Hall", "Bedroom"].map(finishOf)).toEqual(["planks", "planks", "planks"]);
    expect(finishOf("Shower room")).toBe("squareTiles");
    const kinds = Object.values(doc.objects).map((o) => o.kind);
    expect(kinds).toContain("tvUnit");
    expect(kinds).toContain("rug");
  });

  it("has an L-shaped outline: its outside walls turn at six corners", async () => {
    const doc = await house();
    const outside = Object.values(doc.walls).filter((w) => w.thickness === 0.25);
    const turns = Object.keys(doc.joints).filter((j) => {
      const here = outside.filter((w) => w.a === j || w.b === j);
      if (here.length !== 2) return false;
      const dir = (w: (typeof here)[number]) => {
        const a = doc.joints[w.a];
        const b = doc.joints[w.b];
        return a && b ? Math.abs(b.x - a.x) > Math.abs(b.y - a.y) : false;
      };
      const [w1, w2] = here;
      return w1 !== undefined && w2 !== undefined && dir(w1) !== dir(w2);
    });
    expect(turns).toHaveLength(6);
  });

  it("names three areas in its main room: Kitchen, Dining and Living", async () => {
    const doc = await house();
    expect(Object.values(doc.areas).map((a) => a.name).sort()).toEqual(["Dining", "Kitchen", "Living"]);
  });

  it("hangs three collar ties under the gable, across the main room", async () => {
    const doc = await house();
    const beams = Object.values(doc.placements).filter((p) => doc.objects[p.object]?.kind === "beam");
    expect(beams).toHaveLength(3);
    for (const b of beams) expect(doc.objects[b.object]?.z?.[b.config]).toBe("ceiling");
    expect(Object.values(doc.ceilings).some((c) => c.shape === "gable")).toBe(true);
  });

  it("is shown with the outside ground, and has a wood stove and a sliding garden door with a window over it", async () => {
    const doc = await house();
    expect(doc.projectFields.surroundings?.value).toBe("outside");
    expect(Object.values(doc.objects).map((o) => o.kind)).toContain("woodStove");
    const garden = Object.values(doc.openings).find((o) => o.kind === "slidingGlass");
    const over = Object.values(doc.openings).filter((o) => o.wall === garden?.wall && o.kind === "window" && o.offset === garden?.offset);
    expect(over).toHaveLength(1);
  });
});
