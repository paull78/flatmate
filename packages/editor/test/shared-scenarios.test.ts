import { describe, expect, it } from "vitest";
import { applyPatch, unwrap } from "@fm/domain";
import { stampVersions } from "@fm/protocol";
import { sharedOnEvent } from "../src/document/shared-document";
import type { Notice, SharedDocument } from "../src/document/types";
import type { Effect } from "../src/ports/effects";
import type { ServerEvent } from "../src/ports/events";
import { jointAt, pointOf } from "./builders";
import { FakeHost } from "./fake-shell";
import { changesetFor, checkConsistent, ev, inFlightOf, pending } from "./shared-builders";

type StepFn = (d: SharedDocument) => ServerEvent;

/** Folds events through the reducer, checking consistency after every step. */
function run(start: SharedDocument, steps: StepFn[]) {
  const host = new FakeHost();
  let d = start;
  const notices: Notice[] = [];
  const effects: Effect[] = [];
  for (const make of steps) {
    const r = sharedOnEvent(d, make(d), host);
    checkConsistent(r.doc);
    d = r.doc;
    notices.push(...r.notices);
    effects.push(...r.effects);
  }
  return { d, notices, effects };
}

const closed: StepFn = () => ({ type: "connection", state: "closed" });
const opened: StepFn = () => ({ type: "connection", state: "open" });

/** The server's state once it accepted `start`'s outstanding edit as seq 43. */
function serverWith(start: SharedDocument) {
  const cs = inFlightOf(start);
  return {
    doc: unwrap(applyPatch(start.confirmed.doc, cs.patch)),
    versions: stampVersions(start.confirmed.versions, cs.patch, cs.id),
    seq: 43,
  };
}

describe("shared document scenarios (spec §9.1)", () => {
  it("snapshot already contains my edit: the resend is acked from the receipt; settled once, applied once", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices, effects } = run(start, [
      closed,
      opened,
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
      (d) => ev.ack(d, "c1", 43), // a duplicate ack settles nothing twice
    ]);
    expect(d.inFlight).toBeNull();
    expect(d.visible).toEqual(server.doc);
    expect(d.confirmed.seq).toBe(43);
    expect(notices.map((n) => n.type)).toEqual(["offline", "resynced", "accepted"]);
    expect(effects.filter((e) => e.type === "submit")).toHaveLength(1); // the resend, same ID
  });

  it("own changes arrive but the ack is lost with the connection: reconnect, snapshot, resend, ack", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices } = run(start, [
      (d) => ev.changes(d, inFlightOf(start), 43, "tab1"),
      closed,
      opened,
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
    ]);
    expect(d.inFlight).toBeNull();
    expect(d.confirmed.seq).toBe(43);
    expect(notices.map((n) => n.type)).toEqual(["offline", "resynced", "accepted"]);
  });

  it("an early ack, then the snapshot, then the resend's ack", () => {
    const start = pending();
    const server = serverWith(start);
    const { d, notices, effects } = run(start, [
      (d) => ev.ack(d, "c1", 43), // ahead: ignored, snapshot requested
      (d) => ev.snapshot(d, server),
      (d) => ev.ack(d, "c1", 43),
    ]);
    expect(d.inFlight).toBeNull();
    expect(notices.map((n) => n.type)).toEqual(["resynced", "accepted"]);
    expect(effects.map((e) => e.type)).toEqual(["workspace", "submit"]);
  });

  it("a remote change to the same joint, then the rejection: visible equals confirmed", () => {
    const start = pending();
    const corner = jointAt(start.confirmed.doc, { x: 6, y: 4 });
    const bob = changesetFor(start.confirmed.doc, start.confirmed.versions, { type: "moveJoints", moves: [{ jointId: corner, to: { x: 6, y: 5 } }] }, "b1");
    const { d, notices } = run(start, [
      (d) => ev.changes(d, bob, 43),
      (d) => ev.rejected(d, "c1", { kind: "conflict", entities: [{ table: "joints", id: corner }] }),
    ]);
    expect(d.visible).toBe(d.confirmed.doc);
    expect(pointOf(d.visible, corner)).toEqual({ x: 6, y: 5 });
    expect(notices.map((n) => n.type)).toEqual(["remoteChange", "rejected"]);
  });

  it("a response from the previous generation is ignored after a resync", () => {
    const start = pending();
    const { d, notices } = run(start, [closed, opened, () => ev.ack(start, "c1", 42, start.generation)]);
    expect(d.inFlight?.id).toBe("c1");
    expect(d.connection).toBe("syncing");
    expect(notices.map((n) => n.type)).toEqual(["offline"]);
  });
});
