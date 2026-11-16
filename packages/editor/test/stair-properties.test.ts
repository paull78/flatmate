import { describe, expect, it } from "vitest";
import { placementRange, type Command, type Document } from "@fm/domain";
import type { Field, ViewModel } from "../src/view/view-model-types";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A stair's Properties (stairs.15, .20, AC-11, AC-04): the Stair section replaces Size and Height; width and run
// editable, Reaches a picker of the decks and Nothing, the rise typed only when it reaches nothing, Fit run, then the
// derived numbers and the domain's checks, formatted with the one display format.

const fields = (vm: ViewModel): Field[] => ("fields" in vm.properties ? vm.properties.fields : []);
const field = (shell: FakeShell, id: string): Field | undefined => fields(shell.view()).find((f) => f.id === id);
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });

/** The 6 × 4 room under 3.20 with a hollow loft (l/k0, x 3.85–5.85, y 0.5–3.5, top 2.15). */
const loftRoom = (): Document =>
  withCommands(roomDoc(), { type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "l", preset: "loft", at: { x: 4.85, y: 2 }, w: 2, d: 3 });
/** A storage stair rising toward +x with its back edge's middle at (x, 2), reaching the loft: on its edge at x = 3.85. */
const stairAt = (x: number): Command => ({ type: "placeObject", opId: "st", state: "s0", object: { kind: "storageStair" }, at: { x, y: 2 }, rotation: 270, deck: null, reaches: "l/k0" });

/** The loft room with the stair, its run `run`, selected. */
function selectedStair(x = 3.85, run?: number): FakeShell {
  const cmds: Command[] = [stairAt(x), ...(run === undefined ? [] : [{ type: "setObjectSize", objectId: "st/o0", w: 0.6, d: { standard: run } } satisfies Command])];
  const shell = FakeShell.withDocument(withCommands(loftRoom(), ...cmds));
  shell.click({ x: x - 0.5, y: 2 });
  return shell;
}

