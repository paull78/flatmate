import { describe, expect, it } from "vitest";
import { execute } from "../src/commands/execute";
import type { Command } from "../src/commands/types";
import { motifDefaults } from "../src/finishes";
import { CEILING_ID, type Document } from "../src/model";
import { deserialize, serialize } from "../src/serialize";
import { parseCeiling } from "../src/shape";
import { validateDocument } from "../src/validate";
import { rectDoc } from "./helpers";

// The roof's covering (surfaces step 11, AC-06): on the one ceiling row, set under a shed or gable, kept while flat.

const run = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, cmd) => {
  const r = execute(d, cmd);
  if (!r.ok) throw new Error(r.error.message);
  return r.value.doc;
}, doc);
const refusal = (doc: Document, cmd: Command): string => {
  const r = execute(doc, cmd);
  return r.ok ? "accepted" : r.error.message;
};
const seam = motifDefaults("standingSeam");
const gabled = (): Document => run(rectDoc(0, 0, 6, 4), { type: "setCeiling", shape: "gable" });

describe("the roof's covering (step 11, AC-06)", () => {
  it("a ceiling row without covering parses and round-trips; with one, too", () => {
    const doc = gabled();
    const row = doc.ceilings[CEILING_ID];
    expect(row && parseCeiling(row)).toEqual(row);
    const covered = run(doc, { type: "setRoofCovering", finish: seam });
    expect(covered.ceilings[CEILING_ID]?.covering).toEqual(seam);
    const back = deserialize(serialize(covered));
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.ceilings[CEILING_ID]).toEqual(covered.ceilings[CEILING_ID]);
  });

  it("sets standing seam under a gable, null clears it", () => {
    const covered = run(gabled(), { type: "setRoofCovering", finish: seam });
    expect(covered.ceilings[CEILING_ID]?.covering).toEqual(seam);
    const bare = run(covered, { type: "setRoofCovering", finish: null });
    expect(bare.ceilings[CEILING_ID] && "covering" in bare.ceilings[CEILING_ID]).toBe(false);
  });

  it("refuses under a flat ceiling, and a motif that isn't a roof's", () => {
    expect(refusal(rectDoc(0, 0, 6, 4), { type: "setRoofCovering", finish: seam })).toBe("A flat ceiling has no roof");
    expect(refusal(gabled(), { type: "setRoofCovering", finish: motifDefaults("brick") })).toMatch(/^finish.motif must be a roof motif: /);
  });

  it("gable → flat → gable keeps the covering", () => {
    const covered = run(gabled(), { type: "setRoofCovering", finish: seam });
    const flat = run(covered, { type: "setCeiling", shape: "flat" });
    expect(flat.ceilings[CEILING_ID]?.covering).toEqual(seam);
    expect(run(flat, { type: "setCeiling", shape: "gable" }).ceilings[CEILING_ID]?.covering).toEqual(seam);
    expect(run(covered, { type: "setCeiling", pitch: 30 }).ceilings[CEILING_ID]?.covering).toEqual(seam);
  });

  it("the validator refuses a stored covering that isn't a roof's", () => {
    const doc = gabled();
    const row = doc.ceilings[CEILING_ID];
    if (!row) throw new Error("no ceiling");
    const bad: Document = { ...doc, ceilings: { [CEILING_ID]: { ...row, covering: motifDefaults("brick") } } };
    const r = validateDocument(bad);
    expect(r.ok ? "" : r.error.map((v) => v.message).join()).toMatch(/covering.motif must be a roof motif/);
  });
});
