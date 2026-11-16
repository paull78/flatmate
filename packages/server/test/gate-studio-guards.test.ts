import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromStored, missingGuards } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedStudio } from "../scripts/seed-studio";

// The final gate's AC-01 gap: the seeded studio has no guard warning. Its loft (2.15) keeps a Railing, its platform (0.45)
// None, which is under 0.76 m and so doesn't warn.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-studio-guards-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("the seeded studio (AC-01)", () => {
  it("has no guard warning", async () => {
    const meta = await seedStudio(createJsonFileRepository(dir));
    const state = await createJsonFileRepository(dir).load(meta.id);
    if (!state) throw new Error("the studio was not saved");
    const doc = unwrap(fromStored(state.doc));
    expect(Object.values(doc.decks).map((d) => [d.top, d.guardFront.kind]).sort()).toEqual([[0.45, "none"], [2.15, "railing"]]);
    expect(missingGuards(doc)).toEqual([]);
  });
});
