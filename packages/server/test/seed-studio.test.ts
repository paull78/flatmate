import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OBJECT_KINDS, SEAT_BACK, areaM2, areaRoom, pieceArea, clearanceWarnings, deckViews, guardRuns, faceAt, footprints, freeFloor, fromStored, motifDefaults, placementRange, quadCentre, zoneExtent, roomFinish, signedArea, surroundingsOf, tucks, validateDocument, zoneOfLabel } from "@fm/domain";
import type { Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { STUDIO_NAME, seedStudio } from "../scripts/seed-studio";

// The furnished sample Studio (parts step 04, parts.17): the decks.20 shell and decks, furnished with the kinds in parts,
// laid out as a room that works (studio.01–.03, .07, .08). The seed owns the coordinates; these tests check what
// matters about them (studio.11).

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-studio-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function seeded() {
  const meta = await seedStudio(createJsonFileRepository(dir));
  const state = await createJsonFileRepository(dir).load(meta.id);
  if (!state) throw new Error("the studio was not saved");
  return unwrap(fromStored(state.doc));
}

const kindsIn = (doc: Awaited<ReturnType<typeof seeded>>, stateId: string): Set<string> =>
  new Set(Object.values(doc.placements).filter((p) => p.state === stateId).map((p) => doc.objects[p.object]?.kind ?? ""));

const DAY = "s0";
const NIGHT = "n/s0";
const byKind = (doc: Document, kind: string): string | undefined => Object.values(doc.objects).find((o) => o.kind === kind)?.id;
const placementOf = (doc: Document, object: string, state: string) => Object.values(doc.placements).find((p) => p.object === object && p.state === state);
const footOf = (doc: Document, placementId: string) => {
  const quad = footprints(doc).get(placementId);
  if (!quad) throw new Error(`no footprint for ${placementId}`);
  return quad;
};
/** A ring's bounds: [minX, minY, maxX, maxY]. */
const box = (ring: readonly { x: number; y: number }[]): [number, number, number, number] =>
  [Math.min(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.y)), Math.max(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.y))];
const platform = (doc: Document) => {
  const d = deckViews(doc).find((v) => v.range.top === 0.45);
  if (!d) throw new Error("no platform");
  return d;
};
const rollOut = (doc: Document): string => {
  const bed = Object.values(doc.objects).find((o) => o.kind === "bed");
  if (!bed) throw new Error("no roll-out bed");
  return bed.id;
};
/** A layout's clearance warnings as `<kind>.<side>→<kind|wall>`, or `door swing→…`. */
const warnings = (doc: Document, state: string): string[] => {
  const name = (table: string, id: string): string => {
    if (table === "walls") return "wall";
    if (table === "openings") return "door";
    const p = doc.placements[id];
    return (p && doc.objects[p.object]?.kind) ?? id;
  };
  return clearanceWarnings(doc, state).map((w) => `${name(w.zone.table, w.zone.id)}${w.zone.table === "placements" ? `.${w.zone.side}` : " swing"}→${name(w.against.table, w.against.id)}`);
};

/** Whether `p` lies strictly inside the convex quad `q` (a footprint), with a small margin. */
const insideQuad = (q: readonly { x: number; y: number }[], p: { x: number; y: number }): boolean =>
  q.every((a, i) => {
    const b = q[(i + 1) % q.length] ?? a;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return cross > 1e-9;
  }) || q.every((a, i) => {
    const b = q[(i + 1) % q.length] ?? a;
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1e-9;
  });
/** The label named `name`, and the room it resolves to. */
const room = (doc: Document, name: string) => {
  const label = Object.values(doc.zoneLabels).find((l) => l.name === name);
  const zone = label && zoneOfLabel(doc, label.id);
  if (!label || !zone) throw new Error(`no room labelled ${name}`);
  return { label, zone };
};
/** The room (face key) holding the centre of `kind`'s footprint by Day. */
const roomHolding = (doc: Document, kind: string): string | undefined => {
  const object = byKind(doc, kind);
  const p = object && placementOf(doc, object, DAY);
  const centre = p && quadCentre(footOf(doc, p.id));
  return centre ? faceAt(doc, centre)?.key : undefined;
};

