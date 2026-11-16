import { describe, expect, it } from "vitest";
import { UNDERLAY_ID, holeView, type Command } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { helperLabelAt } from "../src/view/helper";
import { holeGapBoxes } from "../src/view/hole-gaps";
import { notchedCabinDoc, roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Typed values in the four value fields (spec typed-input): one rule for the keys, one parser, one hint.

type Field = {
  name: string;
  open(): FakeShell;
  /** A sum and a mixed value that fit this field, with what each commits. */
  sum: [string, number];
  mixed: [string, number];
  /** A length in feet and inches that fits this field, typed key by key, and what it commits (spec feet). */
  feet: [string, number];
  committed(shell: FakeShell): number;
};

const placeUnder: Command = { type: "placeUnderlay", pictureId: "pic-1", data: "/9j/4AAQSkZJRg-marker", width: 1000, height: 700, at: { x: -1.37, y: 4.21 } };

const FIELDS: Field[] = [
  {
    name: "the Wall tool's length",
    open() {
      const shell = FakeShell.local();
      shell.key("w");
      shell.click({ x: 0, y: 0 });
      shell.moveTo({ x: 1, y: 0.1 }, { shift: true });
      return shell;
    },
    sum: ["2 + 3", 5],
    mixed: ["3m-60cm", 2.4],
    feet: ["8'6\"", 2.5908],
    committed: (shell) => {
      const t = shell.state.tool;
      return t.name === "wall" && t.state.kind === "drawing" ? t.state.origin.x : Number.NaN;
    },
  },
  {
    name: "a helper's value",
    open() {
      const shell = FakeShell.withDocument(roomDoc());
      const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
      shell.click({ x: 6, y: 1 });
      const at = helperLabelAt(shell.doc(), right, shell.state.camera);
      if (!at) throw new Error("no helper");
      shell.click(at);
      return shell;
    },
    sum: ["2 + 3", 5],
    mixed: ["3m-60cm", 2.4],
    feet: ["8'6\"", 2.5908],
    committed: (shell) => {
      const annotations = shell.scene().layers.find((l) => l.name === "annotations")?.primitives ?? [];
      const clear = annotations.flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []))[0];
      return Number(clear); // the helper reads the clear length (ux-polish.35)
    },
  },
  {
    name: "a hole's gap",
    open() {
      const doc = withCommands(notchedCabinDoc(), { type: "addDeckHole", opId: "mid", deck: "loft/k0", at: { x: 0.9, y: 1.3 }, w: 0.6, d: 0.6 });
      const shell = FakeShell.withDocument(doc);
      shell.click({ x: 0.9, y: 1.3 });
      const box = holeGapBoxes(shell.state, shell.doc()).find((b) => b.side === "left");
      if (!box) throw new Error("no gap");
      shell.click(box.at);
      return shell;
    },
    sum: ["0.2 + 0.3", 0.5],
    mixed: ["1m-60cm", 0.4],
    feet: ["6\"", 0.1524],
    committed: (shell) => {
      const hole = holeView(shell.doc(), "mid/h0")?.hole;
      return hole ? hole.at.x - hole.w / 2 - 0.1 : Number.NaN; // the Loft's west edge is x 0.10
    },
  },
  {
    name: "the Scale tool's distance",
    open() {
      const shell = FakeShell.withDocument(withCommands(roomDoc(), placeUnder));
      shell.state = { ...shell.state, camera: { ...shell.state.camera, zoom: 113, center: { x: 0.9, y: 1.6 } } };
      shell.ui({ type: "pickTool", tool: "scale" });
      shell.click({ x: -0.065, y: 3.4375 });
      shell.click({ x: 2.335, y: 0.2375 });
      return shell;
    },
    sum: ["2 + 3", 5],
    mixed: ["3m-60cm", 2.4],
    feet: ["34'", 10.3632], // a benchmark house's length (AC-07)
    committed: (shell) => (shell.doc().underlays[UNDERLAY_ID]?.metresPerPixel ?? Number.NaN) * 400, // A to B is 400 px
  },
];

const value = (shell: FakeShell): string => shell.view().commandBar.value;

