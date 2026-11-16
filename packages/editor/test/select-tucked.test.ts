import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The click cycle on a tucked chair (seating.10, AC-07): the table reads on top, so a click in the overlap picks it
// first and the next click there the chair. roomDoc: a desk x 1.4–2.6, y 3.3–3.9; a chair turned 180° facing it,
// tucked 0.30 under (y 3.15–3.60), so they overlap in x 1.775–2.225, y 3.3–3.6.

const place = (opId: string, kind: string, x: number, y: number, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, rotation });

function tucked(chairFirst: boolean): { doc: Document; desk: string; chair: string } {
  const [c, d] = chairFirst ? ["a", "z"] : ["z", "a"];
  return { doc: withCommands(roomDoc(), place(d, "desk", 2, 3.9), place(c, "chair", 2, 3.15, 180)), desk: `${d}/p0`, chair: `${c}/p0` };
}

describe("selecting a tucked chair (AC-07)", () => {
  it.each([true, false])("click in the overlap selects the table, a second click the chair (chair's ID first: %s)", (chairFirst) => {
    const { doc, desk, chair } = tucked(chairFirst);
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 2, y: 3.45 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: desk }]);
    shell.click({ x: 2, y: 3.45 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: chair }]);
    shell.click({ x: 2, y: 3.45 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: desk }]);
  });

  it("a click on the chair's part outside the desk selects the chair", () => {
    const { doc, chair } = tucked(false);
    const shell = FakeShell.withDocument(doc);
    shell.click({ x: 2, y: 3.2 });
    expect(shell.state.selection).toEqual([{ table: "placements", id: chair }]);
  });
});
