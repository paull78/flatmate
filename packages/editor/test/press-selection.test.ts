import { describe, expect, it } from "vitest";
import type { EntityRef } from "@fm/domain";
import { pressSelection } from "../src/tools/press-selection";

const W: EntityRef = { table: "walls", id: "w" };
const J: EntityRef = { table: "joints", id: "j" };
const piece = (id: string): EntityRef => ({ table: "placements", id });
const [P1, P2, P3] = [piece("p1"), piece("p2"), piece("p3")];

// The selection a press sets now, and the one a click (a release without a drag) sets (direct.02, direct.07, direct.19).
describe("pressSelection", () => {
  it("a handle hit keeps the selection; a click on a wall's joint handle selects that joint (straight.42), a grip's selects nothing", () => {
    expect(pressSelection([W], { ref: J, handle: { kind: "joint", jointId: "j" } }, false)).toEqual({ now: [W], onClick: [{ table: "joints", id: "j" }] });
    expect(pressSelection([P1], { ref: P1, handle: { kind: "rotate", placementId: "p1" } }, false)).toEqual({ now: [P1], onClick: null });
  });

  it("a hit on a wall, joint, opening or zone label replaces the selection, with or without Shift", () => {
    expect(pressSelection([P1, P2], { ref: W, handle: null }, true)).toEqual({ now: [W], onClick: null });
    expect(pressSelection([P1, P2], { ref: J, handle: null }, false)).toEqual({ now: [J], onClick: null });
    const opening: EntityRef = { table: "openings", id: "d" };
    expect(pressSelection([P1], { ref: opening, handle: null }, true)).toEqual({ now: [opening], onClick: null });
    const label: EntityRef = { table: "zoneLabels", id: "z" };
    expect(pressSelection([P1], { ref: label, handle: null }, true)).toEqual({ now: [label], onClick: null });
  });

  it("Shift on an unselected piece adds it at once", () => {
    expect(pressSelection([P1], { ref: P2, handle: null }, true)).toEqual({ now: [P1, P2], onClick: null });
    expect(pressSelection([W], { ref: P2, handle: null }, true)).toEqual({ now: [P2], onClick: null }); // never mixed
  });

  it("Shift on a selected piece keeps the selection and removes the piece on a click", () => {
    expect(pressSelection([P1, P2], { ref: P2, handle: null }, true)).toEqual({ now: [P1, P2], onClick: [P1] });
  });

  it("a plain press on a piece of a group keeps the group and collapses to the piece on a click", () => {
    expect(pressSelection([P1, P2, P3], { ref: P2, handle: null }, false)).toEqual({ now: [P1, P2, P3], onClick: [P2] });
  });

  it("a plain press on a piece that is the only selection, or unselected, selects it alone", () => {
    expect(pressSelection([P1], { ref: P1, handle: null }, false)).toEqual({ now: [P1], onClick: null });
    expect(pressSelection([P1], { ref: P2, handle: null }, false)).toEqual({ now: [P2], onClick: null });
  });

  it("compares refs by table and id, not by object identity", () => {
    expect(pressSelection([P1, P2], { ref: piece("p2"), handle: null }, true)).toEqual({ now: [P1, P2], onClick: [P1] });
  });
});
