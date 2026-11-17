import { describe, expect, it } from "vitest";
import { highSide, roofOf, type Document } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// The Ceiling section with a roof (roofs.03, .04, .14, .15; AC-02, AC-11). roomDoc is a 6 × 4 room of 0.20 m walls on
// centrelines 0–6 and 0–4: an outer box of 6.20 × 4.20.

const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const fields = (shell: FakeShell): Field[] => shell.view().ceiling ?? [];
const byId = (shell: FakeShell, id: string): Field | undefined => fields(shell).find((f) => f.id === id);
const rows = (shell: FakeShell): [string, string, string][] => fields(shell).filter((f) => f.section !== "Roof").map((f) => [f.id, f.label, f.value]); // the Ceiling section (surfaces step 11 adds Roof)
const shell = (): FakeShell => FakeShell.withDocument(roomDoc());
const doc = (s: FakeShell): Document => s.doc();

describe("the Ceiling section, flat", () => {
  it("shows the preset, the shape and the height, with Shed and Gable enabled", () => {
    const s = shell();
    expect(rows(s)).toEqual([["ceiling.preset", "Preset", "custom"], ["ceiling.shape", "Shape", "flat"], ["ceiling.height", "Height", "2.50"]]);
    expect(byId(s, "ceiling.shape")?.options).toEqual([{ value: "flat", label: "Flat" }, { value: "shed", label: "Shed" }, { value: "gable", label: "Gable" }]);
    expect(byId(s, "ceiling.preset")?.options?.map((o) => o.label)).toEqual(["Tiny house shed", "Tiny house gable", "Small home shed", "Small home gable", "Custom"]);
  });
});

describe("the pressed Flat button on a ceiling never shaped (knownbugs AC-05)", () => {
  it("changes nothing and adds no undo step, so a first Shed still falls across the short span", () => {
    const s = shell();
    const before = doc(s);
    set(s, "ceiling.shape", "flat");
    expect(doc(s).ceilings).toEqual(before.ceilings);
    expect(s.view().canUndo).toBe(false);
    set(s, "ceiling.shape", "shed");
    expect(roofOf(doc(s)).falls).toBe("-y"); // the 6.20 × 4.20 box is shorter along y
  });
});

describe("a shed", () => {
  it("shows Low side, Low wall, Pitch with its other units, High wall and Overhang", () => {
    const s = shell();
    set(s, "ceiling.shape", "shed");
    expect(rows(s)).toEqual([
      ["ceiling.preset", "Preset", "smallShed"], // 2.50 at 10° is the Small home shed
      ["ceiling.shape", "Shape", "shed"],
      ["ceiling.falls", "Low side", "-y"],
      ["ceiling.height", "Low wall", "2.50"],
      ["ceiling.pitch", "Pitch", "10.0"],
      ["ceiling.pitchAs", "", "17.6% · 2.1/12"],
      ["ceiling.highSide", "High wall", "3.24"],
      ["ceiling.overhang", "Overhang", "0.30"],
    ]);
    expect(byId(s, "ceiling.falls")?.options).toEqual([{ value: "-y", label: "Bottom" }, { value: "+y", label: "Top" }, { value: "-x", label: "Left" }, { value: "+x", label: "Right" }]);
    expect(byId(s, "ceiling.pitchAs")?.readOnly).toBe(true);
  });

  it("typing each field follows the edit rule (AC-02)", () => {
    const s = shell();
    set(s, "ceiling.shape", "shed");
    set(s, "ceiling.pitch", "12");
    expect(roofOf(doc(s))).toMatchObject({ height: 2.5, pitch: 12 });
    set(s, "ceiling.highSide", "3.4");
    expect(roofOf(doc(s)).height).toBe(2.5);
    expect(highSide(doc(s))).toBe(3.4);
    set(s, "ceiling.height", "2.6");
    expect(highSide(doc(s))).toBe(3.5);
    set(s, "ceiling.falls", "+x");
    expect(roofOf(doc(s)).falls).toBe("+x");
    set(s, "ceiling.overhang", "0");
    expect(roofOf(doc(s)).overhang).toBe(0);
  });

  it("a preset sets the shape, the low side and the pitch, and shows as picked", () => {
    const s = shell();
    set(s, "ceiling.preset", "tinyShed");
    expect(roofOf(doc(s))).toMatchObject({ shape: "shed", height: 2.75, pitch: 10 });
    expect(byId(s, "ceiling.preset")?.value).toBe("tinyShed");
    set(s, "ceiling.pitch", "11");
    expect(byId(s, "ceiling.preset")?.value).toBe("custom");
  });

  it("refuses a pitch over 60° with the domain's text", () => {
    const s = shell();
    set(s, "ceiling.shape", "shed");
    set(s, "ceiling.pitch", "61");
    expect(s.view().toast).toBe("The pitch must be between 1° and 60°");
  });
});

describe("a gable", () => {
  it("shows Ridge along, Eaves and Ridge, with the length and width of the box", () => {
    const s = shell();
    set(s, "ceiling.preset", "smallGable");
    expect(rows(s).map(([id, label]) => [id, label])).toEqual([
      ["ceiling.preset", "Preset"], ["ceiling.shape", "Shape"], ["ceiling.ridge", "Ridge along"], ["ceiling.height", "Eaves"],
      ["ceiling.pitch", "Pitch"], ["ceiling.pitchAs", ""], ["ceiling.highSide", "Ridge"], ["ceiling.overhang", "Overhang"],
    ]);
    expect(byId(s, "ceiling.ridge")?.options).toEqual([{ value: "x", label: "Length" }, { value: "y", label: "Width" }]);
    expect(byId(s, "ceiling.ridge")?.value).toBe("x");
    set(s, "ceiling.ridge", "y");
    expect(roofOf(doc(s)).falls).toBe("-x");
    set(s, "ceiling.ridge", "y"); // already across x: kept
    expect(roofOf(doc(s)).falls).toBe("-x");
  });
});
