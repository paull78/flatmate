import { describe, expect, it } from "vitest";
import { emptyStored, type ServerMessage } from "@fm/protocol";
import { domainValidator } from "../src/adapters/domain-validator";
import { createInMemoryRepository } from "../src/app/testing";
import { setup } from "./helpers";

// Reading a project's drawing without opening it (cards step 01, AC-12).

const UNDERLAY = { id: "underlay", data: "abc" };
const JOINT = { id: "j1", x: 1, y: 2 };

async function withProject() {
  const repository = createInMemoryRepository();
  const ctx = setup({ repository });
  const state = await repository.create("Flat");
  await repository.save({ ...state, doc: { ...emptyStored(), joints: { j1: JOINT }, underlays: { underlay: UNDERLAY } } });
  return { ctx, repository, id: state.meta.id };
}

const drawing = (msgs: ServerMessage[]) => {
  const found = msgs.find((m) => m.type === "projectDrawing");
  if (found?.type !== "projectDrawing") throw new Error("no projectDrawing");
  return found;
};

describe("readProject", () => {
  it("answers with the stored drawing, joining no session", async () => {
    const { ctx, id } = await withProject();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "readProject", requestId: "r1", projectId: id });
    await ctx.app.idle();
    const answer = drawing(alice.conn.take());
    expect(answer).toMatchObject({ requestId: "r1", projectId: id });
    expect(answer.doc?.joints).toEqual({ j1: JOINT });
    // No session: another client's edit isn't sent on to this one, and a presence from it goes nowhere.
    const bob = ctx.join("bob");
    bob.conn.take();
    bob.send({ type: "openProject", projectId: id, generation: "g" });
    await ctx.app.idle();
    bob.conn.take();
    alice.send({ type: "readProject", requestId: "r2", projectId: id });
    await ctx.app.idle();
    expect(bob.conn.take()).toEqual([]);
    expect(alice.conn.types()).toEqual(["projectDrawing"]);
  });

  it("leaves out the logo too, as a card prints nothing, and an open still gets it (sheetset.21)", async () => {
    const repository = createInMemoryRepository();
    const ctx = setup({ repository });
    const state = await repository.create("Flat");
    const logos = { logo: { id: "logo", data: "/9j/", width: 1, height: 1 } };
    await repository.save({ ...state, doc: { ...emptyStored(), logos } });
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "readProject", requestId: "r1", projectId: state.meta.id });
    await ctx.app.idle();
    expect(drawing(alice.conn.take()).doc?.logos).toEqual({});
    alice.send({ type: "openProject", projectId: state.meta.id, generation: "g" });
    await ctx.app.idle();
    const snapshot = alice.conn.take().find((m) => m.type === "snapshot");
    expect(snapshot?.type === "snapshot" ? snapshot.doc.logos : null).toEqual(logos);
  });

  it("leaves out the underlay, and the stored project keeps it", async () => {
    const { ctx, repository, id } = await withProject();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "readProject", requestId: "r1", projectId: id });
    await ctx.app.idle();
    expect(drawing(alice.conn.take()).doc?.underlays).toEqual({});
    expect((await repository.load(id))?.doc.underlays).toEqual({ underlay: UNDERLAY });
    // An open afterwards still gets it: the read changed nothing held in memory.
    alice.send({ type: "openProject", projectId: id, generation: "g" });
    await ctx.app.idle();
    const snapshot = alice.conn.take().find((m) => m.type === "snapshot");
    expect(snapshot?.type === "snapshot" ? snapshot.doc.underlays : null).toEqual({ underlay: UNDERLAY });
  });

  it("answers an unknown project with no drawing, not an error or a failed open", async () => {
    const { ctx } = await withProject();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "readProject", requestId: "r1", projectId: "nope" });
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "projectDrawing", requestId: "r1", projectId: "nope", doc: null }]);
    expect(ctx.fatal).toEqual([]);
  });

  it("upgrades a drawing stored by an older version, as an open does", async () => {
    const repository = createInMemoryRepository();
    const ctx = setup({ repository, validator: domainValidator });
    const state = await repository.create("Old");
    await repository.save({ ...state, doc: emptyStored() }); // saved before layout states existed
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.send({ type: "readProject", requestId: "r1", projectId: state.meta.id });
    await ctx.app.idle();
    expect(Object.keys(drawing(alice.conn.take()).doc?.states ?? {})).toHaveLength(1);
  });

  it("answers a malformed request with an error on no request", async () => {
    const { ctx } = await withProject();
    const alice = ctx.join("alice");
    alice.conn.take();
    alice.session.receive(JSON.stringify({ type: "readProject", requestId: "r1" }));
    await ctx.app.idle();
    expect(alice.conn.take()).toEqual([{ type: "error", requestId: null, message: "Invalid readProject" }]);
  });
});
