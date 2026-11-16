import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRecord } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { seedSample } from "../scripts/seed-sample";
import { seedStudio } from "../scripts/seed-studio";

// The Studio and the Sample apartment as their seeds made them before the seed kit (samples AC-10): the saved project
// state, entity for entity. Only the project id is fresh per run, so it is set to "frozen" on both sides.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-frozen-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const FIXTURES = join(import.meta.dirname, "fixtures");

async function savedState(seed: typeof seedStudio): Promise<unknown> {
  const meta = await seed(createJsonFileRepository(dir));
  const saved: unknown = JSON.parse(await readFile(join(dir, `${meta.id}.json`), "utf8"));
  if (!isRecord(saved)) throw new Error("the saved project is not an object");
  return { ...saved, meta: { ...meta, id: "frozen" } };
}

async function frozen(file: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, file), "utf8"));
}

describe("frozen seeds (samples AC-10)", () => {
  it("seedStudio makes the frozen Studio", async () => {
    expect(await savedState(seedStudio)).toEqual(await frozen("frozen-studio.json"));
  });

  it("seedSample makes the frozen Sample apartment", async () => {
    expect(await savedState(seedSample)).toEqual(await frozen("frozen-sample.json"));
  });
});
