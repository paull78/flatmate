import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES } from "@fm/protocol";
import { createInMemoryRepository } from "../src/app/testing";
import { FakeConnection, createProject, gatedRepository, openProject, putJoint, rejectX99, room, setup, tick } from "./helpers";

describe("server app: sessions and workspace", () => {
  it("answers hello with welcome and gives each client its own colour", () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    const bob = ctx.join("bob");
    expect(alice.conn.messages).toEqual([{ type: "welcome", clientId: "alice", color: alice.color }]);
    expect(bob.conn.messages).toEqual([{ type: "welcome", clientId: "bob", color: bob.color }]);
    expect(alice.color).not.toBe(bob.color);
  });

  it("closes a connection whose first message is not hello", () => {
    const ctx = setup();
    const conn = new FakeConnection();
    ctx.app.connect(conn).receive(JSON.stringify({ type: "listProjects", requestId: "r1" }));
    expect(conn.closed).toBe(true);
    expect(conn.messages).toEqual([]);
  });

  it("creates and lists projects, echoing request IDs", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "createProject", requestId: "r1", name: "Apartment" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projectCreated", requestId: "r1", meta: { id: expect.any(String), name: "Apartment" } }]);
    alice.send({ type: "listProjects", requestId: "r2" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projects", requestId: "r2", items: [{ id: expect.any(String), name: "Apartment" }] }]);
  });

  it("answers an unparseable message with an error and keeps the session", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.session.receive("{not json");
    expect(alice.conn.take()).toEqual([{ type: "error", requestId: null, message: "Message is not JSON" }]);
    alice.send({ type: "listProjects", requestId: "r1" });
    await ctx.app.idle();
    expect(alice.conn.types()).toEqual(["projects"]);
  });
});

describe("server app: opening projects", () => {
  it("sends a full snapshot tagged with the session's generation", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    const projectId = await createProject(ctx, alice);
    expect(await openProject(ctx, alice, projectId, "g1")).toEqual({
      type: "snapshot",
      projectId,
      generation: "g1",
      meta: { id: projectId, name: "Apartment" },
      doc: { joints: {}, walls: {}, zoneLabels: {} },
      versions: { joints: {}, walls: {}, zoneLabels: {} },
      seq: 0,
    });
  });

  it("reports an unknown project", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "openProject", projectId: "missing", generation: "g1" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "openFailed", projectId: "missing", generation: "g1", message: "Unknown project" }]);
  });

  it("opening during a submission delivers the snapshot, then only later changes", async () => {
    const gated = gatedRepository();
    const ctx = setup({ repository: gated.repository });
    const alice = ctx.join("alice");
    const bob = ctx.join("bob");
    const projectId = await createProject(ctx, alice);
    await openProject(ctx, alice, projectId, "ga");
    bob.conn.take();

    gated.hold();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    bob.send({ type: "openProject", projectId, generation: "gb" });
    await tick();
    expect(bob.conn.messages).toEqual([]); // the open waits behind the submission in the project queue
    gated.release();
    await ctx.app.idle();
    const [snapshot, ...rest] = bob.conn.take();
    expect(snapshot).toMatchObject({ type: "snapshot", generation: "gb", seq: 1 });
    expect(rest).toEqual([]); // c1 is inside the snapshot, not sent again as changes

    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c2", "j2", 2) });
    await ctx.app.idle();
    expect(bob.conn.take()).toEqual([expect.objectContaining({ type: "changes", generation: "gb", seq: 2 })]);
  });

  it("re-opening with a new generation replaces the subscription", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    expect(bob.conn.take()).toEqual([{ type: "presenceLeft", projectId, generation: "gb", clientId: "alice" }]);
    alice.conn.take();
    bob.send({ type: "submit", projectId, generation: "gb", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([expect.objectContaining({ type: "changes", generation: "ga2", seq: 1 })]);
  });
});

