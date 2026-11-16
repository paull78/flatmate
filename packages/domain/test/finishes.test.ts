import { describe, expect, it } from "vitest";
import { MOTIFS, MOTIF_IDS, finishIssue, finishProblem, firstLabelId, motifDefaults, motifsFor, nextRoomName, roomFinish, suits, withMotif, type Finish } from "../src/finishes";
import { zones } from "../src/queries/zones";
import { docOf, rectDoc } from "./helpers";

const oak: Finish = { motif: "planks", colour: "#c8a27a", strength: 45, size: 0.2, angle: 0 };
const tiles: Finish = { motif: "squareTiles", colour: "#e8e4dc", strength: 55, size: 0.3, angle: 30 };

/** Whole millimetres, as finishProblem reads a size. */
const mm = (v: number): number => Math.round(v * 1000);

describe("the motif rules (finishes.20)", () => {
  it("MOTIFS lists the motifs with defaults inside their ranges", () => {
    expect(MOTIF_IDS).toEqual(["planks", "widePlanks", "herringbone", "squareTiles", "largeTiles", "mosaic", "cementTiles", "plain", "brick", "subwayTiles", "boardAndBatten", "shingles", "standingSeam", "corrugated", "roofTiles"]);
    expect(Object.keys(MOTIFS)).toEqual([...MOTIF_IDS]);
    for (const id of MOTIF_IDS) {
      const m = MOTIFS[id];
      expect(mm(m.size.min)).toBeLessThanOrEqual(mm(m.size.default));
      expect(mm(m.size.default)).toBeLessThanOrEqual(mm(m.size.max));
      expect(motifDefaults(id)).toEqual({ motif: id, colour: m.colour, strength: m.strength, size: m.size.default, angle: m.angle });
      expect(finishProblem(motifDefaults(id), m.surfaces[0] ?? "floor")).toBeNull();
    }
    expect(MOTIFS.mosaic).toMatchObject({ name: "Mosaic", size: { min: 0.02, max: 0.05, default: 0.025 }, colour: "#a9c9d6", strength: 50 });
    expect(MOTIFS.plain).toMatchObject({ name: "Plain", size: { min: 0, max: 0, default: 0 }, strength: 0 });
  });

  it("finishProblem names each bad field", () => {
    const bad: [Partial<Finish>, string][] = [
      [{ motif: "parquet" }, `finish.motif must be one of ${MOTIF_IDS.join(", ")}`],
      [{ colour: "#C8A27A" }, "finish.colour must be #rrggbb"],
      [{ colour: "#c8a27" }, "finish.colour must be #rrggbb"],
      [{ strength: 101 }, "finish.strength must be a whole percent 0–100"],
      [{ strength: 12.5 }, "finish.strength must be a whole percent 0–100"],
      [{ size: 0.09 }, "finish.size must be 0.10–0.40"],
      [{ size: 0.0255 }, "finish.size must be whole millimetres"],
      [{ angle: 180 }, "finish.angle must be whole degrees 0–179"],
      [{ angle: -1 }, "finish.angle must be whole degrees 0–179"],
      [{ motif: "plain", size: 0.2 }, "finish.size must be 0 for plain"],
      [{ motif: "mosaic", size: 0.06 }, "finish.size must be 0.020–0.050"], // three digits where the motif's sizes need them
      [{ motif: "herringbone", size: 0.21 }, "finish.size must be 0.05–0.20"],
    ];
    for (const [change, message] of bad) expect(finishProblem({ ...oak, ...change }, "floor"), JSON.stringify(change)).toBe(message);
    expect(finishProblem(oak, "floor")).toBeNull();
    expect(finishProblem({ ...oak, size: 0.4, strength: 0, angle: 179 }, "floor")).toBeNull();
    expect(finishProblem({ motif: "mosaic", colour: "#000000", strength: 100, size: 0.025, angle: 0 }, "floor")).toBeNull();
  });

  it("withMotif keeps the colour and the direction and takes the new motif's size and strength (finishes.37)", () => {
    const planks = (angle: number): Finish => ({ ...oak, colour: "#123456", strength: 80, size: 0.4, angle });
    const herring = (angle: number): Finish => ({ ...motifDefaults("herringbone"), colour: "#123456", angle });
    expect(withMotif(planks(0), "herringbone")).toEqual(herring(45));
    expect(withMotif({ ...motifDefaults("herringbone"), colour: "#123456" }, "planks")).toEqual({ ...motifDefaults("planks"), colour: "#123456", angle: 0 });
    expect(withMotif(planks(90), "herringbone")).toEqual(herring(135));
    expect(withMotif(planks(170), "herringbone")).toEqual(herring(35)); // 215 wraps to 35
    expect(withMotif(planks(30), "mosaic")).toEqual({ ...motifDefaults("mosaic"), colour: "#123456", angle: 30 });
    expect(withMotif({ ...tiles, motif: "parquet" }, "herringbone")).toEqual({ ...motifDefaults("herringbone"), colour: tiles.colour, angle: 75 }); // unknown motif: default angle 0
    for (const id of MOTIF_IDS) expect(withMotif(null, id)).toEqual(motifDefaults(id));
    for (const id of MOTIF_IDS) for (const angle of [0, 90, 179]) expect(finishProblem(withMotif(planks(angle), id), MOTIFS[id].surfaces[0] ?? "floor")).toBeNull();
  });

  it("withMotif round trips a finish with default size and strength", () => {
    for (const angle of [0, 17, 90, 134, 135, 179]) {
      const start: Finish = { ...motifDefaults("planks"), colour: "#7a5236", angle };
      expect(withMotif(withMotif(start, "herringbone"), "planks")).toEqual(start);
    }
  });

  it("withMotif from plain keeps the colour", () => {
    const plain: Finish = { motif: "plain", colour: "#7a5236", strength: 0, size: 0, angle: 0 };
    expect(withMotif(plain, "planks")).toEqual({ ...motifDefaults("planks"), colour: "#7a5236" });
    expect(withMotif(plain, "herringbone")).toEqual({ ...motifDefaults("herringbone"), colour: "#7a5236" });
  });
});

