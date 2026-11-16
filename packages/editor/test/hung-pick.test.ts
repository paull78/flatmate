import { describe, expect, it } from "vitest";
import { anchorAt, type Document } from "@fm/domain";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// A thin piece hung on a wall is clicked, not its wall (hangings step 08, found in the browser): the wall keeps every
// click on its body, but in the few pixels' band around it a piece whose footprint holds the point wins. The 6 × 4 room's
// north wall has its inner face at y 3.9; a 0.60 × 0.03 mirror hangs against it at x 2.7–3.3, y 3.87–3.9.

const withMirror = (): Document => withCommands(roomDoc(), {
  type: "placeObject", linked: false, deck: null, opId: "m", state: "s0", object: { kind: "mirror" }, at: anchorAt({ x: 3, y: 3.885 }, 0.03, 0), rotation: 0,
});
const picked = (shell: FakeShell) => shell.state.selection.map((r) => r.table);

describe("clicking a piece hung on a wall (step 08)", () => {
  it("a click on the mirror selects it, not the wall", () => {
    const shell = FakeShell.withDocument(withMirror());
    shell.click({ x: 3, y: 3.885 });
    expect(picked(shell)).toEqual(["placements"]);
  });

  it("a click on the wall's body still selects the wall, over the mirror's ends too", () => {
    const shell = FakeShell.withDocument(withMirror());
    shell.click({ x: 3, y: 3.95 });
    expect(picked(shell)).toEqual(["walls"]);
  });

  it("a click in the wall's band with no piece there still selects the wall", () => {
    const shell = FakeShell.withDocument(withMirror());
    shell.click({ x: 1, y: 3.885 });
    expect(picked(shell)).toEqual(["walls"]);
  });
});
