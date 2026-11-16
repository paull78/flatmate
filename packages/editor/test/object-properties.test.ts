import { describe, expect, it } from "vitest";
import { OBJECT_KINDS, canSwitchKind, deserialize, kindOf, placementRange, serialize, unwrap, type Document } from "@fm/domain";
import { objectFields } from "../src/properties/object";
import { PALETTE_KINDS } from "../src/view/palette";
import { steppedValue, type ViewModel } from "../src/view/view-model";
import { bed160x200, nightBedDoc, roomDoc, studioDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

const fields = (vm: ViewModel) => ("fields" in vm.properties ? vm.properties.fields : []);
/** A bed in Layout (bed/p0, x 2.2–3.8, y 1.9–3.9) and its copy in Night (n/p0). */
const bedTwo = () => withCommands(
  roomDoc(),
  { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3.9 } },
  bed160x200("bed/o0"),
  { type: "copyState", opId: "n", from: "s0", name: "Night" },
);

describe("object properties (spec: layouts)", () => {
  it("shows kind, name, configuration, width, depth and angle of the selected placement", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.click({ x: 1.5, y: 2 });
    expect(shell.view().properties.kind).toBe("object");
    expect(fields(shell.view()).map((f) => [f.id, f.value, f.readOnly])).toEqual([
      ["kind", "bed", false],
      ["name", "Bed", false],
      ["preset", "custom", false], // 1.60 × 2.00 is no preset
      ["width", "1.60", false],
      ["depth", "2.00", false],
      ["height.standard", "1.00", false],
      ["elevation.standard", "0.00", false],
      ["atCeiling.standard", "false", false],
      ["top", "1.00 · 1.50 to ceiling", true],
      ["config", "Standard", true], // one configuration: nothing to choose, shown by its label (cleanup.09)
      ["standsOn", "Floor", true], // under no deck: the floor only (decks.16)
      ["angle", "0", false],
      ["linked", "false", false], // an exception in Layout and Night (review.07)
      ["sides.front", "false", false],
      ["sides.back", "false", false],
      ["sides.left", "true", false],
      ["sides.right", "true", false],
    ]);
  });

  it("offers a transformable kind's configurations and switches them", () => {
    // Back against the top wall's face (y = 3.9): down, it opens into the room (AC-28).
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } }));
    shell.click({ x: 3, y: 3.7 });
    const config = fields(shell.view()).find((f) => f.id === "config");
    expect(config?.options).toEqual([{ value: "folded", label: "Closed" }, { value: "down", label: "Open" }]);
    shell.ui({ type: "setField", fieldId: "config", value: "down" });
    expect(shell.doc().placements["m/p0"]?.config).toBe("down");
    expect(fields(shell.view()).find((f) => f.id === "depth")?.value).toBe("2.10");
  });

  it("a selected murphy bed lists fields in sections Object, Size, Placement; Configuration is a choice of Closed and Open; Width has step 0.01 and unit m (AC-10)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } }));
    shell.click({ x: 3, y: 3.7 });
    expect(fields(shell.view()).map((f) => [f.section, f.id])).toEqual([
      ["Object", "kind"],
      ["Object", "opensInto"],
      ["Object", "name"],
      ["Size", "preset"],
      ["Size", "width"],
      ["Size", "depth"],
      ["Height", "height.folded"],
      ["Height", "elevation.folded"],
      ["Height", "atCeiling.folded"],
      ["Height", "height.down"],
      ["Height", "elevation.down"],
      ["Height", "atCeiling.down"],
      ["Height", "top"],
      ["Placement", "config"],
      ["Placement", "standsOn"],
      ["Placement", "angle"],
    ]);
    const config = fields(shell.view()).find((f) => f.id === "config");
    expect(config?.options?.map((o) => o.label)).toEqual(["Closed", "Open"]);
    expect(fields(shell.view()).find((f) => f.id === "width")).toMatchObject({ step: 0.01, unit: "m" });
    expect(fields(shell.view()).find((f) => f.id === "angle")).toMatchObject({ step: 1, unit: "°" });
    expect(fields(shell.view()).find((f) => f.id === "kind")?.step).toBeUndefined();
  });

  it("setField width to the current value plus 0.01 resizes the object once (one undo step) (AC-10)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } }));
    shell.click({ x: 3, y: 3.7 });
    const width = fields(shell.view()).find((f) => f.id === "width");
    if (!width) throw new Error("no width field");
    shell.ui({ type: "setField", fieldId: "width", value: steppedValue(width, 1) });
    expect(shell.doc().objects["m/o0"]?.w.folded).toBe(1.61);
    expect(shell.doc().objects["m/o0"]?.w.down).toBe(1.61);
    expect(fields(shell.view()).find((f) => f.id === "width")?.value).toBe("1.61");
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["m/o0"]?.w.folded).toBe(1.6);
    expect(shell.doc().objects["m/o0"]?.w.down).toBe(1.6);
  });

  it("Width 2.40 on a closed Murphy bed makes the open state 2.40 wide; Depth edits the current configuration only (AC-03)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } }));
    shell.click({ x: 3, y: 3.7 });
    shell.ui({ type: "setField", fieldId: "width", value: "2.40" });
    expect(shell.doc().objects["m/o0"]).toMatchObject({ w: { folded: 2.4, down: 2.4 }, d: { folded: 0.4, down: 2.1 } });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.ui({ type: "setField", fieldId: "depth", value: "0.45" });
    expect(shell.doc().objects["m/o0"]).toMatchObject({ w: { folded: 2.4, down: 2.4 }, d: { folded: 0.45, down: 2.1 } });
    shell.key("z", { ctrl: true });
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["m/o0"]?.w).toEqual({ folded: 1.6, down: 1.6 });
  });

  it("an angle of 30 turns the footprint; name edits rename the object (AC-14)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }));
    shell.click({ x: 3, y: 2 });
    shell.ui({ type: "setField", fieldId: "angle", value: "30" }); // turns about the centre
    expect(shell.doc().placements["bed/p0"]?.rotation).toBe(30);
    shell.ui({ type: "setField", fieldId: "name", value: "Guest bed" });
    expect(shell.doc().objects["bed/o0"]?.name).toBe("Guest bed");
  });

  it("a width of 1.80 applies in every layout; a width that strands the Night placement is refused naming Night (AC-16)", () => {
    const doc = withCommands(nightBedDoc(), { type: "placeObject", linked: false, deck: null, opId: "d", state: "s0", object: { existing: "bed/o0" }, at: { x: 1.5, y: 3 } });
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1.5, y: 2 });
    shell.ui({ type: "setField", fieldId: "width", value: "1.70" });
    expect(shell.doc().objects["bed/o0"]?.w.standard).toBe(1.7);
    shell.ui({ type: "setField", fieldId: "width", value: "2.00" }); // Night: x 4.0–6.0, into the right wall
    expect(shell.doc().objects["bed/o0"]?.w.standard).toBe(1.7);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Night");
  });

  it("thickening the right wall to 0.50 m with the bed 0.10 m from its face in Night is refused naming the bed and Night (AC-25)", () => {
    const shell = FakeShell.withDocument(nightBedDoc());
    shell.click({ x: 6, y: 2 });
    shell.ui({ type: "setField", fieldId: "thickness", value: "0.50" });
    expect(Object.values(shell.doc().walls).every((w) => w.thickness === 0.2)).toBe(true);
    expect(shell.view().toast).toBe("Bed (0.00–1.00) overlaps a wall in Night");
  });

  it("a bed shows Use zones switches; switching Left off changes this layout only", () => {
    const shell = FakeShell.withDocument(bedTwo());
    shell.click({ x: 3, y: 2.9 });
    const sides = fields(shell.view()).filter((f) => f.id.startsWith("sides."));
    expect(sides.map((f) => [f.id, f.label, f.section, f.value, f.toggle, f.readOnly])).toEqual([
      ["sides.front", "Front", "Use zones", "false", true, false],
      ["sides.back", "Back", "Use zones", "false", true, false],
      ["sides.left", "Left", "Use zones", "true", true, false],
      ["sides.right", "Right", "Use zones", "true", true, false],
    ]);
    shell.ui({ type: "setField", fieldId: "sides.left", value: "false" });
    expect(shell.doc().placements["bed/p0"]?.sides.left).toBe(false);
    expect(shell.doc().placements["n/p0"]?.sides.left).toBe(true);
    expect(shell.state.undo.past).toHaveLength(1);
    const before = shell.doc();
    shell.ui({ type: "setField", fieldId: "sides.right", value: "maybe" }); // right is on: a lenient decode would turn it off
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(1);
  });

  it("a chair and a folded murphy bed show no zone switches; a murphy bed set to down shows all four", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 } },
      { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "murphyBed" }, at: { x: 3, y: 3.9 } },
    );
    const shell = FakeShell.withDocument(doc);
    const sideIds = () => fields(shell.view()).filter((f) => f.id.startsWith("sides.")).map((f) => f.id);
    shell.click({ x: 1, y: 0.8 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "chair/p0" }]);
    expect(sideIds()).toEqual([]);
    shell.click({ x: 3, y: 3.7 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "m/p0" }]);
    expect(sideIds()).toEqual([]);
    shell.ui({ type: "setField", fieldId: "config", value: "down" });
    expect(sideIds()).toEqual(["sides.front", "sides.back", "sides.left", "sides.right"]);
  });

  it("a built-in unit shows Kind \"Built-in unit\" and Opens into Table, Desk, Bed; picking Bed switches it, keeping name and sizes, in one undo step (AC-02)", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "u", state: "s0", object: { kind: "builtInTable", name: "Kitchen hideaway" }, at: { x: 3, y: 3.9 } },
      { type: "setObjectSize", objectId: "u/o0", w: 2.4, d: {} },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 3.7 });
    expect(fields(shell.view()).find((f) => f.id === "kind")?.value).toBe("Built-in unit");
    const opensInto = fields(shell.view()).find((f) => f.id === "opensInto");
    expect(opensInto?.value).toBe("builtInTable");
    expect(opensInto?.options).toEqual([
      { value: "builtInTable", label: "Table" },
      { value: "builtInDesk", label: "Desk" },
      { value: "murphyBed", label: "Bed" },
    ]);
    shell.ui({ type: "setField", fieldId: "opensInto", value: "murphyBed" });
    expect(shell.doc().objects["u/o0"]).toMatchObject({ kind: "murphyBed", name: "Kitchen hideaway", w: { folded: 2.4, down: 2.4 }, d: { folded: 0.35, down: 1.15 } });
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["u/o0"]?.kind).toBe("builtInTable");
  });

  it("a stored Murphy bed shows as a built-in unit set to Bed (AC-02)", () => {
    // A version 4 file written before this cycle: a Murphy bed placed folded, its placement without sides.
    const json = {
      ...serialize(roomDoc()),
      objects: { m: { id: "m", kind: "murphyBed", name: "Murphy bed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 } } },
      placements: { "m/s0": { id: "m/s0", object: "m", state: "s0", at: { x: 3, y: 3.9 }, rotation: 0, config: "folded" } },
    };
    expect(json.version).toBe(4);
    const shell = FakeShell.withDocument(unwrap(deserialize(json)));
    expect(shell.doc().objects["m"]).toMatchObject({ kind: "murphyBed", w: { folded: 1.6, down: 1.6 }, d: { folded: 0.4, down: 2.1 } });
    shell.click({ x: 3, y: 3.7 });
    expect(fields(shell.view()).find((f) => f.id === "kind")?.value).toBe("Built-in unit");
    expect(fields(shell.view()).find((f) => f.id === "opensInto")?.value).toBe("murphyBed");
    expect(fields(shell.view()).find((f) => f.id === "config")?.options?.map((o) => o.label)).toEqual(["Closed", "Open"]);
  });

  it("a bed shows no Opens into", () => {
    const shell = FakeShell.withDocument(studioDoc());
    shell.click({ x: 1.5, y: 2 });
    expect(fields(shell.view()).map((f) => f.id)).not.toContain("opensInto");
    expect(fields(shell.view()).find((f) => f.id === "kind")?.value).toBe("bed");
  });
});

