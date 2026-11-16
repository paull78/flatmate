import { describe, expect, it } from "vitest";
import { CEILING_ID, motifDefaults, motifsFor } from "@fm/domain";
import type { Field } from "../../src/view/view-model-types";
import { roomDoc } from "../builders";
import { FakeShell } from "../fake-shell";

// The roof's Covering in Properties (surfaces step 11, AC-06): its own Roof section under the Ceiling's, only for a shed
// or a gable; its rows are a finish's, with the roof's motifs.

const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const fields = (shell: FakeShell): Field[] => shell.view().ceiling ?? [];
const roofRows = (shell: FakeShell): Field[] => fields(shell).filter((f) => f.section === "Roof");

describe("the roof's Covering (step 11)", () => {
  it("shows no Covering under a flat ceiling", () => {
    expect(roofRows(FakeShell.withDocument(roomDoc()))).toEqual([]);
  });

  it("shows Covering None under a shed, with the roof's motifs", () => {
    const s = FakeShell.withDocument(roomDoc());
    set(s, "ceiling.shape", "shed");
    const covering = roofRows(s).find((f) => f.id === "roof.covering");
    expect(covering?.value).toBe("none");
    expect(covering?.options?.map((o) => o.value)).toEqual(["none", ...motifsFor("roof")]);
  });

  it("picking Standing seam sets it on the ceiling row; its fields follow; None clears it", () => {
    const s = FakeShell.withDocument(roomDoc());
    set(s, "ceiling.shape", "gable");
    set(s, "roof.covering", "standingSeam");
    expect(s.doc().ceilings[CEILING_ID]?.covering).toEqual(motifDefaults("standingSeam"));
    expect(roofRows(s).find((f) => f.id === "roof.size")?.value).toBe("0.450");
    set(s, "roof.hex", "#33373b");
    expect(s.doc().ceilings[CEILING_ID]?.covering?.colour).toBe("#33373b");
    set(s, "roof.covering", "none");
    expect(s.doc().ceilings[CEILING_ID]?.covering).toBeUndefined();
  });
});
