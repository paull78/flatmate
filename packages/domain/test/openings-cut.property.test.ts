import { describe, expect, it } from "vitest";
import { OPENING_KINDS, type OpeningKind } from "../src/kinds";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import type { Document } from "../src/model";
import { cutHeight, openingRange, relationToCut, wallRange } from "../src/queries/vertical";
import { rng, tinyHouse } from "./helpers";

// Random ceilings, wall tops and openings (sills.02): every opening the edits leave fits its wall, a sill from 0 (a
// door's at 0), at least 0.30 m tall, 0.10 m of wall above its head. With the 2.00 m wall rule gone (it made every
// opening cross the floor's cut, levels.05, .16), openings on low walls lie under the cut too, and the plan hides them
// (sills.05): the drawings must hold some of both.

const KINDS = Object.keys(OPENING_KINDS).filter((k): k is OpeningKind => k in OPENING_KINDS);

describe("openings against the floor's cut", () => {
  it("random valid drawings: every opening fits its wall, and some lie under the floor's cut", () => {
    const rand = rng(20261021);
    let openings = 0;
    let lowCut = 0;
    let under = 0;
    for (let run = 0; run < 500; run++) {
      let doc: Document = tinyHouse();
      const apply = (cmd: Command): void => {
        const result = execute(doc, cmd);
        if (result.ok) doc = result.value.doc;
      };
      for (let pass = 0; pass < 2; pass++) { // the partition's 2.03 refuses a lower ceiling until a pass lowers it
        apply({ type: "setCeiling", height: Math.round((1.5 + rand() * 2.5) * 1000) / 1000 });
        for (const id of Object.keys(doc.walls)) {
          if (rand() < 0.5) apply({ type: "setWallTop", wallId: id, top: Math.round((0.5 + rand() * 3) * 1000) / 1000 });
        }
      }
      for (let i = 0; i < 6; i++) {
        const walls = Object.keys(doc.walls);
        const wall = walls[Math.floor(rand() * walls.length)] ?? "";
        const kind = KINDS[Math.floor(rand() * KINDS.length)] ?? "swing";
        apply({ type: "addOpening", opId: `o${i}`, wall, kind, offset: rand() * 2, width: 0.6 + rand() * 0.4 });
      }
      const cut = cutHeight(doc);
      lowCut += cut < 1.2 ? 1 : 0;
      for (const id of Object.keys(doc.openings)) {
        const o = doc.openings[id];
        const range = openingRange(doc, id);
        const wall = o ? wallRange(doc, o.wall) : null;
        if (!o || !range || !wall) throw new Error(`${id} has no range`);
        const fits = o.sill >= 0 && (!OPENING_KINDS[o.kind].fromFloor || o.sill === 0) && o.head - o.sill >= 0.3 - 1e-9 && o.head <= wall.top - wall.bottom - 0.1 + 1e-9;
        expect(fits, `${id}: ${o.sill}–${o.head} on a wall ${wall.top - wall.bottom} tall`).toBe(true);
        under += relationToCut(range, cut) === "crossing" ? 0 : 1;
        openings++;
      }
    }
    expect(openings).toBeGreaterThan(500); // the drawings hold openings…
    expect(lowCut).toBeGreaterThan(50); // …and low ceilings that lower the cut…
    expect(under).toBeGreaterThan(20); // …and openings the cut doesn't cross
  });
});
