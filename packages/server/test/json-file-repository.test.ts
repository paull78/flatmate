import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromStored } from "@fm/domain";
import { emptyStored, emptyVersions } from "@fm/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { domainValidator } from "../src/adapters/domain-validator";
import { createJsonFileRepository } from "../src/adapters/json-file-repository";
import { createServerApp } from "../src/app/server-app";
import { FakeConnection } from "./helpers";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fm-repo-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a listed project's last edit (AC-15)", () => {
  it("is its file's modification time, which a save moves on", async () => {
    const repository = createJsonFileRepository(dir);
    const state = await repository.create("Flat");
    const long = new Date("2020-01-02T03:04:05Z");
    await utimes(join(dir, `${state.meta.id}.json`), long, long);
    expect((await repository.list())[0]?.editedAt).toBe(long.getTime());
    await repository.save(state);
    expect((await repository.list())[0]?.editedAt).toBeGreaterThan(long.getTime());
  });

  it("is not written into the project's file", async () => {
    const repository = createJsonFileRepository(dir);
    const state = await repository.create("Flat");
    const stored: unknown = JSON.parse(await readFile(join(dir, `${state.meta.id}.json`), "utf8"));
    expect(stored).toMatchObject({ meta: { id: state.meta.id, name: "Flat" } });
    expect(JSON.stringify(stored)).not.toContain("editedAt");
  });
});