// The Kind field (furnish.04, .17, AC-06): a drop-down of the piece's own kind and every kind it can switch to.
describe("the Kind field (AC-06)", () => {
  const field = (shell: FakeShell, id: string) => fields(shell.view()).find((f) => f.id === id);
  /** A wardrobe against the top face (x 2.4–3.6, y 3.3–3.9), left zone in Layout, back zone in its Night copy. */
  const wardrobeShell = () => {
    const shell = FakeShell.withDocument(withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "w", state: "s0", object: { kind: "wardrobe" }, at: { x: 3, y: 3.9 } },
      { type: "setZoneSides", placementId: "w/p0", sides: { front: false, back: false, left: true, right: false } },
      { type: "copyState", opId: "n", from: "s0", name: "Night" },
      { type: "setZoneSides", placementId: "n/p0", sides: { front: false, back: true, left: false, right: false } },
    ));
    shell.click({ x: 3, y: 3.6 });
    return shell;
  };

  it("a wardrobe's Kind is a drop-down of its own kind and every kind it can switch to, in catalogue order", () => {
    const kind = field(wardrobeShell(), "kind");
    expect(kind).toMatchObject({ value: "wardrobe", readOnly: false, select: true });
    expect(kind?.options?.map((o) => o.value)).toEqual(OBJECT_KINDS.filter((k) => k.id === "wardrobe" || canSwitchKind("wardrobe", k.id)).map((k) => k.id));
    expect(kind?.options).toEqual(expect.arrayContaining([{ value: "drawers", label: "Chest of drawers" }, { value: "wardrobe", label: "Wardrobe" }]));
    for (const id of ["sofaBed", "murphyBed", "builtInTable", "foldingTable", "extendingTable"]) expect(kind?.options?.map((o) => o.value)).not.toContain(id);
  });

  it("picking Chest of drawers switches in one undo step, keeps size and position, and resets sides in both layouts (AC-06)", () => {
    const shell = wardrobeShell();
    const before = shell.doc();
    shell.ui({ type: "setField", fieldId: "kind", value: "drawers" });
    expect(shell.doc().objects["w/o0"]).toMatchObject({ kind: "drawers", name: "Chest of drawers", w: { standard: 1.2 }, d: { standard: 0.6 } });
    for (const id of ["w/p0", "n/p0"]) {
      expect(shell.doc().placements[id]?.sides).toEqual({ front: true, back: false, left: false, right: false });
      expect(shell.doc().placements[id]?.at).toEqual(before.placements[id]?.at);
      expect(shell.doc().placements[id]?.rotation).toBe(before.placements[id]?.rotation);
    }
    expect(field(shell, "width")?.value).toBe("1.20");
    expect(field(shell, "depth")?.value).toBe("0.60");
    expect(field(shell, "preset")?.value).toBe("custom"); // the drawers' presets are 0.50 deep
    expect(shell.state.undo.past).toHaveLength(1);
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects).toEqual(before.objects);
    expect(shell.doc().placements).toEqual(before.placements);
  });

  it("a switch the predicate refuses sends nothing", () => {
    const shell = wardrobeShell();
    const before = shell.doc();
    for (const value of ["murphyBed", "sofaBed", "piano", "wardrobe"]) {
      shell.ui({ type: "setField", fieldId: "kind", value });
      expect(shell.doc(), value).toBe(before);
      expect(shell.state.undo.past, value).toHaveLength(0);
      expect(shell.view().toast, value).toBeNull();
    }
  });

  it("a sofa bed, a folding table and an extending table show their Kind read-only", () => {
    // The folded table (0.15 deep) stands in open floor: next to a wall, the wall wins the hit.
    const cases: [string, { x: number; y: number }, { x: number; y: number }, string][] = [
      ["sofaBed", { x: 3, y: 3.9 }, { x: 3, y: 3.5 }, "Sofa bed"],
      ["foldingTable", { x: 3, y: 2 }, { x: 3, y: 1.93 }, "Folding table"],
      ["extendingTable", { x: 3, y: 3.9 }, { x: 3, y: 3.3 }, "Extending table"],
    ];
    for (const [kind, at, click, label] of cases) {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "k", state: "s0", object: { kind }, at }));
      shell.click(click);
      const f = field(shell, "kind");
      expect(f, kind).toMatchObject({ value: label, readOnly: true });
      expect(f?.options, kind).toBeUndefined();
    }
  });
});

