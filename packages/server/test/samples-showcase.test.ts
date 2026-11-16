import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faceAt, isFloorWall, outsideOf, placementCentre, roomWallsOf, sideFinishes, zones } from "@fm/domain";
import type { Document } from "@fm/domain";
import { SAMPLES } from "../scripts/samples";
import { SAMPLE_FINISHES, WOOD_OUTSIDE } from "../scripts/seed-kit";
import { entranceRooms } from "./livable";
import { seeded } from "./seeded";

// The samples show main's finishes and hung pieces (showcase AC-01 to AC-04), for each house in SHOWCASED: a house
// joins the list when its seed is furnished (steps 03 to 07).
const SHOWCASED: readonly string[] = SAMPLES.map((s) => s.name); // every sample (steps 03 to 07)

const FLOOR_TILES = new Set(["squareTiles", "largeTiles", "mosaic", "cementTiles"]);
const WALL_TILES = new Set(["subwayTiles", "squareTiles", "largeTiles", "mosaic"]);
const WET = new Set(["toilet", "showerTray", "bathtub"]);
const PLANTS = new Set(["plant", "palm", "fern", "rosette"]);

/** Each room's face key, its label and the kinds of the pieces standing in it (in any layout). */
function rooms(doc: Document) {
  return zones(doc).map((z) => {
    const label = z.labelIds.map((id) => doc.zoneLabels[id]).find((l) => l !== undefined);
    const kinds = new Set(Object.values(doc.placements).flatMap((p) => {
      const centre = placementCentre(doc, p);
      return centre && faceAt(doc, centre)?.key === z.face.key ? [doc.objects[p.object]?.kind ?? ""] : [];
    }));
    return { key: z.face.key, name: label?.name ?? z.face.key, label, kinds };
  });
}
const count = (doc: Document, kinds: ReadonlySet<string> | string): number =>
  Object.values(doc.objects).filter((o) => (typeof kinds === "string" ? o.kind === kinds : kinds.has(o.kind))).length;

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-showcase-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

for (const sample of SAMPLES.filter((s) => SHOWCASED.includes(s.name))) {
  describe(sample.name, () => {
    it("has a wall default in every room, and a room in one of the palette's colours (AC-01)", async () => {
      const all = rooms(await seeded(sample, dir));
      expect(all.filter((r) => !r.label || !roomWallsOf(r.label)?.finish).map((r) => r.name)).toEqual([]);
      const colours = new Set<string>([SAMPLE_FINISHES.sage, SAMPLE_FINISHES.clay, SAMPLE_FINISHES.sky, SAMPLE_FINISHES.sand].map((f) => f.colour));
      expect(all.some((r) => colours.has((r.label ? roomWallsOf(r.label) : null)?.finish?.colour ?? ""))).toBe(true);
    });

    it("is clad in wood outside (AC-02)", async () => {
      if (sample.name === "Tokyo loft") return; // a flat inside a building has no outside of its own
      const outside = outsideOf(await seeded(sample, dir))?.finish;
      expect(WOOD_OUTSIDE).toContainEqual(outside);
    });

    it("tiles every wet room, floor and a band of 1.20 m, with a towel rail and a mirror (AC-03)", async () => {
      const wet = rooms(await seeded(sample, dir)).filter((r) => [...r.kinds].some((k) => WET.has(k)));
      expect(wet.length).toBeGreaterThan(0);
      for (const r of wet) {
        const walls = r.label ? roomWallsOf(r.label) : null;
        const band = walls?.lower ?? null;
        expect(FLOOR_TILES.has(r.label?.finish?.motif ?? ""), `${r.name}'s floor`).toBe(true);
        const tiled = (band !== null && WALL_TILES.has(band.finish.motif) && band.height >= 1.2) || WALL_TILES.has(walls?.finish?.motif ?? "");
        expect(tiled, `${r.name}'s walls`).toBe(true);
        expect(r.kinds.has("towelRail"), `${r.name}'s towel rail`).toBe(true);
        expect(r.kinds.has("mirror"), `${r.name}'s mirror`).toBe(true);
      }
    });

    it("has 2 pictures, 3 plants, and hooks or a coat stand by the entrance (AC-04)", async () => {
      const doc = await seeded(sample, dir);
      expect(count(doc, "picture")).toBeGreaterThanOrEqual(2);
      expect(count(doc, PLANTS)).toBeGreaterThanOrEqual(3);
      const entry = new Set(entranceRooms(doc));
      expect(rooms(doc).some((r) => entry.has(r.key) && (r.kinds.has("coatHooks") || r.kinds.has("coatStand")))).toBe(true);
    });
  });
}

describe("the Tokyo loft's closet wall, standing on the loft (cycle home, AC-01)", () => {
  it("shows no finish: neither the bath's band nor the laundry's concrete under it", async () => {
    const tokyo = SAMPLES.find((s) => s.name === "Tokyo loft");
    if (!tokyo) throw new Error("no Tokyo loft");
    const doc = await seeded(tokyo, dir);
    const onLoft = Object.values(doc.walls).filter((w) => !isFloorWall(w)).map((w) => w.id);
    expect(onLoft).toHaveLength(1); // the closet's wall, the samples' only wall on a deck
    expect(onLoft.map((id) => sideFinishes(doc, id))).toEqual([{ left: null, right: null }]);
  });
});

describe("the showcased houses", () => {
  it("are samples", () => { expect(SHOWCASED.filter((n) => !SAMPLES.some((s) => s.name === n))).toEqual([]); });
});
