import { describe, expect, it } from "vitest";
import { createInMemoryRepository } from "../src/app/testing";
import { openProject, putJoint, room, setup } from "./helpers";

describe("crash-only restart (spec §7.2, §8, §9)", () => {
  it("save failed before reaching disk: no reply; after restart the same-ID resend is processed normally", async () => {
    const repository = createInMemoryRepository();
    const before = setup({ repository });
    const { alice, bob, projectId } = await room(before);
    const c1 = putJoint("c1", "j1", 1);
    repository.failNextSave(new Error("disk full"));
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await before.app.idle();
    expect(before.fatal).toHaveLength(1);
    expect([...alice.conn.take(), ...bob.conn.take()]).toEqual([]); // a crash is never a rejection

    const after = setup({ repository }); // restart: a new process over the same disk
    const alice2 = after.join("alice", "Alice");
    const snapshot = await openProject(after, alice2, projectId, "ga2");
    expect(snapshot.seq).toBe(0);
    expect(snapshot.doc.joints).toEqual({});
    alice2.conn.take();
    alice2.send({ type: "submit", projectId, generation: "ga2", changeset: c1 });
    await after.app.idle();
    expect(alice2.conn.take()).toEqual([
      { type: "changes", projectId, generation: "ga2", seq: 1, changeset: c1, clientId: "alice" },
      { type: "ack", projectId, generation: "ga2", changesetId: "c1", seq: 1 },
    ]);
  });

  it("save failed after the write reached disk: after restart the resend is acked from the receipt", async () => {
    const repository = createInMemoryRepository();
    const before = setup({ repository });
    const { alice, bob, projectId } = await room(before);
    const c1 = putJoint("c1", "j1", 1);
    repository.failNextSave(new Error("fsync failed"), { afterWrite: true });
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await before.app.idle();
    expect(before.fatal).toHaveLength(1);
    expect([...alice.conn.take(), ...bob.conn.take()]).toEqual([]);

    const after = setup({ repository });
    const alice2 = after.join("alice", "Alice");
    const snapshot = await openProject(after, alice2, projectId, "ga2");
    expect(snapshot.seq).toBe(1); // the disk decides: the write happened
    expect(snapshot.doc.joints).toEqual({ j1: { id: "j1", x: 1, y: 0 } });
    alice2.conn.take();
    alice2.send({ type: "submit", projectId, generation: "ga2", changeset: c1 });
    await after.app.idle();
    expect(alice2.conn.take()).toEqual([{ type: "ack", projectId, generation: "ga2", changesetId: "c1", seq: 1 }]); // no reapply, no broadcast
  });
});
