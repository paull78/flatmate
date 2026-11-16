import { describe, expect, it } from "vitest";
import { motifDefaults, outsideOf } from "@fm/domain";
import { buildViewModel } from "../../src/view/view-model";
import type { Field } from "../../src/view/view-model-types";
import { labelledDoc, loftWallDoc, withCommands } from "../builders";
import { FakeHost, FakeShell } from "../fake-shell";

// The Outside walls section (inherit step 06, AC-08, inherit.03): with nothing selected, the house's outside walls
// default, Finish and Lower as compact rows, and a note counting the sides facing outside and the custom ones.

const host = new FakeHost();
const outside = (shell: FakeShell): Field[] => buildViewModel(shell.state, host).outside ?? [];
const byId = (fields: readonly Field[], id: string): Field | undefined => fields.find((f) => f.id === id);
const navy = { ...motifDefaults("plain"), colour: "#2f3e57" };

describe("the Outside walls section (step 06, AC-08)", () => {
  it("shows with nothing selected: Finish and Lower rows and the count, in its own section", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    const fields = outside(shell);
    expect(byId(fields, "row:outside.finish")?.value).toBe("None");
    expect(byId(fields, "row:outside.lower.motif")?.value).toBe("None");
    expect(byId(fields, "outside.note")?.value).toBe("Every side facing outside (6) shows these");
    expect(new Set(fields.map((f) => f.section))).toEqual(new Set(["Outside walls"]));
  });

  it("is gone while something is selected", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.click({ x: 1, y: 3 });
    expect(buildViewModel(shell.state, host).outside).toBeNull();
  });

  it("setting it sends setOutsideFinish, one undo step; a band's height edits it", () => {
    const shell = FakeShell.withDocument(labelledDoc());
    shell.ui({ type: "setField", fieldId: "outside.finish", value: "boardAndBatten" });
    expect(outsideOf(shell.doc())?.finish).toEqual(motifDefaults("boardAndBatten"));
    shell.ui({ type: "setField", fieldId: "outside.lower.motif", value: "brick" });
    shell.ui({ type: "setField", fieldId: "outside.lower.height", value: "60cm" });
    expect(outsideOf(shell.doc())?.lower).toEqual({ finish: motifDefaults("brick"), height: 0.6 });
    expect(byId(outside(shell), "row:outside.lower.motif")?.value).toMatch(/to 0\.60 m$/);
    shell.key("z", { ctrl: true });
    expect(outsideOf(shell.doc())?.lower?.height).toBe(1.2);
  });

  it("counts the custom sides facing outside, not the ones facing a room", () => {
    const doc = labelledDoc();
    const west = Object.keys(doc.walls).find((id) => {
      const w = doc.walls[id];
      return w && doc.joints[w.a]?.x === 0 && doc.joints[w.b]?.x === 0;
    }) ?? "";
    const both = withCommands(doc, { type: "setWallSide", wallId: west, side: "left", finish: navy, lower: null }, { type: "setWallSide", wallId: west, side: "right", finish: navy, lower: null });
    const shell = FakeShell.withDocument(both);
    expect(byId(outside(shell), "outside.note")?.value).toBe("Every side facing outside (6) shows these, but 1 custom");
  });
});

describe("a wall on a loft faces no outside (cycle home, AC-13)", () => {
  it("the count is the same with and without the loft wall", () => {
    const note = (shell: FakeShell): string | undefined => byId(outside(shell), "outside.note")?.value;
    expect(note(FakeShell.withDocument(labelledDoc()))).toBe("Every side facing outside (6) shows these");
    expect(note(FakeShell.withDocument(loftWallDoc()))).toBe("Every side facing outside (6) shows these");
  });
});
