import { describe, expect, it } from "vitest";
import { MESSAGES, motifDefaults, type Command, type Document } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { labelledDoc, notchedCabinDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Sums and units in Properties (spec typed-input, AC-07): a number field's value is read in one place by its unit.

const place = (opId: string, kind: string, x: number, y: number): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y } });
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const fields = (shell: FakeShell): Field[] => {
  const p = shell.view().properties;
  return "fields" in p ? p.fields : [];
};
const field = (shell: FakeShell, id: string): string | undefined => fields(shell).find((f) => f.id === id)?.value;

function selected(doc: Document, at: { x: number; y: number }): FakeShell {
  const shell = FakeShell.withDocument(doc);
  shell.click(at);
  return shell;
}

const desk = (): FakeShell => selected(withCommands(roomDoc(), place("a", "desk", 3, 3.9)), { x: 3, y: 3.6 });

describe("a piece's fields", () => {
  it.each([
    ["1.90-0.60", "1.30"],
    ["60cm", "0.60"],
    ["1,30", "1.30"],
    ["1m+30cm", "1.30"],
    ["(1+1)/2", "1.00"],
    ["800mm", "0.80"],
    ["2 × 0.5", "1.00"],
  ])("Width %s reads %s, in one undo step", (typed, shown) => {
    const shell = desk();
    const past = shell.state.undo.past.length;
    set(shell, "width", typed);
    expect(shell.view().toast).toBeNull();
    expect(field(shell, "width")).toBe(shown);
    expect(shell.state.undo.past.length).toBe(past + 1);
  });

  it("Width takes feet and inches, shown in metres (spec feet, AC-07)", () => {
    const shell = desk();
    set(shell, "width", "2'6\"");
    expect(shell.view().toast).toBeNull();
    expect(field(shell, "width")).toBe("0.76");
  });

  it("Angle refuses feet and inches as it refuses any unit (spec feet, AC-04)", () => {
    const shell = desk();
    const doc = shell.doc();
    for (const typed of ["6'", "6\"", "6ft"]) {
      set(shell, "angle", typed);
      expect(shell.view().toast).toBe(`Can't read ${typed}`);
      expect(shell.doc()).toBe(doc);
    }
  });

  it("Angle takes a sum and refuses a unit", () => {
    const shell = selected(withCommands(roomDoc(), place("a", "desk", 3, 3)), { x: 3, y: 2.7 }); // room to turn
    set(shell, "angle", "90+45");
    expect(field(shell, "angle")).toBe("135");
    const doc = shell.doc();
    set(shell, "angle", "45cm");
    expect(shell.view().toast).toBe("Can't read 45cm");
    expect(shell.doc()).toBe(doc);
  });

  it("an angle that isn't whole has a refusal of its own", () => {
    const shell = desk();
    const doc = shell.doc();
    set(shell, "angle", "45/2");
    expect(shell.view().toast).toBe("Type a whole number of degrees");
    expect(shell.doc()).toBe(doc);
  });

  it("an unreadable value toasts and changes nothing; a blank keeps its toast", () => {
    const shell = desk();
    const doc = shell.doc();
    set(shell, "width", "2.8-");
    expect(shell.view().toast).toBe("Can't read 2.8-");
    expect(shell.doc()).toBe(doc);
    set(shell, "width", " ");
    expect(shell.view().toast).toBe("Enter a number");
    expect(shell.doc()).toBe(doc);
  });

  it("the name is text, whatever it looks like", () => {
    const shell = desk();
    set(shell, "name", "2+3");
    expect(field(shell, "name")).toBe("2+3");
    expect(shell.view().toast).toBeNull();
  });

  it("a stepper's plain number passes through", () => {
    const shell = desk();
    set(shell, "width", "1.21");
    expect(field(shell, "width")).toBe("1.21");
  });
});

