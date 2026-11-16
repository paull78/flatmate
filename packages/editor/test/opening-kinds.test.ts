import { describe, expect, it } from "vitest";
import { OPENING_KINDS, OPENING_KIND_IDS, openingLabel, parseOpening, type OpeningKind } from "@fm/domain";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Every opening kind comes from one domain table (arch-review R-01, AC-08): a kind added there parses, gets a label,
// is offered by the floating bar and the Properties choice, and can be set from Properties.
describe("opening kinds from one table", () => {
  const withSwing = () => {
    const doc = roomDoc();
    return withCommands(doc, { type: "addOpening", opId: "d", wall: wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 }), kind: "swing", offset: 2.6 });
  };

  it.each(OPENING_KIND_IDS)("%s parses, has a message noun, and is offered by the ViewModel", (kind: OpeningKind) => {
    const info = OPENING_KINDS[kind];
    const row = { id: "o", wall: "w", kind, offset: 0, width: info.width.default, side: "left", hinge: "a", glazed: false, sill: info.fromFloor ? 0 : 0.9, head: 2.1 };
    expect(parseOpening(row)).toEqual(row);
    expect(openingLabel(kind)).toBe(info.noun);
    const shell = FakeShell.withDocument(withSwing());
    expect(shell.view().openingKinds).toContainEqual(expect.objectContaining({ kind, label: info.label }));
    shell.click({ x: 3, y: 0 });
    const props = shell.view().properties;
    const field = props.kind === "opening" ? props.fields.find((f) => f.id === "kind") : undefined;
    expect(field?.options).toContainEqual(expect.objectContaining({ value: kind, label: info.label }));
  });

  it.each(OPENING_KIND_IDS)("Properties can switch a door to %s", (kind: OpeningKind) => {
    const shell = FakeShell.withDocument(withSwing());
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "setField", fieldId: "kind", value: kind });
    expect(shell.doc().openings["d/d0"]?.kind).toBe(kind);
  });

  it("the floating bar's kinds are the table's, in order", () => {
    const shell = FakeShell.withDocument(withSwing());
    expect(shell.view().openingKinds.map(({ kind, label }) => ({ kind, label }))).toEqual(OPENING_KIND_IDS.map((kind) => ({ kind, label: OPENING_KINDS[kind].label })));
  });
});

// The spec's Defaults and flips table (openkinds.10): the fields Properties shows per kind, with their labels.
const SHOWN: Record<OpeningKind, readonly string[]> = {
  swing: ["Kind", "Width", "Height", "Side", "Hinge", "Glazed"],
  double: ["Kind", "Width", "Height", "Side", "Glazed"],
  sliding: ["Kind", "Width", "Height", "Side", "Parks at", "Glazed"],
  pocket: ["Kind", "Width", "Height", "Pocket at"],
  folding: ["Kind", "Width", "Height", "Side", "Stacks at"],
  slidingGlass: ["Kind", "Width", "Height"],
  window: ["Kind", "Width", "Sill", "Height", "Sheer curtain", "Shutter box"],
  casement: ["Kind", "Width", "Sill", "Height", "Side", "Hinge", "Sheer curtain", "Shutter box"],
  twoLeaf: ["Kind", "Width", "Sill", "Height", "Side", "Sheer curtain", "Shutter box"],
  passage: ["Kind", "Width", "Height"],
  curtain: ["Kind", "Width", "Height", "Hangs on"],
};

describe("Properties shows each kind's fields (openkinds.10, AC-09)", () => {
  it.each(OPENING_KIND_IDS)("%s", (kind: OpeningKind) => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "d", wall, kind, offset: 2.6 }));
    shell.click({ x: 3, y: 0 });
    const props = shell.view().properties;
    expect(props.kind === "opening" ? props.fields.map((f) => f.label) : []).toEqual(SHOWN[kind]);
  });
});

describe("the Opening tool places every kind (AC-05)", () => {
  it.each(OPENING_KIND_IDS)("%s, at its default width, centred at the click", (kind: OpeningKind) => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickOpeningKind", kind });
    shell.click({ x: 3, y: 0.05 });
    const width = OPENING_KINDS[kind].width.default;
    expect(Object.values(shell.doc().openings)).toEqual([expect.objectContaining({ kind, width, offset: 3 - width / 2 })]);
  });
});

