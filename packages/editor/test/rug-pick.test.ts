import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A click on a piece standing on a rug picks the piece (spec "The rug rule", catalog.15). roomDoc, a 6 × 4 room: a rug
// 3.00 × 2.00 at x 1.5–4.5, y 1.2–3.2, and a sofa standing on it at x 1.95–4.05, y 2.1–3.0.

const place = (opId: string, kind: string, at: Point, preset?: string): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: preset === undefined ? { kind } : { kind, preset }, at });
const ON_SOFA: Point = { x: 3, y: 2.5 };
const ON_RUG_ALONE: Point = { x: 3, y: 1.5 };

function living(rugFirst: boolean): { doc: Document; rug: string; sofa: string } {
  const [r, s] = rugFirst ? ["a", "z"] : ["z", "a"];
  return { doc: withCommands(roomDoc(), place(r, "rug", { x: 3, y: 3.2 }, "300"), place(s, "sofa", { x: 3, y: 3 })), rug: `${r}/p0`, sofa: `${s}/p0` };
}
const selected = (id: string) => [{ table: "placements", id }];

describe("picking on a rug (catalog.15)", () => {
  it.each([true, false])("a click on the sofa standing on a rug selects the sofa (the rug's ID first: %s)", (rugFirst) => {
    const { doc, sofa } = living(rugFirst);
    const shell = FakeShell.withDocument(doc);
    shell.click(ON_SOFA);
    expect(shell.state.selection).toEqual(selected(sofa));
  });

  it.each([true, false])("a click on the rug's free part selects the rug (the rug's ID first: %s)", (rugFirst) => {
    const { doc, rug } = living(rugFirst);
    const shell = FakeShell.withDocument(doc);
    shell.click(ON_RUG_ALONE);
    expect(shell.state.selection).toEqual(selected(rug));
  });

  it("the click cycle reaches the rug under the sofa, then comes back", () => {
    const { doc, rug, sofa } = living(false);
    const shell = FakeShell.withDocument(doc);
    shell.click(ON_SOFA);
    expect(shell.state.selection).toEqual(selected(sofa));
    shell.click(ON_SOFA);
    expect(shell.state.selection).toEqual(selected(rug));
    shell.click(ON_SOFA);
    expect(shell.state.selection).toEqual(selected(sofa));
  });

  it("a chair tucked under a desk on a rug: the desk first, the chair next, the rug last", () => {
    // The desk x 2.4–3.6, y 2.4–3.0; a chair facing it, x 2.775–3.225, y 2.25–2.7.
    const doc = withCommands(roomDoc(), place("z", "rug", { x: 3, y: 3.2 }, "300"), place("d", "desk", { x: 3, y: 3 }), { type: "placeObject", deck: null, opId: "c", state: "s0", object: { kind: "chair" }, at: { x: 3, y: 2.25 }, rotation: 180 });
    const shell = FakeShell.withDocument(doc);
    const at = { x: 3, y: 2.55 };
    shell.click(at);
    expect(shell.state.selection).toEqual(selected("d/p0"));
    shell.click(at);
    expect(shell.state.selection).toEqual(selected("c/p0"));
    shell.click(at);
    expect(shell.state.selection).toEqual(selected("z/p0"));
  });
});
