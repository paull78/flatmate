import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { compareToSample } from "../scripts/compare-sample";
import { SAMPLES } from "../scripts/samples";
import { seedProject } from "../scripts/seed-kit";
import { seeded } from "./seeded";

// The comparison of a recorded build with its sample's seed (samples.09, AC-09).

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-compare-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const SAMPLE = SAMPLES[0];
if (!SAMPLE) throw new Error("no sample");
const house = (): Promise<Document> => seeded(SAMPLE, join(dir, String(Math.random())));

/** The house with the east wall's two joints moved by dx: the main room grows by dx × its clear depth. */
function eastWallMoved(doc: Document, dx: number): Document {
  const maxX = Math.max(...Object.values(doc.joints).map((j) => j.x));
  const joints = Object.fromEntries(Object.entries(doc.joints).map(([id, j]) => [id, j.x === maxX ? { ...j, x: j.x + dx } : j]));
  return { ...doc, joints };
}

describe("compareToSample", () => {
  it("finds no difference between a sample and itself", async () => {
    expect(compareToSample(await house(), await house())).toEqual([]);
  });

  it("reports a room's area off by more than 0.1 m², and not one off by less", async () => {
    const seed = await house();
    expect(compareToSample(eastWallMoved(seed, 0.02), seed)).toEqual([]); // 0.02 × 2.35 = 0.047 m²
    const off = compareToSample(eastWallMoved(seed, 0.05), seed); // 0.05 × 2.35 = 0.118 m²
    expect(off).toHaveLength(1);
    expect(off[0]).toMatch(/^Room Main room: 10\.3\d m² recorded, 10\.22 m² seeded$/);
  });

  it("reports a renamed room, a missing stair, an extra opening and a deck at another top", async () => {
    const seed = await house();
    const [labelId, label] = Object.entries(seed.zoneLabels)[0] ?? [];
    const [stairObject] = Object.values(seed.objects).filter((o) => o.kind === "rungLadder");
    const [openingId, opening] = Object.entries(seed.openings)[0] ?? [];
    const [deckId, deck] = Object.entries(seed.decks)[0] ?? [];
    if (!labelId || !label || !stairObject || !openingId || !opening || !deckId || !deck) throw new Error("the fixture changed");
    const changed: Document = {
      ...seed,
      zoneLabels: { ...seed.zoneLabels, [labelId]: { ...label, name: "Washroom" } },
      placements: Object.fromEntries(Object.entries(seed.placements).filter(([, p]) => p.object !== stairObject.id)),
      openings: { ...seed.openings, extra: { ...opening, id: "extra" } },
      decks: { ...seed.decks, [deckId]: { ...deck, top: 2.2 } },
    };
    const diffs = compareToSample(changed, seed);
    expect(diffs.some((d) => d.includes("Washroom"))).toBe(true);
    expect(diffs).toContain("Stairs: 0 recorded, 1 seeded");
    expect(diffs).toContain("Openings: 9 recorded, 8 seeded"); // the studio's eight, with the bathroom's west window (review.01)
    expect(diffs).toContain("Decks: 2.20 recorded, 2.15 seeded");
  });

  it("ignores furniture moved", async () => {
    const seed = await house();
    const placements = Object.fromEntries(Object.entries(seed.placements).map(([id, p]) => [id, { ...p, at: { x: p.at.x + 0.1, y: p.at.y } }]));
    expect(compareToSample({ ...seed, placements }, seed)).toEqual([]);
  });
});

describe("the compare-sample script", () => {
  const run = (folder: string, name: string) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/compare-sample.ts", folder, name], { cwd: join(import.meta.dirname, "..") });

  it("exits 0 and says it matches for a recorded build like the seed", async () => {
    await seedProject(createJsonFileRepository(dir), SAMPLE.name, SAMPLE.steps(), "rec");
    const { stdout } = await run(dir, SAMPLE.name);
    expect(stdout).toContain("matches");
  });

  it("exits 1 and lists the differences for a build that differs", async () => {
    await createJsonFileRepository(dir).create(SAMPLE.name);
    await expect(run(dir, SAMPLE.name)).rejects.toMatchObject({ code: 1 });
  });
});