describe("firstLabelId, roomFinish and nextRoomName", () => {
  it("firstLabelId and roomFinish take the first label by string id", () => {
    const base = rectDoc(0, 0, 6, 4);
    const doc = {
      ...base,
      zoneLabels: {
        l9: { id: "l9", at: { x: 4, y: 2 }, name: "B", finish: tiles },
        l10: { id: "l10", at: { x: 2, y: 2 }, name: "A", finish: oak },
      },
    };
    const [room] = zones(doc);
    if (!room) throw new Error("no room");
    expect(room.labelIds).toEqual(["l10", "l9"]); // "l10" < "l9" as strings
    expect(firstLabelId(room)).toBe("l10");
    expect(firstLabelId(zones(base)[0] ?? room)).toBeNull();
    expect(roomFinish(doc, room)).toEqual(oak);
    const unfinished = { ...doc, zoneLabels: { ...doc.zoneLabels, l10: { id: "l10", at: { x: 2, y: 2 }, name: "A", finish: null } } };
    expect(roomFinish(unfinished, zones(unfinished)[0] ?? room)).toBeNull(); // the first label's: l9's finish doesn't show
    expect(roomFinish(base, zones(base)[0] ?? room)).toBeNull(); // unlabelled
  });

  it("nextRoomName takes the first unused \"Room N\" from 1, orphans included, names compared exactly (finishes.49)", () => {
    const named = (...names: string[]) => docOf({ joints: [["A", 0, 0]], labels: names.map((n, i): [string, number, number, string] => [`L${i}`, i, i, n]) });
    expect(nextRoomName(rectDoc(0, 0, 6, 4))).toBe("Room 1");
    expect(nextRoomName(named("Room 1", "Room 3"))).toBe("Room 2");
    expect(nextRoomName(named("Room 1", "Room 2"))).toBe("Room 3");
    expect(nextRoomName(named("Room 2", "Room 2"))).toBe("Room 1");
    expect(nextRoomName(named("Kitchen", "Lost"))).toBe("Room 1"); // other names don't count
    expect(nextRoomName(named("room 1", "Room 1 ", "Room 01"))).toBe("Room 1"); // exact match only
  });
});

describe("the surfaces a motif suits (surfaces.03, step 01)", () => {
  it("every motif suits at least one surface", () => {
    for (const id of MOTIF_IDS) expect(MOTIFS[id].surfaces.length).toBeGreaterThan(0);
  });

  it("floor motifs are unchanged", () => {
    expect(motifsFor("floor")).toEqual(["planks", "widePlanks", "herringbone", "squareTiles", "largeTiles", "mosaic", "cementTiles", "plain"]);
  });

  it("walls take planks, wide planks, the three tiles, plain and the wall motifs", () => {
    expect(motifsFor("wall").slice(0, 6)).toEqual(["planks", "widePlanks", "squareTiles", "largeTiles", "mosaic", "plain"]);
    expect(suits("herringbone", "wall")).toBe(false);
    expect(suits("plain", "wall")).toBe(true);
  });

  it("finishIssue refuses herringbone on a wall, naming the wall motifs", () => {
    const herringbone = motifDefaults("herringbone");
    expect(finishIssue(herringbone, "wall")).toEqual({ field: "motif", rule: `must be a wall motif: ${motifsFor("wall").join(", ")}` });
    expect(finishProblem(herringbone, "wall")).toBe(`finish.motif must be a wall motif: ${motifsFor("wall").join(", ")}`);
  });

  it("a finish that suits its surface gets the same answer on every surface it suits", () => {
    const bad = { ...motifDefaults("squareTiles"), size: 0.9 };
    expect(finishIssue(bad, "wall")).toEqual(finishIssue(bad, "floor"));
    expect(finishIssue(motifDefaults("planks"), "wall")).toBeNull();
  });
});