// Size presets (smart.11, .17, AC-08): a drop-down in Size; picking one is one setObjectSize carrying every depth.
describe("object presets (AC-08)", () => {
  const field = (shell: FakeShell, id: string) => fields(shell.view()).find((f) => f.id === id);
  /** A bed placed at its default (King 1.70 × 2.10), back edge at y 3 (y 0.9–3), selected. */
  const bedShell = () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: { x: 3, y: 3 } }));
    shell.click({ x: 3, y: 2 });
    return shell;
  };

  it("a bed shows Preset first in Size: a drop-down of its nine presets plus a disabled Custom, on King", () => {
    const shell = bedShell();
    const size = fields(shell.view()).filter((f) => f.section === "Size");
    expect(size.map((f) => f.id)).toEqual(["preset", "width", "depth"]);
    const preset = size[0];
    expect(preset).toMatchObject({ id: "preset", section: "Size", select: true, value: "King", readOnly: false });
    expect(preset?.options).toHaveLength(10);
    expect(preset?.options?.[5]).toEqual({ value: "King", label: "King 170 × 210" });
    expect(preset?.options?.at(-1)).toEqual({ value: "custom", label: "Custom", disabled: true });
  });

  it("picking Double then King 170 × 210 (AC-08)", () => {
    const shell = bedShell();
    const size = () => [shell.doc().objects["bed/o0"]?.w.standard, shell.doc().objects["bed/o0"]?.d.standard];
    shell.ui({ type: "setField", fieldId: "preset", value: "Double" });
    expect(size()).toEqual([1.5, 2.1]);
    expect(field(shell, "preset")?.value).toBe("Double");
    shell.ui({ type: "setField", fieldId: "preset", value: "King" });
    expect(size()).toEqual([1.7, 2.1]);
    expect(field(shell, "preset")?.value).toBe("King");
    shell.key("z", { ctrl: true });
    expect(size()).toEqual([1.5, 2.1]); // one undo step
    shell.key("z", { ctrl: true, shift: true });
    expect(size()).toEqual([1.7, 2.1]);
    shell.ui({ type: "setField", fieldId: "width", value: "1.71" });
    expect(field(shell, "preset")?.value).toBe("custom");
    shell.ui({ type: "setField", fieldId: "width", value: "1.703" }); // a snapped size that still matches
    expect(field(shell, "preset")?.value).toBe("King");
    expect(field(shell, "width")?.value).toBe("1.70");
    shell.ui({ type: "setField", fieldId: "width", value: "1.706" }); // rounds to 1.71
    expect(field(shell, "preset")?.value).toBe("custom");
    shell.ui({ type: "setField", fieldId: "width", value: "1.70" });
    expect(field(shell, "preset")?.value).toBe("King");
  });

  it("from Wall shelf, the Preset field's Bookcase and Standard come back to the floor at their own heights (AC-06)", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "sh", state: "s0", object: { kind: "shelf", preset: "Wall shelf" }, at: { x: 3, y: 3 } }));
    const sizes = () => {
      const o = shell.doc().objects["sh/o0"];
      return [o?.w.standard, o?.d.standard, o?.h.standard, o?.z.standard];
    };
    shell.click({ x: 3, y: 2.9 });
    expect(field(shell, "preset")?.value).toBe("Wall shelf");
    shell.ui({ type: "setField", fieldId: "preset", value: "Bookcase" });
    expect(sizes()).toEqual([0.8, 0.3, 2, 0]);
    expect(field(shell, "preset")?.value).toBe("Bookcase");
    shell.ui({ type: "setField", fieldId: "preset", value: "Wall shelf" });
    shell.ui({ type: "setField", fieldId: "preset", value: "Standard" });
    expect(sizes()).toEqual([0.8, 0.4, 1.5, 0]);
    expect(field(shell, "preset")?.value).toBe("Standard");
  });

  it("a preset sends every depth", () => {
    // A sofa bed at 2.10 whose bed depth is 1.80, seen as a sofa (back on the top wall's face, y 3.0–3.9).
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "sb", state: "s0", object: { kind: "sofaBed" }, at: { x: 3, y: 3.9 } },
      { type: "setObjectSize", objectId: "sb/o0", w: 2.1, d: { bed: 1.8 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 3.5 });
    expect(shell.doc().placements["sb/p0"]?.config).toBe("sofa");
    expect(field(shell, "preset")?.value).toBe("custom");
    shell.ui({ type: "setField", fieldId: "preset", value: "2 seats" });
    // An edit that sent only the current configuration's depth would leave bed 1.80.
    expect(shell.doc().objects["sb/o0"]).toMatchObject({ w: { sofa: 1.5, bed: 1.5 }, d: { sofa: 0.9, bed: 1.6 } });
    expect(field(shell, "preset")?.value).toBe("2 seats");
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["sb/o0"]).toMatchObject({ w: { sofa: 2.1, bed: 2.1 }, d: { sofa: 0.9, bed: 1.8 } });
  });

  it("a stored sofa bed with widths 2.00 and 1.80 shows Custom (AC-11)", () => {
    // Written directly, as an earlier version could store it: no size command makes the widths differ.
    const placed = withCommands(roomDoc(), { type: "placeObject", linked: false, deck: null, opId: "sb", state: "s0", object: { kind: "sofaBed" }, at: { x: 3, y: 3.9 } });
    const object = placed.objects["sb/o0"];
    if (!object) throw new Error("no sofa bed");
    const doc: Document = { ...placed, objects: { ...placed.objects, "sb/o0": { ...object, w: { sofa: 2, bed: 1.8 } } } };
    const props = objectFields(doc, "sb/p0");
    const preset = "fields" in props ? props.fields.find((f) => f.id === "preset") : undefined;
    expect(preset?.value).toBe("custom");
  });

  it("a preset with a height sets it in one edit; one without keeps the piece's height (catalog.07)", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "washingMachine" }, at: { x: 3, y: 3.9 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 3.6 });
    expect(field(shell, "preset")?.value).toBe("Washer");
    shell.ui({ type: "setField", fieldId: "preset", value: "Washer-dryer" });
    expect(shell.doc().objects["m/o0"]).toMatchObject({ w: { standard: 0.6 }, d: { standard: 0.6 }, h: { standard: 1.7 } });
    expect(field(shell, "preset")?.value).toBe("Washer-dryer");
    expect(field(shell, "height.standard")?.value).toBe("1.70");
    shell.key("z", { ctrl: true });
    expect(shell.doc().objects["m/o0"]?.h).toEqual({ standard: 0.85 });

    const bed = bedShell();
    bed.ui({ type: "setField", fieldId: "height.standard", value: "0.6" });
    bed.ui({ type: "setField", fieldId: "preset", value: "Double" });
    expect(bed.doc().objects["bed/o0"]).toMatchObject({ w: { standard: 1.5 }, h: { standard: 0.6 } });
    expect(field(bed, "preset")?.value).toBe("Double");
  });

  it("kinds without presets show no Preset field", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "chair", state: "s0", object: { kind: "chair" }, at: { x: 1, y: 1 } },
      { type: "placeObject", linked: false, deck: null, opId: "k", state: "s0", object: { kind: "kitchenBlock" }, at: { x: 3, y: 3.9 } },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 1, y: 0.8 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "chair/p0" }]);
    expect(field(shell, "preset")).toBeUndefined();
    shell.click({ x: 3, y: 3.6 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "k/p0" }]);
    expect(field(shell, "preset")).toBeUndefined();
  });

  it("every palette kind with presets, placed from the palette, shows its default preset (AC-08)", () => {
    const defaults: Readonly<Record<string, string>> = {
      bed: "King", mattress: "King", sofa: "3 seats", sofaBed: "3 seats", wardrobe: "120", drawers: "100", desk: "120",
      extendingTable: "4 seats", builtInTable: "120", builtInDesk: "100", murphyBed: "Double",
      washbasin: "60", vanityUnit: "100", showerTray: "80", cornerShower: "80", bathtub: "170",
      sinkUnit: "80", counter: "60", dishwasher: "60", roundTable: "90", tvUnit: "120", washingMachine: "Washer",
      coffeeTable: "100 × 50", hobUnit: "4 burners", fridge: "Tall", shelf: "Standard", toilet: "Wall-hung",
      liftBed: "King", loftBed: "Single", wallCabinet: "60", seatedDining: "4 seats", seatedRound: "4 seats", deskSet: "120",
      cornerDesk: "160 × 120", cornerWardrobe: "150 × 100", cornerCounter: "240 × 180", cornerSofa: "260 × 200", plant: "40", palm: "90", fern: "60", rosette: "40", radiator: "80", rug: "200", roundRug: "160", range: "60", cookerHood: "Chimney", tallPantry: "80", stool: "Bar", barTable: "120", bench: "Storage bench", storageChest: "80", electricFireplace: "100", wallUnit: "Mini-split head", woodStove: "Small", wheelWell: "Tandem", beam: "Beam",
      towelRail: "Medium", picture: "Poster", mirror: "Bathroom", clock: "30", wallTv: '55"', pegboard: "90", coatHooks: "90", coatStand: "45", glassCabinet: "80", halfGlassCabinet: "80",
    };
    const kinds = PALETTE_KINDS.flatMap((g) => g.cards).filter((k) => (kindOf(k.kind)?.presets.length ?? 0) > 0);
    expect(kinds.length).toBeGreaterThanOrEqual(9);
    for (const k of kinds) {
      const shell = FakeShell.withDocument(roomDoc());
      shell.ui({ type: "pickKind", kind: k.kind });
      shell.click({ x: 3, y: 2 });
      shell.key("Escape");
      shell.key("v");
      // An `L`'s centre may lie in its empty quarter (catalog.16): click its back arm instead, just inside the back.
      shell.click({ x: 3, y: kindOf(k.kind)?.outline === "ell" ? 2 + k.d / 2 - 0.05 : 2 });
      expect(Object.values(shell.doc().objects).map((o) => o.kind), k.kind).toEqual([k.kind]);
      expect(field(shell, "preset")?.value, k.kind).toBe(defaults[k.kind]);
    }
  });

  it("picking \"custom\" or an unknown id sends nothing", () => {
    const shell = bedShell();
    const before = shell.doc();
    shell.ui({ type: "setField", fieldId: "preset", value: "custom" });
    shell.ui({ type: "setField", fieldId: "preset", value: "Spaceship" });
    shell.ui({ type: "setField", fieldId: "preset", value: "3 seats" }); // a sofa's, not the bed's
    expect(shell.doc()).toBe(before);
    expect(shell.state.undo.past).toHaveLength(0);
  });

  it("a 2.40 built-in unit switched from Table to Bed shows Preset Custom (AC-02)", () => {
    const doc = withCommands(
      roomDoc(),
      { type: "placeObject", linked: false, deck: null, opId: "u", state: "s0", object: { kind: "builtInTable" }, at: { x: 3, y: 3.9 } },
      { type: "setObjectSize", objectId: "u/o0", w: 2.4, d: {} },
    );
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 3, y: 3.7 });
    shell.ui({ type: "setField", fieldId: "opensInto", value: "murphyBed" });
    expect(field(shell, "preset")?.value).toBe("custom");
    expect(shell.doc().objects["u/o0"]).toMatchObject({ w: { folded: 2.4, down: 2.4 }, d: { folded: 0.35, down: 1.15 } });
  });
});