describe("the Stair section (AC-11)", () => {
  it("replaces Size and Height: sections Object, Stair, Placement, Use zones", () => {
    const shell = selectedStair(3.85, 1.5);
    expect([...new Set(fields(shell.view()).map((f) => f.section))]).toEqual(["Object", "Stair", "Placement", "Use zones"]);
  });

  it("a storage stair to the loft with run 1.50: width and run editable, the rise read-only, then 10 risers of 0.215, going 0.167, slope 52.2°", () => {
    const shell = selectedStair(3.85, 1.5);
    const stair = fields(shell.view()).filter((f) => f.section === "Stair" && f.check === undefined);
    expect(stair.map((f) => [f.id, f.label, f.value, f.unit, f.readOnly])).toEqual([
      ["width", "Width", "0.60", "m", false],
      ["depth", "Run", "1.50", "m", false],
      ["reaches", "Reaches", "l/k0", null, false],
      ["rise", "Rise", "2.15", "m", true],
      ["fitRun", "Fit run", "1.99", "m", false],
      ["targetRiser", "Target riser", "", "m", false],
      ["risers", "Risers", "10 × 0.215", null, true],
      ["going", "Going", "0.167", "m", false],
      ["slope", "Slope", "52.2", "°", true],
      ["handrailLeft", "Left handrail", "railing", null, false],
      ["handrailRight", "Right handrail", "railing", null, false],
    ]);
    expect(field(shell, "fitRun")?.action).toBe(true);
  });

  it("the stair view formats the domain's checks with the one display format: ticks and warnings", () => {
    const shell = selectedStair(3.85, 1.5);
    const checks = fields(shell.view()).filter((f) => f.check !== undefined).map((f) => [f.id, f.value, f.check]);
    expect(checks).toEqual([
      ["check.riser", "Riser 0.215 m (0.178–0.305 wanted)", "ok"],
      ["check.going", "Going 0.167 m (0.221 wanted)", "warning"],
      ["check.width", "Width 0.60 m (0.51 wanted)", "ok"],
      ["check.headroom", "Headroom 1.27 m over the flight (1.88 wanted)", "warning"],
      ["check.reach", "Reaches the Loft", "ok"],
    ]);
  });

  it("Fit run sets the run to the kind's recommended going × treads: 9 × (0.508 − 4/3 × 0.215) = 1.992, width unchanged", () => {
    const shell = selectedStair(3.85, 1.5);
    set(shell, "fitRun", "");
    const stair = shell.doc().objects["st/o0"];
    expect(stair?.w.standard).toBe(0.6);
    expect(stair?.d.standard).toBeCloseTo(1.992, 6);
    expect(field(shell, "check.going")?.check).toBe("ok");
  });

  it("Reaches lists the decks and Nothing; picking Nothing clears the link and makes the rise editable", () => {
    const shell = selectedStair();
    expect(field(shell, "reaches")).toMatchObject({ select: true, options: [{ value: "l/k0", label: "Loft +2.15" }, { value: "nothing", label: "Nothing" }] });
    set(shell, "reaches", "nothing");
    expect(shell.doc().objects["st/o0"]?.reaches).toBeNull();
    expect(field(shell, "reaches")?.value).toBe("nothing");
    expect(field(shell, "rise")).toMatchObject({ value: "2.15", readOnly: false, step: 0.01 });
    expect(field(shell, "check.reach")).toBeUndefined();
    set(shell, "rise", "1.8");
    expect(placementRange(shell.doc(), "st/p0")).toEqual({ bottom: 0, top: 1.8 });
    expect(field(shell, "risers")?.value).toBe("8 × 0.225");
    set(shell, "reaches", "l/k0");
    expect(shell.doc().objects["st/o0"]?.reaches).toBe("l/k0");
  });

  it("the headroom warning shows its value: 3.20 − 9 × 0.215 = 1.265 over the flight, 1.88 wanted (AC-04)", () => {
    const shell = selectedStair();
    expect(field(shell, "check.headroom")).toMatchObject({ label: "Headroom", value: "Headroom 1.27 m over the flight (1.88 wanted)", check: "warning", readOnly: true });
  });

  it("moved off the loft's edge, it warns that it doesn't reach the Loft", () => {
    const shell = selectedStair();
    shell.command({ type: "movePlacement", placementId: "st/p0", at: { x: 3.5, y: 2 }, rotation: 270 });
    expect(field(shell, "check.reach")).toMatchObject({ value: "Doesn't reach the Loft", check: "warning" });
  });

  it("furniture keeps its Size and Height sections", () => {
    const shell = FakeShell.withDocument(withCommands(loftRoom(), { type: "placeObject", opId: "b", state: "s0", object: { kind: "block" }, at: { x: 1.5, y: 2 }, deck: null }));
    shell.click({ x: 1.5, y: 1.8 });
    const sections = new Set(fields(shell.view()).map((f) => f.section));
    expect([...sections]).toEqual(["Object", "Size", "Height", "Placement"]);
  });
});

describe("a spiral's Stair section (stairs.21, AC-09)", () => {
  /** A 1.60 spiral with its back edge's middle on the loft's edge at (3.85, 2), rising toward +x: x 2.25–3.85, y 1.2–2.8. */
  function selectedSpiral(): FakeShell {
    const shell = FakeShell.withDocument(withCommands(loftRoom(), { type: "placeObject", opId: "sp", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.85, y: 2 }, rotation: 270, deck: null, reaches: "l/k0" }));
    shell.click({ x: 2.6, y: 2.5 });
    return shell;
  }

  it("shows one Diameter field and the walking-line tread as its going; its checks pass but the headroom", () => {
    const shell = selectedSpiral();
    const stair = fields(shell.view()).filter((f) => f.section === "Stair" && f.check === undefined);
    expect(stair.map((f) => [f.id, f.label, f.value])).toEqual([
      ["width", "Diameter", "1.60"], ["reaches", "Reaches", "l/k0"], ["rise", "Rise", "2.15"], ["targetRiser", "Target riser", ""], ["risers", "Risers", "10 × 0.215"], ["going", "Going", "0.194"], ["handrail", "Handrail", "railing"],
    ]);
    const checks = fields(shell.view()).filter((f) => f.check !== undefined).map((f) => [f.id, f.check]);
    expect(checks).toEqual([["check.riser", "ok"], ["check.clearWidth", "ok"], ["check.walkingTread", "ok"], ["check.headroom", "warning"], ["check.reach", "ok"]]);
  });

  it("typing a diameter sets the width and the depth", () => {
    const shell = selectedSpiral();
    set(shell, "width", "1.4");
    const o = shell.doc().objects["sp/o0"];
    expect([o?.w.standard, o?.d.standard]).toEqual([1.4, 1.4]);
  });
});

