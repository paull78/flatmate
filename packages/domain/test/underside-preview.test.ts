import { describe, expect, it } from "vitest";
import { candidateShape, execute, footprintFit, unwrap, type Command, type Document } from "../src";
import { rectDoc } from "./helpers";

// A moving open stair previews with its underside (stairs.56, step 17): footprintFit given the moving stair says what
// execute says, so the Object tool's ghost and a drag agree with the commit.

const ok = (doc: Document, ...cmds: Command[]): Document => cmds.reduce((d, c) => unwrap(execute(d, c)).doc, doc);
/** A 6 × 4 room (inner faces x 0.1–5.9, y 0.1–3.9) under 3.20 with a loft over x 0.1–1.9, and a desk turned 90° with its back edge at (x, 2). */
const withDesk = (x: number): Document =>
  ok(rectDoc(0, 0, 6, 4), { type: "setCeiling", height: 3.2 }, { type: "addDeck", opId: "k", preset: "loft", at: { x: 1, y: 2 }, w: 1.8, d: 3.6 },
    { type: "placeObject", opId: "dk", state: "s0", object: { kind: "desk" }, at: { x, y: 2 }, rotation: 90, deck: null });
/** An open stair with its back edge on the loft's right edge (1.9, 2), rising toward −x. */
const STAIR = { kind: "openStair", at: { x: 1.9, y: 2 }, rotation: 90, w: 0.9, d: 2.99, riser: null };
const previews = (doc: Document): boolean => {
  const { ring, centre } = candidateShape(STAIR.kind, STAIR.at, STAIR.w, STAIR.d, STAIR.rotation);
  return footprintFit(doc, ring, "s0", { h: 2.15, z: 0 }, null, [], centre, STAIR).fits;
};
const commits = (doc: Document): boolean =>
  execute(doc, { type: "placeObject", opId: "st", state: "s0", object: { kind: "openStair" }, at: STAIR.at, rotation: STAIR.rotation, deck: null }).ok;

describe("footprintFit with a moving open stair", () => {
  it("over a desk under its high end: fits, as execute accepts", () => {
    const doc = withDesk(2.6); // the desk x 2.6–3.2: its low end 1.69 up the run, underside 1.06
    expect(commits(doc)).toBe(true);
    expect(previews(doc)).toBe(true);
  });

  it("over a desk near its bottom step: doesn't fit, as execute refuses", () => {
    const doc = withDesk(3.9); // x 3.9–4.5: 0.39 up the run, underside 0.21 under the desk's 0.75
    expect(commits(doc)).toBe(false);
    expect(previews(doc)).toBe(false);
  });

  it("without the moving stair the preview is the box and refuses the desk under the high end (the old preview)", () => {
    const doc = withDesk(2.6);
    const { ring, centre } = candidateShape(STAIR.kind, STAIR.at, STAIR.w, STAIR.d, STAIR.rotation);
    expect(footprintFit(doc, ring, "s0", { h: 2.15, z: 0 }, null, [], centre).fits).toBe(false);
  });
});