describe("Stands on (spec \"The Deck tool and editing\", decks.11, .16; AC-04)", () => {
  const field = (shell: FakeShell, id: string) => fields(shell.view()).find((f) => f.id === id);
  // The 6 × 4 room (2.50 ceiling) with a loft (l/k0, top 2.15, underside 2.03) over its left end, x 0.1–2.1,
  // y 0.1–3.9, flush with three walls. Under it a mattress (m/p0) 1.40 × 2.00, 0.35 high, x 0.4–1.8, y 1.9–3.9 on the
  // floor, and a 1.00 m bed (b/p0) at x 0.4–1.8, y 0.1–1.9 under the loft too. A chair (c/p0) on free floor at (4, 2).
  const studio = (): Document =>
    withCommands(
      roomDoc(),
      { type: "addDeck", opId: "l", preset: "loft", at: { x: 1.1, y: 2 }, w: 2, d: 3.8 },
      { type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "bed", size: { w: 1.4, d: 2 } }, at: { x: 1.1, y: 3.9 } },
      { type: "setObjectSize", objectId: "m/o0", w: 1.4, d: { standard: 2 }, h: { standard: 0.35 } },
      { type: "placeObject", linked: false, deck: null, opId: "b", state: "s0", object: { kind: "bed", size: { w: 1.4, d: 1.8 } }, at: { x: 1.1, y: 1.9 } },
      { type: "placeObject", linked: false, deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 4, y: 2.225 } },
    );
  const selected = (at: { x: number; y: number }): FakeShell => {
    const shell = FakeShell.withDocument(studio());
    shell.click(at);
    return shell;
  };

  it("› Stands on lists Floor and the loft for a bed under the loft", () => {
    const shell = selected({ x: 1.1, y: 2.9 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "m/p0" }]);
    expect(field(shell, "standsOn")).toEqual({
      id: "standsOn", label: "Stands on", section: "Placement", value: "floor", unit: null, readOnly: false, select: true,
      options: [{ value: "floor", label: "Floor" }, { value: "l/k0", label: "Loft +2.15" }],
    });
    // It sits with the placement's other choices, before the angle.
    const ids = fields(shell.view()).map((f) => f.id);
    expect(ids.slice(ids.indexOf("config"), ids.indexOf("config") + 3)).toEqual(["config", "standsOn", "angle"]);
  });

  it("› choosing the loft puts the bed on it (range 2.15–2.50)", () => {
    const shell = selected({ x: 1.1, y: 2.9 });
    const before = shell.doc().placements["m/p0"];
    shell.ui({ type: "setField", fieldId: "standsOn", value: "l/k0" });
    expect(shell.view().toast).toBeNull();
    expect(shell.doc().placements["m/p0"]).toMatchObject({ deck: "l/k0", at: before?.at, rotation: before?.rotation });
    expect(placementRange(shell.doc(), "m/p0")).toEqual({ bottom: 2.15, top: 2.15 + 0.35 });
    expect(shell.state.undo.past).toHaveLength(1);
    // The floor level no longer offers it (shown.02): it is selected again at the loft, and goes back from there.
    expect(shell.state.selection).toEqual([]);
    shell.ui({ type: "setViewedLevel", deck: "l/k0" });
    shell.click({ x: 1.1, y: 2.9 });
    expect(field(shell, "standsOn")?.value).toBe("l/k0");
    shell.ui({ type: "setField", fieldId: "standsOn", value: "floor" });
    expect(shell.doc().placements["m/p0"]?.deck).toBeNull();
  });

  it("› choosing it where the bed doesn't fit toasts the refusal and keeps it on the floor", () => {
    const shell = selected({ x: 1.1, y: 1 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: "b/p0" }]);
    shell.ui({ type: "setField", fieldId: "standsOn", value: "l/k0" });
    expect(shell.view().toast).toBe("Bed reaches 3.15 m in Layout; the ceiling is 2.50 m");
    expect(shell.doc().placements["b/p0"]?.deck).toBeNull();
    expect(field(shell, "standsOn")?.value).toBe("floor");
  });

  it("› a piece under no deck lists only Floor", () => {
    const shell = selected({ x: 4, y: 2 });
    expect(field(shell, "standsOn")).toEqual({ id: "standsOn", label: "Stands on", section: "Placement", value: "Floor", unit: null, readOnly: true });
    shell.ui({ type: "setField", fieldId: "standsOn", value: "l/k0" }); // not offered: nothing is sent
    expect(shell.doc().placements["c/p0"]?.deck).toBeNull();
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
