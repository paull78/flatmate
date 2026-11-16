import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rectangleRoom } from "@fm/domain";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { fixed, seedProject } from "../scripts/seed-kit";

// The seed kit (samples.11): the one submit loop every seed runs through.

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "fm-kit-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const room = () => rectangleRoom({ x: 0, y: 0 }, 4, 3, "kit").map(fixed);

describe("seedProject", () => {
  it("is idempotent by name: a second call returns the first project and adds nothing", async () => {
    const repo = createJsonFileRepository(dir);
    const first = await seedProject(repo, "Kit room", room(), "kit");
    const second = await seedProject(repo, "Kit room", room(), "kit");
    expect({ id: second.id, name: second.name }).toEqual(first);
    expect((await repo.list()).map((p) => p.name)).toEqual(["Kit room"]);
  });

  it("names a refused step by its number, command and opId, and saves nothing", async () => {
    const crossing = fixed({ type: "addWall", opId: "cross", from: { at: { x: 2, y: -1 } }, to: { at: { x: 2, y: 4 } } });
    const repo = createJsonFileRepository(dir);
    await expect(seedProject(repo, "Kit room", [...room(), crossing], "kit")).rejects.toThrow(/step 4 \(addWall cross\)/);
    expect((await readdir(dir)).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("gives each changeset the prefix and the step's number", async () => {
    const meta = await seedProject(createJsonFileRepository(dir), "Kit room", room(), "kit");
    const saved: unknown = JSON.parse(await readFile(join(dir, `${meta.id}.json`), "utf8"));
    expect(JSON.stringify(saved)).toContain('"kit-0"');
    expect(JSON.stringify(saved)).toContain('"kit-3"');
  });
});