describe.each(FIELDS)("$name", (field) => {
  it("a sum with spaces commits on Enter, and only on Enter (AC-02)", () => {
    const shell = field.open();
    const before = shell.doc();
    shell.type(field.sum[0]);
    expect(shell.doc()).toBe(before); // Space committed nothing on the way
    expect(shell.view().commandBar.value).toContain(`${field.sum[0]} = `);
    shell.key("Enter");
    expect(shell.view().toast).toBeNull();
    expect(field.committed(shell)).toBeCloseTo(field.sum[1], 3);
  });

  it("a value with units commits what it reads (AC-08)", () => {
    const shell = field.open();
    shell.type(field.mixed[0]);
    shell.key("Enter");
    expect(shell.view().toast).toBeNull();
    expect(field.committed(shell)).toBeCloseTo(field.mixed[1], 3);
  });

  it("a length in feet and inches shows its metres in the hint and commits them (spec feet, AC-07)", () => {
    const shell = field.open();
    shell.type(field.feet[0]);
    expect(value(shell)).toMatch(new RegExp(`^${field.feet[0]} = \\d`));
    expect(shell.view().commandBar.unit).toBe("m");
    shell.key("Enter");
    expect(shell.view().toast).toBeNull();
    expect(field.committed(shell)).toBeCloseTo(field.feet[1], 2); // a helper reads back from its label, in centimetres
  });

  it("8'6 typed with Shift held reads 8 ft 6 in, the foot mark arriving as ' (spec feet, AC-05)", () => {
    const shell = field.open();
    for (const key of ["8", "'", "6"]) shell.key(key, { shift: true });
    expect(value(shell)).toBe("8'6 = 2.591");
  });

  it.each(["'", '"', "f", "t", "i", "n"])("%s with nothing typed changes nothing (spec feet, AC-06)", (key) => {
    const shell = field.open();
    const tool = shell.state.tool;
    const doc = shell.doc();
    shell.key(key);
    expect(shell.state.tool).toEqual(tool);
    expect(shell.doc()).toBe(doc);
    expect(value(shell)).toBe("");
  });

  it("Space on an empty value does nothing (AC-02)", () => {
    const shell = field.open();
    const before = shell.state.tool;
    const doc = shell.doc();
    shell.key(" ");
    expect(shell.state.tool).toEqual(before);
    expect(shell.doc()).toBe(doc);
    expect(value(shell)).toBe("");
  });

  it.each([["2.80-"], ["3m 60cm"], ["2 3"]])("%s Enter is refused, keeps the value and sends no command (AC-03, AC-06)", (text) => {
    const shell = field.open();
    const doc = shell.doc();
    const tool = shell.state.tool.name;
    shell.type(text);
    shell.key("Enter");
    expect(shell.view().toast).toBe(`Can't read ${text}`);
    expect(shell.doc()).toBe(doc);
    expect(shell.state.tool.name).toBe(tool);
    expect(value(shell)).toBe(text);
    expect(shell.view().commandBar.unit).toBeNull();
  });

  it("the hint shows the result once the value can be read (AC-06)", () => {
    const shell = field.open();
    shell.type("0.8");
    expect(shell.view().commandBar).toMatchObject({ value: "0.8", unit: "m" });
    shell.type("-");
    expect(shell.view().commandBar).toMatchObject({ value: "0.8-", unit: null });
    shell.type("0.3");
    expect(shell.view().commandBar).toMatchObject({ value: "0.8-0.3 = 0.50", unit: "m" });
    for (let i = 0; i < 3; i += 1) shell.key("Backspace");
    expect(shell.view().commandBar).toMatchObject({ value: "0.8-", unit: null });
  });

  it("M and C with nothing typed, or after an operator, pick their tools (AC-05)", () => {
    for (const [key, tool] of [["M", "dimension"], ["m", "dimension"], ["C", "column"], ["c", "column"]] as const) {
      const empty = field.open();
      empty.key(key);
      expect(empty.view().activeTool, key).toBe(tool);
      const operator = field.open();
      operator.type("2+");
      operator.key(key);
      expect(operator.view().activeTool, `2+${key}`).toBe(tool);
    }
  });

  it("M and C after a digit type a unit, with Shift held too (AC-05)", () => {
    const shell = field.open();
    const tool = shell.view().activeTool;
    shell.type("2");
    shell.key("M", { shift: true });
    expect(shell.view().activeTool).toBe(tool);
    expect(value(shell)).toBe("2m = 2.00");
    const cm = field.open();
    cm.type("20");
    cm.key("C", { shift: true });
    cm.key("M", { shift: true });
    expect(value(cm)).toBe("20cm = 0.20");
    const mm = field.open();
    mm.type("25 mm");
    expect(value(mm)).toBe("25 mm = 0.025");
    expect(mm.view().activeTool).toBe(tool);
  });

  it.each([["V", "select"], ["W", "wall"], ["Z", "zone"], ["O", "object"], ["D", "opening"], ["K", "deck"]])("%s still picks %s, with or without a value (AC-05)", (key, tool) => {
    const shell = field.open();
    shell.type("2");
    shell.key(key);
    expect(shell.view().activeTool).toBe(tool);
    const empty = field.open();
    empty.key(key);
    expect(empty.view().activeTool).toBe(tool);
  });

  it("Cmd and Ctrl chords never type (browser zoom, copy)", () => {
    const shell = field.open();
    shell.type("2");
    shell.key("-", { meta: true });
    shell.key("+", { ctrl: true });
    shell.key("c", { ctrl: true });
    shell.key("3", { meta: true });
    expect(value(shell)).toBe("2");
  });
});

describe("the Wall tool's chain", () => {
  it("Space on an empty value leaves the chain drawing, and Enter still ends it (AC-02)", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.key(" ");
    const t = shell.state.tool;
    expect(t.name === "wall" ? t.state.kind : null).toBe("drawing");
    shell.key("Enter");
    const after = shell.state.tool;
    expect(after.name === "wall" ? after.state.kind : null).toBe("idle");
  });

  it("zero and negative values keep the field's own refusal", () => {
    const shell = FakeShell.local();
    shell.key("w");
    shell.click({ x: 0, y: 0 });
    shell.moveTo({ x: 1, y: 0 });
    shell.type("1-1");
    shell.key("Enter");
    expect(shell.view().toast).toBe("Type a length in metres");
  });
});