// One kind picker in three groups (openkinds.07, AC-07): the ViewModel's kinds carry their group's name, in the
// table's order, so the floating bar and Properties draw the same list.
describe("the kinds in groups (AC-07)", () => {
  it("the floating bar's kinds come in group order, each kind once, each with its group's name", () => {
    const kinds = FakeShell.withDocument(roomDoc()).view().openingKinds;
    expect(kinds.map((k) => k.kind)).toEqual([...OPENING_KIND_IDS]);
    const names = { doors: "Doors", windows: "Windows", doorways: "Doorways" };
    expect(kinds.map((k) => k.group)).toEqual(OPENING_KIND_IDS.map((k) => names[OPENING_KINDS[k].group]));
  });

  it("Properties' Kind field is the same picker: grouped options, marked as the kind picker", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "d", wall, kind: "swing", offset: 2.6 }));
    shell.click({ x: 3, y: 0 });
    const props = shell.view().properties;
    const field = props.kind === "opening" ? props.fields.find((f) => f.id === "kind") : undefined;
    expect(field?.kindPicker).toBe(true);
    expect(field?.options).toEqual(shell.view().openingKinds.map((k) => ({ value: k.kind, label: k.label, group: k.group })));
  });
});

describe("switching kind in Properties (openkinds.06, AC-06)", () => {
  it("clamps the width keeping the centre, as one undo step", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "d", wall, kind: "swing", offset: 1.7, width: 0.6 }));
    shell.click({ x: 2, y: 0 });
    shell.ui({ type: "setField", fieldId: "kind", value: "double" });
    const switched = shell.doc().openings["d/d0"];
    expect(switched && { kind: switched.kind, width: switched.width, centre: switched.offset + switched.width / 2 }).toEqual({ kind: "double", width: 0.8, centre: 2 });
    shell.ui({ type: "undo" });
    expect(shell.doc().openings["d/d0"]).toMatchObject({ kind: "swing", width: 0.6, offset: 1.7 });
  });
});

describe("the click's hinge (openkinds.10, AC-09)", () => {
  it("near the wall's left end a swing door hinges there, a sliding door parks toward the right end", () => {
    for (const [kind, hinge] of [["swing", "a"], ["sliding", "b"]] as const) {
      const doc = roomDoc();
      const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
      const shell = FakeShell.withDocument(doc);
      shell.ui({ type: "pickOpeningKind", kind });
      shell.click({ x: 1, y: 0.05 });
      const o = Object.values(shell.doc().openings)[0];
      const leftEnd = doc.joints[doc.walls[wall]?.a ?? ""]?.x === 0 ? "a" : "b"; // the wall's end at x 0
      expect(o && (o.hinge === leftEnd ? "a" : "b"), kind).toBe(hinge);
    }
  });
});

describe("AC-06 in Properties", () => {
  it("a 0.80 swing door switched to a sliding glass door is 1.00 m about the same centre; one undo restores it", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "d", wall, kind: "swing", offset: 1.6, width: 0.8 }));
    const before = shell.doc().openings["d/d0"];
    shell.click({ x: 2, y: 0 });
    shell.ui({ type: "setField", fieldId: "kind", value: "slidingGlass" });
    const o = shell.doc().openings["d/d0"];
    expect(o && { kind: o.kind, width: o.width, centre: o.offset + o.width / 2 }).toEqual({ kind: "slidingGlass", width: 1, centre: before ? before.offset + 0.4 : 0 });
    shell.ui({ type: "undo" });
    expect(shell.doc().openings["d/d0"]).toEqual(before);
  });
});

describe("a curtain keeps its side and hinge across a switch (AC-09)", () => {
  it("switched to a swing door and back, its side and hinge are the same", () => {
    const doc = roomDoc();
    const wall = wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "c", wall, kind: "curtain", offset: 2.6, side: "right", hinge: "b" }));
    shell.click({ x: 3, y: 0 });
    shell.ui({ type: "setField", fieldId: "kind", value: "swing" });
    shell.ui({ type: "setField", fieldId: "kind", value: "curtain" });
    expect(shell.doc().openings["c/d0"]).toMatchObject({ kind: "curtain", side: "right", hinge: "b" });
  });
});
