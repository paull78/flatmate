import { describe, expect, it } from "vitest";
import { emptyStored, emptyVersions } from "@fm/protocol";
import type { Changeset } from "@fm/protocol";
import { decideSubmit, fingerprintOf } from "../src/app/decide-submit";
import type { ProjectState } from "../src/app/ports";
import { acceptAll, deleteJoint, putJoint, rejectX99 } from "./helpers";

const fresh = (): ProjectState => ({ meta: { id: "p1", name: "Apartment" }, seq: 0, doc: emptyStored(), versions: emptyVersions(), receipts: {} });

function accept(state: ProjectState, cs: Changeset): ProjectState {
  const decision = decideSubmit(state, cs, acceptAll);
  if (decision.kind !== "accept") throw new Error(`expected accept, got ${JSON.stringify(decision)}`);
  return decision.next;
}

describe("decideSubmit", () => {
  it("accepts: next seq, applied doc, stamped versions, receipt; input untouched", () => {
    const start = fresh();
    const c1 = putJoint("c1", "j1", 1);
    const decision = decideSubmit(start, c1, acceptAll);
    expect(decision).toEqual({
      kind: "accept",
      seq: 1,
      next: {
        meta: start.meta,
        seq: 1,
        doc: { joints: { j1: { id: "j1", x: 1, y: 0 } }, walls: {}, zoneLabels: {} },
        versions: { joints: { j1: "c1" }, walls: {}, zoneLabels: {} },
        receipts: { c1: { seq: 1, fingerprint: fingerprintOf(c1) } },
      },
    });
    expect(start).toEqual(fresh());
  });

  it("answers a matching resend with its original seq (duplicate)", () => {
    const c1 = putJoint("c1", "j1", 1);
    expect(decideSubmit(accept(fresh(), c1), c1, acceptAll)).toEqual({ kind: "duplicate", seq: 1 });
  });

  it("rejects a reused ID with a different payload as malformed", () => {
    const state = accept(fresh(), putJoint("c1", "j1", 1));
    expect(decideSubmit(state, putJoint("c1", "j1", 2), acceptAll)).toEqual({
      kind: "reject",
      reason: { kind: "malformed", message: "Changeset ID reused with a different payload" },
    });
  });

  it("rejects failed expectations as a conflict naming the entities (first writer wins)", () => {
    const state = accept(fresh(), putJoint("c1", "j1", 1));
    expect(decideSubmit(state, putJoint("c2", "j1", 2, null), acceptAll)).toEqual({
      kind: "reject",
      reason: { kind: "conflict", entities: [{ table: "joints", id: "j1" }] },
    });
  });

  it("rejects an invalid result with the validator's violations", () => {
    expect(decideSubmit(fresh(), putJoint("c1", "j1", 99), rejectX99)).toEqual({
      kind: "reject",
      reason: { kind: "invalid", violations: ["I5: walls cross"] },
    });
  });

  it("delete, recreate, delete: an expectation for the first deletion fails against the second tombstone", () => {
    const created = accept(fresh(), putJoint("c1", "j1", 0));
    const deleted = accept(created, deleteJoint("c2", "j1", "c1"));
    expect(deleted.doc.joints).toEqual({});
    expect(deleted.versions.joints).toEqual({ j1: "c2" }); // tombstone
    const recreated = accept(deleted, putJoint("c3", "j1", 5, "c2")); // recreating needs the deletion version
    const deletedAgain = accept(recreated, deleteJoint("c4", "j1", "c3"));
    expect(decideSubmit(deletedAgain, putJoint("c5", "j1", 9, "c2"), acceptAll)).toMatchObject({ kind: "reject", reason: { kind: "conflict" } });
    // Only a never-used ID has a null version.
    expect(decideSubmit(deletedAgain, putJoint("c6", "j1", 9, null), acceptAll)).toMatchObject({ kind: "reject", reason: { kind: "conflict" } });
    expect(decideSubmit(deletedAgain, putJoint("c7", "j2", 9, null), acceptAll).kind).toBe("accept");
  });

  it("a retry after 1,000 other accepted changes gets its original seq", () => {
    const c0 = putJoint("c0", "j0", 0);
    let state = accept(fresh(), c0);
    for (let i = 1; i <= 1000; i++) state = accept(state, putJoint(`c${i}`, `j${i}`, i));
    expect(state.seq).toBe(1001);
    expect(decideSubmit(state, c0, acceptAll)).toEqual({ kind: "duplicate", seq: 1 });
  });

  it("fingerprints ignore object key order but not payload changes", () => {
    const c1 = putJoint("c1", "j1", 1);
    const reordered: Changeset = {
      expect: [{ lastCs: null, id: "j1", table: "joints" }],
      patch: { deletes: [], puts: [{ entity: { y: 0, x: 1, id: "j1" }, table: "joints" }] },
      id: "c1",
    };
    expect(fingerprintOf(reordered)).toBe(fingerprintOf(c1));
    expect(fingerprintOf(putJoint("c1", "j1", 2))).not.toBe(fingerprintOf(c1));
  });
});