describe("server app: submissions", () => {
  it("saves, then broadcasts changes to every subscriber, then acks the sender", async () => {
    const gated = gatedRepository();
    const ctx = setup({ repository: gated.repository });
    const { alice, bob, projectId } = await room(ctx);
    const c1 = putJoint("c1", "j1", 1);
    gated.hold();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await tick();
    expect(alice.conn.messages).toEqual([]); // nothing before persistence completes
    expect(bob.conn.messages).toEqual([]);
    gated.release();
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "changes", projectId, generation: "ga", seq: 1, changeset: c1, clientId: "alice" },
      { type: "ack", projectId, generation: "ga", changesetId: "c1", seq: 1 },
    ]);
    expect(bob.conn.take()).toEqual([{ type: "changes", projectId, generation: "gb", seq: 1, changeset: c1, clientId: "alice" }]);
    expect((await gated.repository.load(projectId))?.seq).toBe(1);
  });

  it("acks a duplicate resend with its original seq and does not broadcast it again", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    const c1 = putJoint("c1", "j1", 1);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await ctx.app.idle();
    alice.conn.take();
    bob.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: c1 });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "ack", projectId, generation: "ga", changesetId: "c1", seq: 1 }]);
    expect(bob.conn.take()).toEqual([]);
  });

  it("serializes concurrent submissions: the second is checked against the first", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    bob.send({ type: "submit", projectId, generation: "gb", changeset: putJoint("c2", "j1", 2) });
    await ctx.app.idle();
    expect(alice.conn.types()).toEqual(["changes", "ack"]);
    expect(bob.conn.take()).toEqual([
      expect.objectContaining({ type: "changes", seq: 1, clientId: "alice" }),
      { type: "rejected", projectId, generation: "gb", changesetId: "c2", reason: { kind: "conflict", entities: [{ table: "joints", id: "j1" }] } },
    ]);
  });

  it("rejects an invalid result to the sender only", async () => {
    const ctx = setup({ validator: rejectX99 });
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 99) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "invalid", violations: ["I5: walls cross"] } },
    ]);
    expect(bob.conn.take()).toEqual([]);
  });

  it("rejects a reused ID with a different payload as malformed", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    alice.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j2", 5) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "malformed", message: "Changeset ID reused with a different payload" } },
    ]);
  });

  it("rejects structural errors as malformed and oversized messages as tooLarge, naming the changeset", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    alice.send({ type: "submit", projectId, generation: "ga", changeset: { ...putJoint("c1", "j1", 1), expect: [] } });
    const huge = { ...putJoint("c2", "j2", 2), patch: { puts: [{ table: "joints", entity: { id: "j2", x: 2, y: 0, pad: "x".repeat(MAX_MESSAGE_BYTES) } }], deletes: [] } };
    alice.session.receive(JSON.stringify({ type: "submit", projectId, generation: "ga", changeset: huge }));
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "malformed", message: "missing expectation for joints/j1" } },
      { type: "rejected", projectId, generation: "ga", changesetId: "c2", reason: { kind: "tooLarge" } },
    ]);
  });

  it("ignores a submission from a stale generation", async () => {
    const ctx = setup();
    const { alice, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    alice.conn.take();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([]);
  });

  it("rejects a submission for a project the session has not opened", async () => {
    const ctx = setup();
    const { alice } = await room(ctx);
    alice.send({ type: "submit", projectId: "other", generation: "g9", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([
      { type: "rejected", projectId: "other", generation: "g9", changesetId: "c1", reason: { kind: "unknownProject" } },
    ]);
  });
});

describe("server app: deleting projects (spec §7.2.1)", () => {
  it("tells every subscriber, answers the sender with the new list, and forgets the project", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    const carol = ctx.join("carol");
    const other = await createProject(ctx, carol, "Studio");
    carol.conn.take();
    carol.send({ type: "deleteProject", requestId: "d1", projectId });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projectDeleted", projectId, generation: "ga" }]);
    expect(bob.conn.take()).toEqual([{ type: "projectDeleted", projectId, generation: "gb" }]);
    expect(carol.conn.take()).toEqual([{ type: "projects", requestId: "d1", items: [{ id: other, name: "Studio" }] }]);
    expect(await ctx.repository.load(projectId)).toBeNull();

    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    alice.send({ type: "presence", projectId, generation: "ga", cursor: { x: 1, y: 1 }, selection: [] });
    bob.send({ type: "openProject", projectId, generation: "gb2" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "rejected", projectId, generation: "ga", changesetId: "c1", reason: { kind: "unknownProject" } }]);
    expect(bob.conn.take()).toEqual([{ type: "openFailed", projectId, generation: "gb2", message: "Unknown project" }]);
  });

  it("answers an unknown project with an error for the request", async () => {
    const ctx = setup();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "deleteProject", requestId: "d1", projectId: "missing" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "error", requestId: "d1", message: "Unknown project" }]);
  });

  it("waits for a save in progress: the queued submission is acked before the delete", async () => {
    const gated = gatedRepository();
    const ctx = setup({ repository: gated.repository });
    const { alice, bob, projectId } = await room(ctx);
    gated.hold();
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    bob.send({ type: "deleteProject", requestId: "d1", projectId });
    await tick();
    expect(bob.conn.messages).toEqual([]);
    gated.release();
    await ctx.app.idle();
    expect(alice.conn.types()).toEqual(["changes", "ack", "projectDeleted"]);
    expect(await gated.repository.load(projectId)).toBeNull();
  });

  it("a failed remove is fatal (crash-only, spec §7.2)", async () => {
    const inner = createInMemoryRepository();
    const ctx = setup({ repository: { ...inner, remove: () => Promise.reject(new Error("EACCES")) } });
    const { alice, bob, projectId } = await room(ctx);
    bob.send({ type: "deleteProject", requestId: "d1", projectId });
    await ctx.app.idle();
    expect(ctx.fatal).toEqual([new Error("EACCES")]);
    expect(alice.conn.take()).toEqual([]);
    expect(bob.conn.take()).toEqual([]);
  });
});

