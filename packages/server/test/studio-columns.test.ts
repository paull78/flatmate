import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearanceWarnings, columnOf, deckView, execute, faceAt, footprints, fromStored, quadCentre, shown, validateDocument, wallBodies, wallRange, zones } from "@fm/domain";
import type { Document } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import type { Point } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedStudio } from "../scripts/seed-studio";

// The sample scene's first four steps on the seeded studio (pillars.17; AC-18 steps 1–4, AC-05), with no change to the
// seed: a 0.30 × 0.40 column dropped on the east wall at y 2.00 goes in its line, takes 0.03 m² off the main room and
// adds no warning; the east chair moved into it is refused with both ranges; a free post under the loft's open edge
// reaches up to the loft's underside and follows it when the loft is raised; the loft then can't move. The seed owns the coordinates (studio.08), so
// the wall, the room and the chair are found from the document, never by their ids.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-studio-columns-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function seeded(): Promise<Document> {
  const meta = await seedStudio(createJsonFileRepository(dir));
  const state = await createJsonFileRepository(dir).load(meta.id);
  if (!state) throw new Error("the studio was not saved");
  return unwrap(fromStored(state.doc));
}

const DAY = "s0";
const NIGHT = "n/s0";
/** A ring's bounds: [minX, minY, maxX, maxY]. */
const box = (ring: readonly Point[]): [number, number, number, number] =>
  [Math.min(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.y)), Math.max(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.y))];
/** A layout's clearance warnings as `<kind>.<side>→<kind|wall>`, or `door swing→…` (as seed-studio.test.ts reads them). */
const warnings = (doc: Document, state: string): string[] => {
  const name = (table: string, id: string): string => {
    if (table === "walls") return "wall";
    if (table === "openings") return "door";
    const p = doc.placements[id];
    return (p && doc.objects[p.object]?.kind) ?? id;
  };
  return clearanceWarnings(doc, state).map((w) => `${name(w.zone.table, w.zone.id)}${w.zone.table === "placements" ? `.${w.zone.side}` : " swing"}→${name(w.against.table, w.against.id)}`);
};

/** The east shell wall: the one whose centreline is x = 7.00 and passes y 2.00. */
function eastWall(doc: Document): string {
  const found = Object.values(doc.walls).find((w) => {
    const a = doc.joints[w.a];
    const b = doc.joints[w.b];
    return !w.column && a && b && a.x === 7 && b.x === 7 && Math.min(a.y, b.y) < 2 && Math.max(a.y, b.y) > 2;
  });
  if (!found) throw new Error("no east wall at x 7.00");
  return found.id;
}

/** The main room's area as its tag shows it: the room whose floor holds (4.00, 1.00). */
function mainRoomArea(doc: Document): string {
  const face = faceAt(doc, { x: 4, y: 1 });
  const zone = zones(doc).find((z) => z.face.key === face?.key);
  if (!zone || zone.area === null) throw new Error("no main room area");
  return shown(zone.area, 2);
}

/** The Day chair nearest x 6.60: the east one at the table. */
function eastChair(doc: Document): { id: string; centre: Point } {
  const centres = Object.values(doc.placements)
    .filter((p) => p.state === DAY && doc.objects[p.object]?.kind === "chair")
    .map((p) => ({ id: p.id, centre: quadCentre(footprints(doc).get(p.id) ?? []) }));
  const [east] = centres.flatMap((c) => (c.centre ? [{ id: c.id, centre: c.centre }] : [])).sort((a, b) => Math.abs(a.centre.x - 6.6) - Math.abs(b.centre.x - 6.6));
  if (!east) throw new Error("no chair by Day");
  return east;
}

const COLUMN = { type: "placeColumn", opId: "sample-col", at: { x: 7, y: 2 }, width: 0.3, depth: 0.4 } as const;

