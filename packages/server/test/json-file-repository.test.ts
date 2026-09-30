import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-repo-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JSON file repository", () => {
  it("creates the data directory, then creates, lists and loads projects", async () => {
    const repo = createJsonFileRepository(join(dir, "nested", "data"));
    const state = await repo.create("Apartment");
    expect(state).toMatchObject({ meta: { name: "Apartment" }, seq: 0, receipts: {} });
    expect(await repo.list()).toEqual([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
    expect(await readdir(join(dir, "nested", "data"))).toEqual([`${state.meta.id}.json`]);
  });

  it("save replaces the file and leaves no temporary file", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    const next = { ...state, seq: 1, receipts: { c1: { seq: 1, fingerprint: "abc" } } };
    await repo.save(next);
    expect(await repo.load(state.meta.id)).toEqual(next);
    expect(await readdir(dir)).toEqual([`${state.meta.id}.json`]);
  });

  it("ignores a temporary file left by an interrupted write", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    await writeFile(join(dir, `${state.meta.id}.json.tmp`), "{ half-written");
    expect(await repo.list()).toEqual([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
  });

  it("a new repository over the same directory reloads state and receipts (restart)", async () => {
    const before = createJsonFileRepository(dir);
    const state = await before.create("Apartment");
    const saved = {
      ...state,
      seq: 1,
      doc: { joints: { j1: { id: "j1", x: 1, y: 0 } }, walls: {}, zoneLabels: {} },
      versions: { joints: { j1: "c1" }, walls: { w9: "c0" }, zoneLabels: {} },
      receipts: { c1: { seq: 1, fingerprint: "abc" } },
    };
    await before.save(saved);
    expect(await createJsonFileRepository(dir).load(state.meta.id)).toEqual(saved);
  });

  it("lists projects sorted by name", async () => {
    const repo = createJsonFileRepository(dir);
    const kitchen = await repo.create("Kitchen");
    const apartment = await repo.create("Apartment");
    expect(await repo.list()).toEqual([apartment.meta, kitchen.meta]);
  });

  it("returns null for unknown or unsafe IDs", async () => {
    const repo = createJsonFileRepository(dir);
    expect(await repo.load("missing")).toBeNull();
    expect(await repo.load("../etc/passwd")).toBeNull();
    expect(await repo.load("a/b")).toBeNull();
  });

  it("does not load a project under a case variant of its ID (case-insensitive file systems)", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    expect(await repo.load(state.meta.id.toUpperCase())).toBeNull();
    expect((await repo.load(state.meta.id))?.meta.id).toBe(state.meta.id);
  });

  it("rejects a corrupt project file", async () => {
    const repo = createJsonFileRepository(dir);
    await writeFile(join(dir, "bad.json"), "{}");
    await expect(repo.load("bad")).rejects.toThrow(/invalid project file/);
  });
});