describe("seedStudio", () => {
  it("seeds a valid studio: Day and Night, a loft and a platform, a 3.05 ceiling", async () => {
    const doc = await seeded();
    expect(validateDocument(doc).ok).toBe(true);
    expect(Object.values(doc.states).map((s) => s.name).sort()).toEqual(["Day", "Night"]);
    expect(Object.keys(doc.decks)).toHaveLength(2);
    expect(Object.values(doc.ceilings)[0]?.height).toBe(3.05);
    expect(Object.keys(doc.openings)).toHaveLength(3);
  });

  it("seedStudio gives a valid document whose reader says wheels (surroundings AC-09)", async () => {
    const doc = await seeded();
    expect(validateDocument(doc).ok).toBe(true);
    expect(surroundingsOf(doc)).toBe("wheels");
  });

  it("furnishes the Day layout with at least 12 kinds that have parts", async () => {
    const doc = await seeded();
    const furniture = new Set(OBJECT_KINDS.filter((k) => k.stair === null).map((k) => k.id));
    expect([...kindsIn(doc, "s0")].filter((k) => furniture.has(k)).length).toBeGreaterThanOrEqual(12);
  });

  it("the lift bed is up by Day and down at Night; the table and chairs are only out by Day", async () => {
    const doc = await seeded();
    const lift = Object.values(doc.objects).find((o) => o.kind === "liftBed");
    const config = (state: string) => Object.values(doc.placements).find((p) => p.object === lift?.id && p.state === state)?.config;
    expect(config("s0")).toBe("up");
    expect(config("n/s0")).toBe("down");
    expect(kindsIn(doc, "s0").has("extendingTable")).toBe(true);
    expect(kindsIn(doc, "n/s0").has("extendingTable")).toBe(false);
  });

  it("the step is in Day only, 0.225 tall (AC-01)", async () => {
    const doc = await seeded();
    const step = byKind(doc, "block");
    expect(step && placementOf(doc, step, DAY)).toBeDefined();
    expect(step && placementOf(doc, step, NIGHT)).toBeUndefined();
    const p = step && placementOf(doc, step, DAY);
    expect(p && placementRange(doc, p.id)).toEqual({ bottom: 0, top: 0.225 });
  });

  it("the roll-out bed is stowed under the platform by Day (AC-02)", async () => {
    const doc = await seeded();
    const plat = platform(doc);
    const bed = placementOf(doc, rollOut(doc), DAY);
    if (!bed) throw new Error("no roll-out bed by Day");
    expect(box(footOf(doc, bed.id)).every((v, i) => (i < 2 ? v >= box(plat.ring)[i]! - 1e-9 : v <= box(plat.ring)[i]! + 1e-9))).toBe(true);
    expect(placementRange(doc, bed.id)?.top).toBeLessThanOrEqual(plat.range.bottom + 1e-9);
  });

  it("the roll-out bed rolls out in front of the platform at Night, sliding along y (AC-02)", async () => {
    const doc = await seeded();
    const front = box(platform(doc).ring)[1];
    const day = placementOf(doc, rollOut(doc), DAY);
    const night = placementOf(doc, rollOut(doc), NIGHT);
    if (!day || !night) throw new Error("no roll-out bed");
    const [, minY, , maxY] = box(footOf(doc, night.id));
    expect(maxY).toBeLessThanOrEqual(front + 1e-9);
    expect(minY).toBeGreaterThanOrEqual(0.45 - 1e-9);
    expect([night.at.x, night.rotation]).toEqual([day.at.x, day.rotation]);
  });

  it("the sofa stands on the platform in both layouts (AC-03)", async () => {
    const doc = await seeded();
    const sofa = byKind(doc, "sofa");
    for (const state of [DAY, NIGHT]) expect(sofa && placementOf(doc, sofa, state)?.deck, state).toBe(platform(doc).id);
  });

  it("the step stands on the floor, touching the platform's front edge (AC-03)", async () => {
    const doc = await seeded();
    const step = byKind(doc, "block");
    const p = step && placementOf(doc, step, DAY);
    if (!p) throw new Error("no step");
    expect(p.deck).toBeNull();
    expect(box(footOf(doc, p.id))[3]).toBeCloseTo(box(platform(doc).ring)[1], 9);
  });

  it("the TV hangs at 1.20–1.80 and overlaps no other piece (AC-03)", async () => {
    const doc = await seeded();
    const tv = byKind(doc, "tvUnit");
    for (const state of [DAY, NIGHT]) {
      const p = tv && placementOf(doc, tv, state);
      if (!p) throw new Error(`no TV in ${state}`);
      const r = placementRange(doc, p.id);
      expect([r?.bottom, r?.top].map((v) => Number(v?.toFixed(9)))).toEqual([1.2, 1.8]);
      const [x0, y0, x1, y1] = box(footOf(doc, p.id));
      const others = Object.values(doc.placements).filter((q) => q.state === state && q.id !== p.id);
      for (const q of others) {
        const [a0, b0, a1, b1] = box(footOf(doc, q.id));
        expect(a0 < x1 - 1e-9 && a1 > x0 + 1e-9 && b0 < y1 - 1e-9 && b1 > y0 + 1e-9, `${q.object} in ${state}`).toBe(false);
      }
    }
  });

  it("its loft has one guard, on its 2.30 m open edge, up to the 3.05 ceiling; its platform none (guards AC-02, AC-05)", async () => {
    const doc = await seeded();
    const loft = guardRuns(doc).filter((r) => r.kind === "railing");
    expect(loft).toHaveLength(1);
    const [run] = loft;
    expect(run?.a.x).toBeCloseTo(2.5, 6);
    expect(run?.b.x).toBeCloseTo(2.5, 6);
    expect(Math.abs((run?.b.y ?? 0) - (run?.a.y ?? 0))).toBeCloseTo(2.3, 6);
    expect(run?.top).toBeCloseTo(3.05, 6);
    expect(guardRuns(doc).every((r) => r.deck !== "plat/k0")).toBe(true);
  });

  it("the room works as laid out: no warnings by Day or by Night (clarity.51)", async () => {
    const doc = await seeded();
    expect(warnings(doc, DAY)).toEqual([]);
    expect(warnings(doc, NIGHT)).toEqual([]);
  });

  it("by Day the kitchen has a real 0.90 m aisle: its zones are that deep and the table stands beyond them (clarity.51)", async () => {
    const doc = await seeded();
    const table = byKind(doc, "extendingTable");
    const tableAt = table && placementOf(doc, table, DAY);
    const south = tableAt ? Math.min(...footOf(doc, tableAt.id).map((p) => p.y)) : NaN;
    for (const kind of ["sinkUnit", "hobUnit", "counter"]) {
      const object = byKind(doc, kind);
      const unit = object && placementOf(doc, object, DAY);
      const front = unit ? Math.max(...footOf(doc, unit.id).map((p) => p.y)) : NaN;
      expect(unit && zoneExtent(doc, unit, "front")?.depth, kind).toBeCloseTo(0.9, 9);
      expect(south - front, kind).toBeCloseTo(0.9, 9);
    }
  });

  it("seed: Day chairs tucked, each backrest flush with an end of the table, 0.35 m under it (seating.13, AC-10)", async () => {
    const doc = await seeded();
    const table = byKind(doc, "extendingTable");
    const tab = table && placementOf(doc, table, DAY);
    if (!tab) throw new Error("no table by Day");
    const [x0, , x1] = box(footOf(doc, tab.id));
    const chairs = Object.values(doc.placements).filter((p) => p.state === DAY && doc.objects[p.object]?.kind === "chair");
    expect(chairs).toHaveLength(2);
    const dayTucks = tucks(doc).filter((t) => t.state === DAY);
    expect(dayTucks.map((t) => t.table)).toEqual([tab.id, tab.id]);
    expect(dayTucks.map((t) => t.seat).sort()).toEqual(chairs.map((c) => c.id).sort());
    // West chair x 5.05–5.50 (backrest 5.05–5.15), east chair x 6.00–6.45 (backrest 6.35–6.45); rotations unchanged.
    const spans = chairs.map((c) => box(footOf(doc, c.id))).sort((a, b) => a[0] - b[0]);
    const mm = (vs: number[]) => vs.map((v) => Number(v.toFixed(9)));
    expect(spans.map(([a, , b]) => mm([a, b]))).toEqual([mm([x0 - SEAT_BACK, x0 + 0.35]), mm([x1 - 0.35, x1 + SEAT_BACK])]);
    expect(chairs.map((c) => c.rotation).sort()).toEqual([270, 90]);
    for (const t of dayTucks) expect(Math.abs(signedArea(t.overlap))).toBeCloseTo(0.45 * 0.35, 9);
  });

  it("seed: the toilet keeps its 0.40 × 0.65 m and 0.90 height; only its outline changes, by what the pan takes off the free floor (symbols AC-15)", async () => {
    const doc = await seeded();
    const wc = Object.values(doc.objects).find((o) => o.kind === "toilet");
    expect(wc).toMatchObject({ w: { standard: 0.4 }, d: { standard: 0.65 }, h: { standard: 0.9 } });
    const bathroom = room(doc, "Bathroom").zone.face.key;
    // Before the pan, from main's own code, the toilet a rectangle: 1.73 free in both layouts. The ring frees what it leaves of the rectangle.
    const BATHROOM_FREE_BEFORE = 1.73;
    const freed = 0.4 * 0.65 - pieceArea("toilet", 0.4, 0.65);
    expect(freed).toBeGreaterThan(0.01);
    expect(freeFloor(doc, DAY).get(bathroom)).toBeCloseTo(BATHROOM_FREE_BEFORE + freed, 6);
    expect(freeFloor(doc, NIGHT).get(bathroom)).toBeCloseTo(BATHROOM_FREE_BEFORE + freed, 6);
  });

  it("seed: the main room's Day free floor rises by 2 × 0.45 × 0.35 = 0.315 m² (to the mm²); Night is unchanged (AC-10)", async () => {
    const doc = await seeded();
    const main = room(doc, "Main room").zone.face.key;
    const free = (state: string) => freeFloor(doc, state).get(main);
    // Before the tuck (chairs 2.5 cm clear of the table's ends): Day 5.7575, Night 3.7025.
    expect(free(DAY)).toBeCloseTo(5.7575 + 0.315, 6);
    expect(free(NIGHT)).toBeCloseTo(3.7025, 6);
  });

  it("names Kitchen and Living in the main room, sharing a side, Kitchen over the kitchen run and Living over the sofa (areas.14, .36, AC-12)", async () => {
    const doc = await seeded();
    const byName = Object.fromEntries(Object.values(doc.areas).map((a) => [a.name, a]));
    expect(Object.keys(byName).sort()).toEqual(["Kitchen", "Living"]);
    const main = room(doc, "Main room").zone.face.key;
    for (const id of Object.keys(doc.areas)) expect(areaRoom(doc, id)?.face.key).toBe(main);
    const [k, l] = [byName["Kitchen"], byName["Living"]];
    if (!k || !l) throw new Error("no areas");
    expect(k.at.x - k.w / 2).toBeCloseTo(l.at.x + l.w / 2, 9); // Living's east side is Kitchen's west side
    const inside = (id: string, a: typeof k): boolean => {
      const p = quadCentre(footprints(doc).get(id) ?? []);
      return p !== null && Math.abs(p.x - a.at.x) <= a.w / 2 && Math.abs(p.y - a.at.y) <= a.d / 2;
    };
    expect(inside("sink/p0", k)).toBe(true);
    expect(inside("hob/p0", k)).toBe(true);
    expect(inside("sofa/p0", l)).toBe(true);
    expect(areaM2(doc, k.id)).toBeCloseTo(3.105, 6);
    expect(areaM2(doc, l.id)).toBeCloseTo(6.9, 6);
  });

  it("labels a \"Bathroom\" in mosaic and a \"Main room\" in light oak planks, each inside its room and clear of its pieces (AC-14)", async () => {
    const doc = await seeded();
    expect(Object.values(doc.zoneLabels).map((l) => l.name).sort()).toEqual(["Bathroom", "Main room"]);
    const bathroom = room(doc, "Bathroom");
    const main = room(doc, "Main room");
    expect(roomFinish(doc, bathroom.zone)).toEqual(motifDefaults("mosaic"));
    expect(roomFinish(doc, main.zone)).toEqual({ ...motifDefaults("planks"), colour: "#d8bc94" });
    // Each label in its own room: the bathroom holds the toilet and the shower, the main room the sofa and the lift bed.
    expect(bathroom.zone.face.key).not.toBe(main.zone.face.key);
    for (const kind of ["toilet", "showerTray", "washingMachine"]) expect(roomHolding(doc, kind), kind).toBe(bathroom.zone.face.key);
    for (const kind of ["sofa", "liftBed", "sinkUnit", "shelf"]) expect(roomHolding(doc, kind), kind).toBe(main.zone.face.key);
    // Clear of the pieces the plan draws solid (below the 1.20 cut), in both layouts.
    for (const { label } of [bathroom, main]) {
      for (const p of Object.values(doc.placements)) {
        if ((placementRange(doc, p.id)?.bottom ?? 0) >= 1.2) continue;
        expect(insideQuad(footOf(doc, p.id), label.at), `${label.name} on ${p.object} in ${p.state}`).toBe(false);
      }
    }
  });

  it("lays the loft in wide planks in Grey oak; the platform keeps its oak (deck-floors AC-10)", async () => {
    const doc = await seeded();
    const finishOf = (name: string) => Object.values(doc.decks).find((d) => d.name === name)?.finish;
    expect(finishOf("Loft")).toEqual({ ...motifDefaults("widePlanks"), colour: "#a99c8a" });
    expect(finishOf("Platform")).toBeNull();
  });

  it("is idempotent", async () => {
    await seedStudio(createJsonFileRepository(dir));
    await seedStudio(createJsonFileRepository(dir));
    expect((await createJsonFileRepository(dir).list()).filter((p) => p.name === STUDIO_NAME)).toHaveLength(1);
  });
});
