import { describe, expect, it } from "vitest";
import { deserialize, serialize, unwrap, type Document } from "@fm/domain";
import type { Primitive } from "../src/view/scene-types";
import type { ViewModel } from "../src/view/view-model";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Retired kinds (furnish.19, AC-16): the Kitchen block and the Bathroom block have no tile and are offered nowhere,
// but a stored drawing holding them still opens, draws them, moves them and deletes them.

/** The kitchen block (k/p0) at x 0.3–2.7, y 3.3–3.9 and the bathroom block (b/p0) at x 3.6–5.4, y 2.4–3.9, through a save and load. */
const stored: Document = unwrap(deserialize(JSON.parse(JSON.stringify(serialize(withCommands(
  roomDoc(),
  { type: "placeObject", deck: null, opId: "k", state: "s0", object: { kind: "kitchenBlock" }, at: { x: 1.5, y: 3.9 } },
  { type: "placeObject", deck: null, opId: "b", state: "s0", object: { kind: "bathroomBlock" }, at: { x: 4.5, y: 3.9 } },
))))));

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
const kindField = (shell: FakeShell) => fields(shell.view()).find((f) => f.id === "kind");
const objectKinds = (shell: FakeShell) => Object.values(shell.doc().objects).map((o) => o.kind);
const count = (ps: readonly Primitive[], kind: Primitive["kind"]) => ps.filter((p) => p.kind === kind).length;

describe("retired kinds in a stored drawing (furnish.19, AC-16)", () => {
  it("a stored drawing with both blocks opens and draws both with their symbols (AC-16)", () => {
    const shell = FakeShell.withDocument(stored);
    const objects = shell.scene().layers.find((l) => l.name === "objects")?.primitives ?? [];
    // Kitchen: 8 arcs (four burner rings, the sink's four rounded corners), 9 segments (outline 4, front 1, sink 4).
    // Bathroom: 31 segments (outline 4, front 1, cistern 4, a 16-segment bowl, tray 4, its cross 2). Two bare
    // rectangles would give 0 arcs and 10 segments.
    expect(count(objects, "polygon")).toBe(2);
    expect(count(objects, "arc")).toBe(8);
    expect(count(objects, "segment")).toBe(40);
  });

  it("a stored kitchen block moves and a stored bathroom block deletes, each undoable (AC-16)", () => {
    const shell = FakeShell.withDocument(stored);
    shell.drag({ x: 1.5, y: 3.6 }, { x: 1.5, y: 1.6 }, { ctrl: true }); // Ctrl: no snap, no turn
    const k = shell.doc().placements["k/p0"];
    expect(k?.at.x).toBeCloseTo(1.5, 6);
    expect(k?.at.y).toBeCloseTo(1.9, 6);
    expect(k?.rotation).toBe(0);
    shell.click({ x: 4.5, y: 3.1 });
    shell.key("Delete");
    expect(objectKinds(shell)).toEqual(["kitchenBlock"]);
    shell.key("z", { ctrl: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects).toEqual(stored.objects);
    expect(shell.doc().placements).toEqual(stored.placements);
  });

  it("a stored bathroom block moves and a stored kitchen block deletes, each undoable (AC-16)", () => {
    const shell = FakeShell.withDocument(stored);
    shell.drag({ x: 4.5, y: 3.1 }, { x: 4.5, y: 2.1 }, { ctrl: true }); // to x 3.6–5.4, y 1.4–2.9, clear of the kitchen block
    const b = shell.doc().placements["b/p0"];
    expect(b?.at.x).toBeCloseTo(4.5, 6);
    expect(b?.at.y).toBeCloseTo(2.9, 6);
    expect(b?.rotation).toBe(0);
    shell.click({ x: 1.5, y: 3.6 });
    shell.key("Delete");
    expect(objectKinds(shell)).toEqual(["bathroomBlock"]);
    shell.key("z", { ctrl: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects).toEqual(stored.objects);
    expect(shell.doc().placements).toEqual(stored.placements);
  });

  it("the Kind field never offers a retired kind; a stored block shows its own kind (AC-06, AC-16)", () => {
    const wardrobe = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 3.9 } }));
    wardrobe.click({ x: 3, y: 3.6 });
    expect(kindField(wardrobe)?.options?.map((o) => o.value).filter((v) => v !== "wardrobe")).toEqual([
      "bed", "mattress", "loftBed", "sofa", "armchair", "coffeeTable", "roundTable", "desk", "hobUnit", "sinkUnit", "counter", "fridge", "dishwasher", "ovenColumn", "wallCabinet",
      "toilet", "bidet", "washbasin", "cornerBasin", "showerTray", "cornerShower", "bathtub", "washingMachine",
      "drawers", "nightstand", "chair", "shelf", "tvUnit", "block", "roundBlock", "cornerBlock", "plant", "cot", "radiator", "towelRail", "rug", "roundRug", "vanityUnit", "palm", "fern", "rosette", "range", "cookerHood", "tallPantry", "stool", "barTable", "bench", "storageChest", "electricFireplace", "wallUnit", "woodStove", "picture", "mirror", "clock", "wallTv", "pegboard", "coatHooks", "coatStand", "glassCabinet", "halfGlassCabinet", // no L kind (catalog.28)
    ]);

    const shell = FakeShell.withDocument(stored);
    shell.click({ x: 1.5, y: 3.6 });
    const kind = kindField(shell);
    expect(kind?.value).toBe("kitchenBlock");
    expect(kind?.options).toContainEqual({ value: "kitchenBlock", label: "Kitchen block" });
    expect(kind?.options?.map((o) => o.value)).not.toContain("bathroomBlock");
    const before = shell.doc();
    shell.ui({ type: "setField", fieldId: "kind", value: "bathroomBlock" });
    expect(shell.doc()).toBe(before);
  });
});
