import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFloorWall, orderedStates, sortedIds, swingZone, zoneBlocks } from "@fm/domain";
import type { Document } from "@fm/domain";
import { SAMPLES } from "../scripts/samples";
import { seeded } from "./seeded";

// The swings of the samples' floor doors, written down before a door on a deck's wall got a swing zone (cycle home,
// AC-06) and unchanged by it: each floor door's zone to the millimetre, and each layout's blocked floor swings. The
// samples have no blocked swing (their livable check), so the zones are what bites here; the blocked cases are in the
// domain's levels table. Regenerate `fixtures/samples-floor-swings.json` only for a seed change, never for a swing change.

type Pinned = { zones: Record<string, number[][] | null>; blocked: Record<string, string[]> };
const PINNED: Record<string, Pinned> = JSON.parse(readFileSync(new URL("./fixtures/samples-floor-swings.json", import.meta.url), "utf8"));

const mm = (x: number): number => Math.round(x * 1000) / 1000;
const onFloor = (doc: Document, openingId: string): boolean => {
  const wall = doc.walls[doc.openings[openingId]?.wall ?? ""];
  return wall !== undefined && isFloorWall(wall);
};

function floorSwings(doc: Document): Pinned {
  const zones: Pinned["zones"] = {};
  for (const id of sortedIds(doc.openings).filter((o) => onFloor(doc, o))) zones[id] = swingZone(doc, id)?.map((p) => [mm(p.x), mm(p.y)]) ?? null;
  const blocked: Pinned["blocked"] = {};
  for (const state of orderedStates(doc)) {
    blocked[state.id] = zoneBlocks(doc, state.id)
      .filter((b) => b.zone.table === "openings" && onFloor(doc, b.zone.id))
      .map((b) => `${b.zone.id}: ${b.blockers.map((x) => (x.kind === "piece" ? x.object : x.kind)).join(", ")}`);
  }
  return { zones, blocked };
}

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-swings-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("the samples' floor door swings (AC-06)", () => {
  it("are pinned for every sample", () => { expect(Object.keys(PINNED)).toEqual(SAMPLES.map((s) => s.name)); });
  for (const sample of SAMPLES) {
    it(`${sample.name}: every floor door's zone and every blocked floor swing are as written down`, async () => {
      const got = floorSwings(await seeded(sample, dir));
      expect(Object.keys(got.zones).length).toBeGreaterThan(0);
      expect(got).toEqual(PINNED[sample.name]);
    });
  }
});
