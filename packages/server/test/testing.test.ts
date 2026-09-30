import { describe, expect, it } from "vitest";
import { createInMemoryRepository } from "../src/app/testing";

describe("in-memory repository", () => {
  it("creates projects, lists them by name, and hands out copies", async () => {
    const repo = createInMemoryRepository();
    const kitchen = await repo.create("Kitchen");
    const apartment = await repo.create("Apartment");
    expect(kitchen).toMatchObject({ meta: { name: "Kitchen" }, seq: 0, receipts: {} });
    expect(await repo.list()).toEqual([apartment.meta, kitchen.meta]);
    kitchen.seq = 99;
    expect((await repo.load(kitchen.meta.id))?.seq).toBe(0);
    expect(await repo.load("missing")).toBeNull();
  });

  it("failNextSave before the write leaves the disk unchanged, once", async () => {
    const repo = createInMemoryRepository();
    const state = await repo.create("A");
    repo.failNextSave(new Error("disk full"));
    await expect(repo.save({ ...state, seq: 1 })).rejects.toThrow("disk full");
    expect((await repo.load(state.meta.id))?.seq).toBe(0);
    await repo.save({ ...state, seq: 2 });
    expect((await repo.load(state.meta.id))?.seq).toBe(2);
  });

  it("failNextSave after the write keeps the new state on disk", async () => {
    const repo = createInMemoryRepository();
    const state = await repo.create("A");
    repo.failNextSave(new Error("fsync failed"), { afterWrite: true });
    await expect(repo.save({ ...state, seq: 1 })).rejects.toThrow("fsync failed");
    expect((await repo.load(state.meta.id))?.seq).toBe(1);
  });
});