describe("the sample scene on the seeded studio (AC-18, steps 1–2)", () => {
  it("step 1: a 0.30 × 0.40 column on the east wall at y 2.00 goes in its line; the room loses 0.03 m²; no warning changes", async () => {
    const before = await seeded();
    const east = eastWall(before);
    const result = execute(before, COLUMN);
    if (!result.ok) throw new Error(`refused: ${result.error.message}`);
    const after = result.value.doc;
    expect(validateDocument(after).ok).toBe(true);

    const column = columnOf(after, "sample-col/w0");
    expect(column?.line).toContain(east);
    const body = wallBodies(after).get("sample-col/w0");
    if (!body) throw new Error("no column body");
    expect(box(body).map((v) => Number(shown(v, 2)))).toEqual([6.8, 1.85, 7.2, 2.15]);

    expect(mainRoomArea(before)).toBe("12.19");
    expect(mainRoomArea(after)).toBe("12.16");
    for (const state of [DAY, NIGHT]) expect(new Set(warnings(after, state)), state).toEqual(new Set(warnings(before, state)));
  });

  it("step 2: the east chair moved to (6.60, 1.85), its rotation kept, is refused naming the chair's and the column's ranges", async () => {
    const seed = await seeded();
    const placed = execute(seed, COLUMN);
    if (!placed.ok) throw new Error(`refused: ${placed.error.message}`);
    const doc = placed.value.doc;
    const chair = eastChair(doc);
    const p = doc.placements[chair.id];
    if (!p) throw new Error("no chair placement");
    // The anchor moves with the centre when the rotation stays.
    const at = { x: p.at.x + 6.6 - chair.centre.x, y: p.at.y + 1.85 - chair.centre.y };
    const moved = execute(doc, { type: "movePlacement", placementId: chair.id, at, rotation: p.rotation });
    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.error.message).toMatch(/Chair \(0\.00–\d\.\d\d\) and Column \(0\.00–3\.05\) overlap/);
  });
});

/** The studio's loft: the hollow deck with top 2.15. */
function loftOf(doc: Document): string {
  const found = Object.keys(doc.decks).filter((id) => {
    const v = deckView(doc, id);
    return v !== null && !v.solid && v.top === 2.15;
  });
  if (found.length !== 1 || !found[0]) throw new Error(`expected one loft, found ${found.length}`);
  return found[0];
}

const POST_ID = "sample-post/w0";
/** Try it step 3: a free 0.20 × 0.20 post at (2.40, 1.60) up to the loft's underside. */
const post = (loft: string) => ({ type: "placeColumn", opId: "sample-post", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: loft }) as const;
/** A row's range as "0.00–2.03". */
const span = (doc: Document, id: string): string => {
  const r = wallRange(doc, id);
  return r ? `${shown(r.bottom, 2)}–${shown(r.top, 2)}` : "none";
};

describe("the sample scene on the seeded studio (AC-18, steps 3–4; AC-05)", () => {
  async function withPost(): Promise<{ before: Document; doc: Document; loft: string }> {
    const before = await seeded();
    const loft = loftOf(before);
    const result = execute(before, post(loft));
    if (!result.ok) throw new Error(`refused: ${result.error.message}`);
    return { before, doc: result.value.doc, loft };
  }

  it("step 3: a free 0.20 × 0.20 post at (2.40, 1.60) topped by the loft spans 0.00–2.03 and adds no warning", async () => {
    const { before, doc } = await withPost();
    expect(validateDocument(doc).ok).toBe(true);
    expect(columnOf(doc, POST_ID)?.line).toBeNull();
    expect(span(doc, POST_ID)).toBe("0.00–2.03");
    for (const state of [DAY, NIGHT]) expect(new Set(warnings(doc, state)), state).toEqual(new Set(warnings(before, state)));
  });

  it("step 4: the loft raised to 2.30 is accepted and the post spans 0.00–2.18", async () => {
    const { doc, loft } = await withPost();
    const raised = execute(doc, { type: "setDeck", deckId: loft, top: 2.3 });
    if (!raised.ok) throw new Error(`refused: ${raised.error.message}`);
    expect(span(raised.value.doc, POST_ID)).toBe("0.00–2.18");
  });

  it("moving or deleting the loft is refused naming the post, not the mattress", async () => {
    const { doc, loft } = await withPost();
    const v = deckView(doc, loft);
    if (!v) throw new Error("no loft view");
    const refusals = [
      execute(doc, { type: "setDeck", deckId: loft, at: { x: v.at.x + 0.05, y: v.at.y } }),
      execute(doc, { type: "deleteEntities", ids: [{ table: "decks", id: loft }] }),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.message).toMatch(/stands on|reaches up to/);
      expect(r.error.message).toContain(POST_ID);
      expect(r.error.message.toLowerCase()).not.toContain("mattress");
    }
  });
});