describe("other number fields", () => {
  it("a wall's thickness and top take units", () => {
    const shell = selected(roomDoc(), { x: 6, y: 1 });
    set(shell, "thickness", "30cm");
    expect(field(shell, "thickness")).toBe("0.30");
    set(shell, "thickness", "abc");
    expect(shell.view().toast).toBe("Can't read abc");
    set(shell, "thickness", "1m");
    expect(shell.view().toast).toBe(MESSAGES.thickness);
  });

  it("a deck's top takes a sum, its rotation takes one and refuses a unit", () => {
    const shell = selected(withCommands(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 3, y: 2 } }), { x: 2.5, y: 1.8 });
    set(shell, "top", "40cm+5cm+5cm");
    expect(field(shell, "top")).toBe("0.50");
    set(shell, "rotation", "10+5");
    expect(field(shell, "rotation")).toBe("15");
    set(shell, "rotation", "15cm");
    expect(shell.view().toast).toBe("Can't read 15cm");
  });

  it("the ceiling, with nothing selected, takes a unit", () => {
    const shell = FakeShell.withDocument(roomDoc());
    set(shell, "ceiling.height", "270cm");
    expect(shell.view().ceiling?.find((f) => f.id === "ceiling.height")?.value).toBe("2.70");
  });

  it("a finish's whole-millimetre size survives a sum's float noise; Strength refuses a unit", () => {
    const shell = FakeShell.withDocument(withCommands(labelledDoc(), { type: "setFinish", id: "L1", finish: motifDefaults("planks") }));
    shell.state = { ...shell.state, selection: [{ table: "zoneLabels", id: "L1" }] };
    if (field(shell, "size") === undefined) throw new Error("no finish selected");
    set(shell, "size", "0.1+0.2");
    expect(shell.view().toast).toBeNull();
    expect(field(shell, "size")).toBe("0.300");
    set(shell, "strength", "50cm");
    expect(shell.view().toast).toBe("Can't read 50cm");
  });
});

describe("the guard", () => {
  // Every field a value is typed into must be a numberField, or setField wouldn't read its sums.
  const TEXT_FIELDS = new Set(["name", "hex"]);

  it("every typed field that isn't plain text is a number field", () => {
    const hole: Command = { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 0.9, y: 1.3 }, w: 0.6, d: 0.6 };
    const cases: [Document, { x: number; y: number }][] = [
      [roomDoc(), { x: 6, y: 1 }],
      [withCommands(roomDoc(), place("a", "desk", 3, 3.9)), { x: 3, y: 3.6 }],
      [withCommands(notchedCabinDoc(), hole), { x: 0.9, y: 1.3 }],
      [withCommands(roomDoc(), { type: "addSection", a: { x: 1, y: 2 }, b: { x: 5, y: 2 }, side: 1 }), { x: 3, y: 2 }],
    ];
    let seen = 0;
    for (const [doc, at] of cases) {
      const shell = selected(doc, at);
      for (const f of fields(shell)) {
        if (f.readOnly || f.action === true || f.options !== undefined || f.select === true || TEXT_FIELDS.has(f.id) || f.value === "true" || f.value === "false") continue;
        expect(f.step, f.id).toBeDefined();
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe("the floating bar's fields (AC-09)", () => {
  const thickness = (shell: FakeShell) => shell.view().wallThickness;
  const column = (shell: FakeShell) => shell.view().columnSize;

  it.each([["30cm", "0.30"], ["0,20", "0.20"], ["0.2+0.1", "0.30"], ["100mm", "0.10"], ["4\"", "0.10"], ["1'", "0.30"]])("wall thickness %s reads %s", (typed, shown) => {
    const shell = FakeShell.local();
    shell.ui({ type: "setWallThickness", value: typed });
    expect(shell.view().toast).toBeNull();
    expect(thickness(shell)).toBe(shown);
  });

  it("wall thickness: unreadable text and a blank keep the setting and toast; out of range keeps its message", () => {
    const shell = FakeShell.local();
    shell.ui({ type: "setWallThickness", value: "2.8-" });
    expect(shell.view().toast).toBe("Can't read 2.8-");
    shell.ui({ type: "setWallThickness", value: "" });
    expect(shell.view().toast).toBe("Enter a number");
    shell.ui({ type: "setWallThickness", value: "1m" });
    expect(shell.view().toast).toBe(MESSAGES.thickness);
    expect(thickness(shell)).toBe("0.20");
  });

  it.each([["30cm", "0.30"], ["0,40", "0.40"], ["0.2+0.1", "0.30"], ["1'", "0.30"], ["16in", "0.41"]])("column width and depth %s read %s", (typed, shown) => {
    const shell = FakeShell.local();
    shell.ui({ type: "setColumnSize", width: typed });
    expect(column(shell).width).toBe(shown);
    shell.ui({ type: "setColumnSize", depth: typed });
    expect(column(shell).depth).toBe(shown);
  });

  it("column size: unreadable text keeps the size and toasts", () => {
    const shell = FakeShell.local();
    const before = column(shell);
    shell.ui({ type: "setColumnSize", depth: "2.8-" });
    expect(shell.view().toast).toBe("Can't read 2.8-");
    expect(column(shell)).toEqual(before);
    shell.ui({ type: "setColumnSize", width: " " });
    expect(shell.view().toast).toBe("Enter a number");
  });
});