describe("JSON file repository", () => {
  it("creates the data directory, then creates, lists and loads projects", async () => {
    const repo = createJsonFileRepository(join(dir, "nested", "data"));
    const state = await repo.create("Apartment");
    expect(state).toMatchObject({ meta: { name: "Apartment" }, seq: 0, receipts: {} });
    expect(await repo.list()).toMatchObject([state.meta]);
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

  it("readers during repeated saves always parse a whole project", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    const receipts = Object.fromEntries(Array.from({ length: 30_000 }, (_, i) => [`c${i}`, { seq: i, fingerprint: "f".repeat(32) }]));
    const big = { ...state, receipts };
    await repo.save(big);
    const file = join(dir, `${state.meta.id}.json`);
    expect((await stat(file)).size).toBeGreaterThan(1_000_000); // large enough for a straight write to be seen half done

    let saving = true;
    let reads = 0;
    let broken: unknown = null;
    const reader = (async () => {
      while (saving && broken === null) {
        try {
          JSON.parse(await readFile(file, "utf8"));
          reads += 1;
        } catch (error) {
          broken = error;
        }
      }
    })();
    for (let seq = 1; seq <= 20; seq++) await repo.save({ ...big, seq });
    saving = false;
    await reader;
    expect(broken).toBeNull();
    expect(reads).toBeGreaterThan(0);
  });

  it("a save that can't write its temp file rejects and leaves the project as it was", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    await mkdir(join(dir, `${state.meta.id}.json.tmp`)); // opening the temp file for writing now fails
    await expect(repo.save({ ...state, seq: 1 })).rejects.toThrow();
    expect(await repo.load(state.meta.id)).toEqual(state);
  });

  it("a temp file left by a crash before the rename changes nothing, and the next save clears it", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    await writeFile(join(dir, `${state.meta.id}.json.tmp`), "{half a proj");
    expect(await repo.list()).toMatchObject([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
    const next = { ...state, seq: 1 };
    await repo.save(next);
    expect(await repo.load(state.meta.id)).toEqual(next);
    expect(await readdir(dir)).toEqual([`${state.meta.id}.json`]);
  });

  it("remove moves the file into deleted/, where list and load no longer see it", async () => {
    const repo = createJsonFileRepository(dir);
    const gone = await repo.create("Apartment");
    const kept = await repo.create("Studio");
    await repo.remove(gone.meta.id);
    expect(await repo.list()).toMatchObject([kept.meta]);
    expect(await repo.load(gone.meta.id)).toBeNull();
    expect(await readdir(join(dir, "deleted"))).toEqual([`${gone.meta.id}.json`]);
    expect(JSON.parse(await readFile(join(dir, "deleted", `${gone.meta.id}.json`), "utf8"))).toEqual(gone);
    await expect(createJsonFileRepository(dir).list()).resolves.toMatchObject([kept.meta]); // after a restart too
  });

  it("a list that overlaps a remove skips the file that just moved (it would crash the server)", async () => {
    const repo = createJsonFileRepository(dir);
    const kept = await repo.create("Kept");
    for (let i = 0; i < 20; i += 1) {
      const gone = await repo.create(`Gone ${i}`); // list (workspace queue) and remove (project queue) run concurrently
      const [listed] = await Promise.all([repo.list(), repo.remove(gone.meta.id)]);
      expect(listed).toContainEqual(expect.objectContaining(kept.meta));
    }
  });

  it("ignores a temporary file left by an interrupted write", async () => {
    const repo = createJsonFileRepository(dir);
    const state = await repo.create("Apartment");
    await writeFile(join(dir, `${state.meta.id}.json.tmp`), "{ half-written");
    expect(await repo.list()).toMatchObject([state.meta]);
    expect(await repo.load(state.meta.id)).toEqual(state);
  });

  it("a new repository over the same directory reloads state and receipts (restart)", async () => {
    const before = createJsonFileRepository(dir);
    const state = await before.create("Apartment");
    const saved = {
      ...state,
      seq: 1,
      doc: { ...emptyStored(), joints: { j1: { id: "j1", x: 1, y: 0 } } },
      versions: { ...emptyVersions(), joints: { j1: "c1" }, walls: { w9: "c0" } },
      receipts: { c1: { seq: 1, fingerprint: "abc" } },
    };
    await before.save(saved);
    expect(await createJsonFileRepository(dir).load(state.meta.id)).toEqual(saved);
  });

  it("loads a project file saved before the layout tables: the missing tables are empty (layout-states.39)", async () => {
    const id = "old-project";
    const file = { meta: { id, name: "Old" }, seq: 2, doc: { joints: {}, walls: {}, zoneLabels: {} }, versions: { joints: {}, walls: {}, zoneLabels: {} }, receipts: {} };
    await writeFile(join(dir, `${id}.json`), JSON.stringify(file));
    const loaded = await createJsonFileRepository(dir).load(id);
    expect(loaded?.doc).toEqual(emptyStored());
    expect(loaded?.versions).toEqual(emptyVersions());
    // A table added later (dims) is empty too, and the domain reads the upgraded file (AC-14).
    expect(loaded?.doc.dimensions).toEqual({});
    if (!loaded) throw new Error("not loaded");
    expect(fromStored(domainValidator.upgrade(loaded.doc))).toMatchObject({ ok: true, value: { dimensions: {} } });
  });

  it("loads a project file saved before the underlays table: the table is empty and the domain reads it (import)", async () => {
    const id = "pre-import";
    const nine = { walls: {}, zoneLabels: {}, states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {} };
    const doc = { joints: { j1: { id: "j1", x: 0.5, y: -1.25 } }, ...nine };
    const versions = { joints: { j1: "c1" }, walls: {}, zoneLabels: {}, states: { s0: "c0" }, objects: {}, placements: {}, openings: {}, dimensions: {}, projectFields: {} };
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ meta: { id, name: "Old" }, seq: 1, doc, versions, receipts: {} }));
    const loaded = await createJsonFileRepository(dir).load(id);
    if (!loaded) throw new Error("not loaded");
    expect(loaded.doc.underlays).toEqual({});
    expect(loaded.versions.underlays).toEqual({});
    expect(fromStored(domainValidator.upgrade(loaded.doc))).toMatchObject({ ok: true, value: { underlays: {} } });
  });

  it("loads a file saved before the decks table: no decks, and the domain puts every placement on the floor (decks.04)", async () => {
    const id = "pre-decks";
    const zones = { frontDepth: null, frontStart: null, frontEnd: null, backDepth: null, backStart: null, backEnd: null, leftDepth: null, leftStart: null, leftEnd: null, rightDepth: null, rightStart: null, rightEnd: null };
    const bed = { id: "bed", kind: "bed", name: "Bed", w: { standard: 1.6 }, d: { standard: 2 }, h: { standard: 1 }, z: { standard: 0 } };
    const placement = { id: "bed/s0", object: "bed", state: "s0", at: { x: 1, y: 2 }, rotation: 0, config: "standard", sides: { front: false, back: false, left: true, right: true }, zones };
    const layout = { states: { s0: { id: "s0", name: "Layout", order: 0 } }, objects: { bed }, placements: { "bed/s0": placement } };
    const doc = { joints: {}, walls: {}, zoneLabels: {}, ...layout, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, ceilings: {} };
    const versions = { joints: {}, walls: {}, zoneLabels: {}, states: { s0: "c0" }, objects: { bed: "c1" }, placements: { "bed/s0": "c1" }, openings: {}, dimensions: {}, projectFields: {}, underlays: {}, ceilings: {} };
    await writeFile(join(dir, `${id}.json`), JSON.stringify({ meta: { id, name: "Old" }, seq: 1, doc, versions, receipts: {} }));
    const loaded = await createJsonFileRepository(dir).load(id);
    if (!loaded) throw new Error("not loaded");
    expect(loaded.doc.decks).toEqual({});
    expect(loaded.versions.decks).toEqual({});
    const read = fromStored(domainValidator.upgrade(loaded.doc));
    expect(read).toMatchObject({ ok: true, value: { decks: {}, placements: { "bed/s0": { ...placement, deck: null } } } });
  });

  it("lists projects sorted by name", async () => {
    const repo = createJsonFileRepository(dir);
    const kitchen = await repo.create("Kitchen");
    const apartment = await repo.create("Apartment");
    expect(await repo.list()).toMatchObject([apartment.meta, kitchen.meta]);
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

  describe("a file that can't be read as a project is that file's problem (fixes AC-04)", () => {
    const stderr = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
    afterEach(() => vi.restoreAllMocks());

    const good = async (repo: ReturnType<typeof createJsonFileRepository>) => (await repo.create("Good")).meta.id;

    it.each([
      ["truncated", "{\"meta\":{\"id\":"],
      ["empty", ""],
      ["a stray object", "{}"],
      ["a stray array", "[1,2]"],
      ["another program's json", "{\"name\":\"x\",\"version\":\"1\"}"],
    ])("list skips a %s file and logs its path, and the good project still lists", async (_, text) => {
      const log = stderr();
      const repo = createJsonFileRepository(dir);
      const id = await good(repo);
      await writeFile(join(dir, "bad.json"), text);
      expect((await repo.list()).map((p) => p.id)).toEqual([id]);
      expect(log.mock.calls.flat().join(" ")).toContain("bad.json");
    });

    it("list skips a directory named like a project, and logs it", async () => {
      const log = stderr();
      const repo = createJsonFileRepository(dir);
      const id = await good(repo);
      await mkdir(join(dir, "folder.json"));
      expect((await repo.list()).map((p) => p.id)).toEqual([id]);
      expect(log.mock.calls.flat().join(" ")).toContain("folder.json");
    });

    it("load answers null for a corrupt file and logs its path", async () => {
      const log = stderr();
      await writeFile(join(dir, "bad.json"), "{ not json");
      expect(await createJsonFileRepository(dir).load("bad")).toBeNull();
      expect(log.mock.calls.flat().join(" ")).toContain("bad.json");
    });

    it("load still rejects what isn't the file's content: the disk's errors stay fatal (spec: collaboration)", async () => {
      await mkdir(join(dir, "folder.json"));
      await expect(createJsonFileRepository(dir).load("folder")).rejects.toThrow();
    });

    it("through the app: the good project lists and opens beside a bad file, the bad one answers openFailed, and nothing is fatal", async () => {
      stderr();
      const repository = createJsonFileRepository(dir);
      const { meta } = await repository.create("Good");
      await writeFile(join(dir, "bad.json"), "{ not json");
      let fatal: unknown = null;
      const app = createServerApp({ repository, validator: domainValidator, onFatal: (e) => { fatal = e; } });
      const conn = new FakeConnection();
      const session = app.connect(conn);
      const send = (msg: unknown): void => session.receive(JSON.stringify(msg));
      send({ type: "hello", clientId: "alice", name: "Alice" });
      send({ type: "listProjects", requestId: "r1" });
      send({ type: "openProject", projectId: "bad", generation: "g1" });
      await app.idle();
      send({ type: "openProject", projectId: meta.id, generation: "g2" });
      await app.idle();
      expect(fatal).toBeNull();
      expect(conn.take()).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "projects", items: [expect.objectContaining({ id: meta.id })] }),
        expect.objectContaining({ type: "openFailed", projectId: "bad", generation: "g1" }),
        expect.objectContaining({ type: "snapshot", generation: "g2" }),
      ]));
    });

    it("a save that can't write still rejects", async () => {
      const repo = createJsonFileRepository(dir);
      const state = await repo.create("Good");
      await mkdir(join(dir, `${state.meta.id}.json.tmp`));
      await expect(repo.save(state)).rejects.toThrow();
    });
  });
});
