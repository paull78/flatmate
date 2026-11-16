import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRecord } from "@fm/protocol";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { SAMPLES } from "../scripts/samples";
import { seedSamples, seedSamplesIfEmpty } from "../scripts/seed-samples";

// Seeding the samples (samples.04, .10; AC-01 to AC-04): an empty data folder gets every sample, a folder with any
// project gets nothing, and `pnpm seed:samples` adds the missing ones by name.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-seed-samples-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const names = async (): Promise<string[]> => (await createJsonFileRepository(dir).list()).map((p) => p.name).sort();
const SAMPLE_NAMES = SAMPLES.map((s) => s.name).sort();

describe("seedSamplesIfEmpty", () => {
  it("gives an empty folder every sample (AC-01)", async () => {
    const added = await seedSamplesIfEmpty(createJsonFileRepository(dir));
    expect(added.map((m) => m.name).sort()).toEqual(SAMPLE_NAMES);
    expect(await names()).toEqual(SAMPLE_NAMES);
  });

  it("gives a folder with a project of its own nothing (AC-02)", async () => {
    await createJsonFileRepository(dir).create("My flat");
    expect(await seedSamplesIfEmpty(createJsonFileRepository(dir))).toEqual([]);
    expect(await names()).toEqual(["My flat"]);
  });

  it("gives a folder holding a single sample nothing more: a deleted sample stays deleted (AC-02)", async () => {
    const repo = createJsonFileRepository(dir);
    await seedSamplesIfEmpty(repo);
    for (const p of (await repo.list()).slice(1)) await repo.remove(p.id);
    const left = await names();
    expect(await seedSamplesIfEmpty(repo)).toEqual([]);
    expect(await names()).toEqual(left);
  });

  it("gives a folder emptied of every project the samples again (AC-02)", async () => {
    const repo = createJsonFileRepository(dir);
    await seedSamplesIfEmpty(repo);
    for (const p of await repo.list()) await repo.remove(p.id);
    await seedSamplesIfEmpty(repo);
    expect(await names()).toEqual(SAMPLE_NAMES);
  });
});

describe("seedSamples (AC-03)", () => {
  it("adds each missing sample, leaves an existing one untouched, and a second run adds nothing", async () => {
    const repo = createJsonFileRepository(dir);
    await seedSamples(repo);
    const first = (await repo.list())[0];
    if (!first) throw new Error("no sample seeded");
    const before = await readFile(join(dir, `${first.id}.json`), "utf8");
    await repo.remove(first.id);
    await seedSamples(repo); // brings the removed one back as a new project
    const others = (await repo.list()).filter((p) => p.name !== first.name);
    const kept = await Promise.all(others.map((p) => readFile(join(dir, `${p.id}.json`), "utf8")));
    expect(await seedSamples(repo)).toEqual([]);
    expect(await Promise.all(others.map((p) => readFile(join(dir, `${p.id}.json`), "utf8")))).toEqual(kept);
    expect(await names()).toEqual(SAMPLE_NAMES);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe("the scripts (AC-04)", () => {
  it("has seed:samples and no seed:studio in the root package.json", async () => {
    const pkg: unknown = JSON.parse(await readFile(join(import.meta.dirname, "../../../package.json"), "utf8"));
    const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts : {};
    expect(Object.keys(scripts)).toContain("seed:samples");
    expect(Object.keys(scripts)).not.toContain("seed:studio");
  });

  it("run-seed-samples --if-empty adds nothing to a folder with a project, and says so", async () => {
    await createJsonFileRepository(dir).create("My flat");
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, ["--import", "tsx", "scripts/run-seed-samples.ts", "--if-empty"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: dir },
    });
    expect(stdout).toContain("added no samples");
    expect(await names()).toEqual(["My flat"]);
  });
});
