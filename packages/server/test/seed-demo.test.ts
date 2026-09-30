import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromStored, zones } from "@fm/domain";
import { unwrap } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { SAMPLE_NAME, sampleCommands, seedDemo } from "../scripts/seed-demo";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-seed-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("seedDemo", () => {
  it("stores the sample apartment through the ordinary submit decision", async () => {
    const meta = await seedDemo(createJsonFileRepository(dir));

    const repo = createJsonFileRepository(dir); // a fresh instance reads back from disk
    expect((await repo.list()).map((p) => p.name)).toEqual([SAMPLE_NAME]);
    const state = await repo.load(meta.id);
    if (!state) throw new Error("the sample project was not saved");

    expect(state.seq).toBe(sampleCommands().length);
    expect(Object.keys(state.receipts)).toHaveLength(sampleCommands().length);
    expect(domainValidator.validate(state.doc)).toEqual({ ok: true });

    const doc = unwrap(fromStored(state.doc));
    expect(zones(doc).map((z) => z.area?.toFixed(2)).sort()).toEqual(["10.64", "10.64"]);
    expect(Object.values(doc.zoneLabels).map((l) => l.name).sort()).toEqual(["Kitchen", "Living"]);
  });

  it("does not create a second sample project", async () => {
    const repo = createJsonFileRepository(dir);
    const first = await seedDemo(repo);
    const second = await seedDemo(repo);
    expect(second).toEqual(first);
    expect(await repo.list()).toHaveLength(1);
  });
});
