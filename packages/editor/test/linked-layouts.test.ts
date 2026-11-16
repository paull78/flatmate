import { describe, expect, it } from "vitest";
import type { Document } from "@fm/domain";
import { objectFieldCommand, objectFields } from "../src/properties/object";
import { roomDoc, studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Layouts linked by default in the editor (review.05–.07): the note when a new piece lands in one layout only, the
// refusal that names the other layout, and the "Every layout" switch in Properties.

// studioDoc: Layout (s0) holds a bed, an exception, at x 0.7–2.3, y 1–3; Night (n/s0) is empty.
const linkedChair = (): Document => withCommands(studioDoc(), { type: "placeObject", deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 1 } });
const linkedField = (doc: Document, placementId: string) => {
  const props = objectFields(doc, placementId);
  return props.kind === "object" ? props.fields.find((f) => f.id === "linked") : undefined;
};

describe("placing in one layout only", () => {
  it("a chair put down in Night where Layout's bed stands lands in Night only, with a note naming Layout", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "setActiveState", id: "n/s0" });
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.click({ x: 1.5, y: 2 });
    const chairs = Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === "chair");
    expect(chairs.map((p) => p.state)).toEqual(["n/s0"]);
    expect(shell.view().toast).toBe("Only in Night: it doesn't fit in Layout");
  });

  it("a chair that fits in both layouts lands in both, with no note", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.click({ x: 4, y: 2 });
    const chairs = Object.values(shell.doc().placements).filter((p) => shell.doc().objects[p.object]?.kind === "chair");
    expect(chairs.map((p) => p.state).sort()).toEqual(["n/s0", "s0"]);
    expect(shell.view().toast).toBeNull();
  });
});

describe("a move refused by another layout", () => {
  it("names the layout, as the domain's fit message does: … in Night", () => {
    // A coffee table in Night only, at x 4.5–5.5, y 1.5–2; the linked chair moved onto it in Layout is refused.
    const doc = withCommands(linkedChair(), { type: "placeObject", deck: null, opId: "t", state: "n/s0", object: { kind: "coffeeTable" }, at: { x: 5, y: 2 }, linked: false });
    const shell = FakeShell.withDocument(doc);
    const chair = Object.values(doc.placements).find((p) => p.object === "ch/o0" && p.state === "s0");
    if (!chair) throw new Error("no chair");
    shell.command({ type: "movePlacement", placementId: chair.id, at: { x: 5, y: 2 }, rotation: 0 });
    expect(shell.view().toast).toMatch(/Coffee table.* in Night$/);
    expect(shell.doc().placements[chair.id]?.at).toEqual({ x: 4, y: 1 });
  });
});

describe("the Every layout switch", () => {
  it("shows on for a linked piece and off for an exception, with two layouts", () => {
    const doc = linkedChair();
    expect(linkedField(doc, "ch/p0")).toMatchObject({ label: "Every layout", value: "true", toggle: true });
    expect(linkedField(doc, "bed/p0")).toMatchObject({ value: "false" });
  });

  it("is absent with one layout", () => {
    const doc = withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "ch", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 1 } });
    expect(linkedField(doc, "ch/p0")).toBeUndefined();
  });

  it("is absent for a piece always in every layout (a beam)", () => {
    const doc = withCommands(studioDoc(), { type: "placeObject", deck: null, opId: "bm", state: "s0", object: { kind: "beam", size: { w: 0.1, d: 3.8 } }, at: { x: 3, y: 3.9 } });
    const beam = Object.values(doc.placements).find((p) => p.object === "bm/o0" && p.state === "s0");
    expect(beam).toBeDefined();
    if (beam) expect(linkedField(doc, beam.id)).toBeUndefined();
  });

  it("sends setLinked", () => {
    const doc = linkedChair();
    expect(objectFieldCommand(doc, "ch/p0", "linked", "false")).toEqual({ type: "setLinked", placementId: "ch/p0", on: false });
    expect(objectFieldCommand(doc, "bed/p0", "linked", "true")).toEqual({ type: "setLinked", placementId: "bed/p0", on: true });
    expect(objectFieldCommand(doc, "ch/p0", "linked", "maybe")).toBeNull();
  });
});
