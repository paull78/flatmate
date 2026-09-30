import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromStored, toStored, zones } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { gridDocument, gridName, seedGrid } from "../scripts/seed-grid";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-grid-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("gridDocument (spec §6.3)", () => {
  it("is N × N labelled 3 m rooms: 2N(N+1) walls, (N+1)² joints, N² labels", () => {
    const doc = gridDocument(3);
    expect(Object.keys(doc.walls)).toHaveLength(24);
    expect(Object.keys(doc.joints)).toHaveLength(16);
    expect(Object.keys(doc.zoneLabels)).toHaveLength(9);
    expect(domainValidator.validate(toStored(doc))).toEqual({ ok: true });
  });

  it("the domain finds every room, each 2.80 × 2.80 m clear", () => {
    const found = zones(gridDocument(3));
    expect(found).toHaveLength(9);
    expect(found.every((z) => z.area !== null && Math.abs(z.area - 7.84) < 1e-9)).toBe(true);
    expect(found.every((z) => z.labelIds.length === 1)).toBe(true);
  });
});

describe("seedGrid", () => {
  it("stores the grid through the ordinary submit decision, as one changeset", async () => {
    const meta = await seedGrid(createJsonFileRepository(dir), 3);
    expect(meta.name).toBe(gridName(3));

    const state = await createJsonFileRepository(dir).load(meta.id); // a fresh instance reads back from disk
    if (!state) throw new Error("the grid project was not saved");
    expect(state.seq).toBe(1);
    expect(domainValidator.validate(state.doc)).toEqual({ ok: true });
    expect(Object.keys(unwrap(fromStored(state.doc)).walls)).toHaveLength(24);
  });

  it("does not create a second project of the same size", async () => {
    const repo = createJsonFileRepository(dir);
    const first = await seedGrid(repo, 3);
    expect(await seedGrid(repo, 3)).toEqual(first);
    expect(await repo.list()).toHaveLength(1);
  });
});