describe("server app: presence", () => {
  it("relays presence to the other subscribers with name and colour", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.send({ type: "presence", projectId, generation: "ga", cursor: { x: 1, y: 2 }, selection: [{ table: "walls", id: "w1" }] });
    expect(bob.conn.take()).toEqual([
      { type: "presence", projectId, generation: "gb", clientId: "alice", name: "Alice", color: alice.color, cursor: { x: 1, y: 2 }, selection: [{ table: "walls", id: "w1" }] },
    ]);
    expect(alice.conn.take()).toEqual([]);
  });

  it("ignores presence from a stale generation", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    await openProject(ctx, alice, projectId, "ga2");
    bob.conn.take();
    alice.send({ type: "presence", projectId, generation: "ga", cursor: null, selection: [] });
    expect(bob.conn.take()).toEqual([]);
  });

  it("announces presenceLeft when a client disconnects", async () => {
    const ctx = setup();
    const { alice, bob, projectId } = await room(ctx);
    alice.session.close();
    expect(bob.conn.take()).toEqual([{ type: "presenceLeft", projectId, generation: "gb", clientId: "alice" }]);
  });
});

describe("server app: repository errors are fatal (spec §7.2)", () => {
  it("calls onFatal once, sends no ack, rejection or changes, and stays silent afterwards", async () => {
    const repository = createInMemoryRepository();
    const ctx = setup({ repository });
    const { alice, bob, projectId } = await room(ctx);
    repository.failNextSave(new Error("disk full"));
    alice.send({ type: "submit", projectId, generation: "ga", changeset: putJoint("c1", "j1", 1) });
    await ctx.app.idle();
    expect(ctx.fatal).toEqual([new Error("disk full")]);
    expect(alice.conn.take()).toEqual([]);
    expect(bob.conn.take()).toEqual([]);

    bob.send({ type: "listProjects", requestId: "r9" });
    await ctx.app.idle();
    expect(bob.conn.take()).toEqual([]);
    expect(ctx.fatal).toHaveLength(1);
  });
});
