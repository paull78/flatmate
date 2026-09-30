import { describe, expect, it } from "vitest";
import { emptyDocument, execute, unwrap } from "@fm/domain";
import { createLocalDocument } from "../src/document/local-document";
import { canCommit, commit, isDirty, onEvent, status, visibleDoc } from "../src/document/open-document";
import { FakeHost } from "./fake-shell";

const project = { id: "local", name: "Untitled" };
const addWall = unwrap(
  execute(emptyDocument(), { type: "addWall", opId: "w", from: { at: { x: 0, y: 0 } }, to: { at: { x: 2, y: 0 } } }),
);

describe("LocalDocument (spec §7.0)", () => {
  it("starts clean and editable", () => {
    const d = createLocalDocument(project, "open1");
    expect(d.revision).toBe(0);
    expect(visibleDoc(d)).toEqual(emptyDocument());
    expect(status(d)).toBe("not saved");
    expect(isDirty(d)).toBe(false);
    expect(canCommit(d)).toBe(true);
  });

  it("accepts a commit in the same step, with no save effect", () => {
    const d = createLocalDocument(project, "open1");
    const step = commit(d, { id: "c1", patch: addWall.patch, dependencies: addWall.patch.dependencies });
    expect(step.notices).toEqual([{ type: "accepted", id: "c1" }]);
    expect(step.effects).toEqual([]);
    expect(step.doc.kind === "local" && step.doc.revision).toBe(1); // stays valid when phase 7 widens OpenDocument
    expect(visibleDoc(step.doc)).toEqual(addWall.doc);
    expect(isDirty(step.doc)).toBe(true);
  });

  it("throws when a patch fails to apply (callers validate first)", () => {
    const d = createLocalDocument(project, "open1");
    const bad = { puts: [{ table: "joints" as const, entity: { id: "j", x: "a", y: 0 } }], deletes: [] };
    expect(() => commit(d, { id: "c1", patch: bad, dependencies: [] })).toThrow("Local commit c1 failed");
  });

  it("can start from an existing document", () => {
    expect(visibleDoc(createLocalDocument(project, "open1", addWall.doc))).toBe(addWall.doc);
  });

  it("ignores server events", () => {
    const d = createLocalDocument(project, "open1");
    const step = onEvent(d, { type: "connection", state: "open" }, new FakeHost());
    expect(step.doc).toBe(d);
    expect(step.effects).toEqual([]);
    expect(step.notices).toEqual([]);
  });
});
