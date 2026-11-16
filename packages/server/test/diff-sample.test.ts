import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anchorAt, execute } from "@fm/domain";
import type { Command, Document } from "@fm/domain";
import { diffSample } from "../scripts/diff-sample";
import { SAMPLES } from "../scripts/samples";
import { SAMPLE_FINISHES } from "../scripts/seed-kit";
import { seeded } from "./seeded";

// The seed diff (showcase.05, AC-07): what a project changes against its sample's seed, so the user's fixes made in the
// app come back into the seed.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-diff-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const COTTAGE = SAMPLES.find((s) => s.name === "Notched cottage");
if (!COTTAGE) throw new Error("no Notched cottage");
const house = (): Promise<Document> => seeded(COTTAGE, join(dir, String(Math.random())));

const edit = (doc: Document, cmd: Command): Document => {
  const r = execute(doc, cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error.message}`);
  return r.value.doc;
};
const placementOf = (doc: Document, object: string): string => {
  const p = Object.values(doc.placements).find((x) => x.object === object);
  if (!p) throw new Error(`no ${object}`);
  return p.id;
};

describe("diffSample", () => {
  it("finds no difference between a freshly seeded sample and its seed", async () => {
    expect(diffSample(await house(), await house())).toEqual([]);
  });

  it("lists a moved piece with its name and both positions", async () => {
    const seed = await house();
    const moved = edit(seed, { type: "movePlacement", placementId: placementOf(seed, "frame/o0"), at: anchorAt({ x: 4.12, y: 0.265 }, 0.03, 180), rotation: 180 });
    const lines = diffSample(moved, seed);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith("placements frame/p0 (Picture, Layout): at.x 4.220 → 4.120"))).toBe(true);
  });

  it("lists a resized piece and a changed elevation", async () => {
    const seed = await house();
    const resized = edit(seed, { type: "setObjectSize", objectId: "frame/o0", w: 0.4, d: { standard: 0.03 }, h: { standard: 0.45 }, z: { standard: 1.5 } });
    expect(diffSample(resized, seed)).toEqual([
      "objects frame/o0 (Picture): w.standard 0.330 → 0.400",
      "objects frame/o0 (Picture): z.standard 1.350 → 1.500",
    ]);
  });

  it("lists a changed room wall default and band by the room's name, and a changed outside default", async () => {
    const seed = await house();
    let doc = edit(seed, { type: "setRoomWallFinishes", labelId: "cottage-bed", part: "finish", finish: SAMPLE_FINISHES.sage });
    doc = edit(doc, { type: "setRoomWallFinishes", labelId: "cottage-bed", part: "lower", finish: SAMPLE_FINISHES.wainscot, height: 1 });
    doc = edit(doc, { type: "setOutsideFinish", part: "finish", finish: SAMPLE_FINISHES.cedar });
    const lines = diffSample(doc, seed);
    expect(lines).toContain(`zoneLabels cottage-bed (Bedroom): walls.colour ${SAMPLE_FINISHES.sky.colour} → ${SAMPLE_FINISHES.sage.colour}`);
    expect(lines.some((l) => l.startsWith("zoneLabels cottage-bed (Bedroom): wallsLower.motif — → widePlanks"))).toBe(true);
    expect(lines.some((l) => l.startsWith("zoneLabels cottage-bed (Bedroom): wallsLowerHeight — → 1.000"))).toBe(true);
    expect(lines.some((l) => l.startsWith("ceilings ceiling: outside.motif boardAndBatten → widePlanks"))).toBe(true);
  });

  it("lists a changed curtain by its opening", async () => {
    const seed = await house();
    const doc = edit(seed, { type: "setOpening", openingId: "w-bed/d0", sheer: "floor" });
    expect(diffSample(doc, seed)).toEqual(["openings w-bed/d0 (Two-leaf window): sheer glass → floor"]);
  });

  it("lists an added and a removed piece", async () => {
    const seed = await house();
    let doc = edit(seed, { type: "placeObject", opId: "new", state: "s0", object: { kind: "rosette", preset: "30" }, at: anchorAt({ x: 4.4, y: 4 }, 0.3, 0), rotation: 0, deck: null });
    doc = edit(doc, { type: "deleteEntities", ids: [{ table: "objects", id: "plant-entry/o0" }] });
    const lines = diffSample(doc, seed);
    expect(lines).toContain("objects new/o0 (Rosette): added");
    expect(lines).toContain("placements new/p0 (Rosette, Layout): added");
    expect(lines).toContain("objects plant-entry/o0 (Plant): removed");
    expect(lines).toContain("placements plant-entry/p0 (Plant, Layout): removed");
  });
});