describe("a typed riser and going (riser.10, AC-01, AC-02, AC-06)", () => {
  const stairShell = (kind = "stair", d = 2.5, w = 0.9): FakeShell => {
    const place: Command = { type: "placeObject", opId: "st", state: "s0", object: { kind, size: { w, d } }, at: { x: 3.85, y: 2 }, rotation: 90, deck: null, reaches: "l/k0" };
    // Rising toward +x means a back edge at the loft's near side: the stair runs from it toward −x.
    const shell = FakeShell.withDocument(withCommands(loftRoom(), { ...place, rotation: 270 }));
    shell.click({ x: 3.85 - d / 2, y: 2 });
    return shell;
  };

  it("shows an empty target with the kind's riser as its hint, and the actual numbers on one row", () => {
    const shell = stairShell();
    expect(field(shell, "targetRiser")).toMatchObject({ label: "Target riser", value: "", placeholder: "0.19", unit: "m", readOnly: false });
    expect(field(shell, "risers")).toMatchObject({ value: "12 × 0.179", readOnly: true });
    expect(field(shell, "riser")).toBeUndefined();
  });

  it("keeps what was typed in the target, and the actual riser on Risers", () => {
    const shell = stairShell();
    set(shell, "targetRiser", "0.16");
    expect(field(shell, "targetRiser")?.value).toBe("0.16");
    expect(field(shell, "risers")?.value).toBe("14 × 0.154");
    expect(shell.doc().objects["st/o0"]?.riser).toBe(0.16);
  });

  it("clears the target with a blank, and returns the kind's count", () => {
    const shell = stairShell();
    set(shell, "targetRiser", "0.16");
    set(shell, "targetRiser", "  ");
    expect(field(shell, "targetRiser")?.value).toBe("");
    expect(field(shell, "risers")?.value).toBe("12 × 0.179");
    expect(Object.keys(shell.doc().objects["st/o0"] ?? {})).not.toContain("riser");
  });

  it("refuses a bad target with a reason and changes nothing", () => {
    const shell = stairShell();
    const before = shell.doc();
    set(shell, "targetRiser", "0.05");
    expect(shell.doc()).toBe(before);
    expect(shell.state.toast?.text).toMatch(/riser must be between/i);
    set(shell, "targetRiser", "abc");
    expect(shell.doc()).toBe(before);
  });

  it("sets the run from a typed going, and the check updates", () => {
    const shell = stairShell();
    set(shell, "going", "0.2");
    expect(field(shell, "depth")?.value).toBe("2.20");
    expect(field(shell, "going")?.value).toBe("0.200");
    expect(field(shell, "check.going")?.check).toBe("warning");
  });

  it("names a rung ladder's target as spacing, and a spiral's going is read-only", () => {
    const ladder = stairShell("rungLadder", 0.6, 0.45);
    expect(field(ladder, "targetRiser")?.label).toBe("Target spacing");
    expect(field(ladder, "going")?.readOnly).toBe(false);
    const spiral = FakeShell.withDocument(withCommands(loftRoom(), { type: "placeObject", opId: "st", state: "s0", object: { kind: "spiralStair" }, at: { x: 3.85, y: 2 }, rotation: 270, deck: null, reaches: "l/k0" }));
    spiral.click({ x: 3, y: 2 });
    expect(field(spiral, "going")?.readOnly).toBe(true);
    expect(field(spiral, "targetRiser")?.readOnly).toBe(false);
  });
});
