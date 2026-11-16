import { describe, expect, it } from "vitest";
import { clearRoomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// A spiral's box stays square when it's drawn, and the ghost shows what the click stores (fixes AC-10, ux-polish.16).
describe("drawing a spiral stair", () => {
  it("the drag's ghost is square, and the piece it places is the ghost", () => {
    const shell = FakeShell.withDocument(clearRoomDoc(10, 8, "r"));
    shell.key("o");
    shell.ui({ type: "pickKind", kind: "spiralStair" });
    shell.moveTo({ x: 3, y: 5 });
    shell.down({ x: 3, y: 5 });
    shell.moveTo({ x: 4.4, y: 2.8 });
    const ghost = shell.state.tool.name === "object" ? shell.state.tool.state.ghost : null;
    expect(ghost?.w).toBe(ghost?.d);
    expect(ghost?.w).toBeCloseTo(1.4, 9);
    shell.up({ x: 4.4, y: 2.8 });
    const [spiral, ...others] = Object.values(shell.doc().objects);
    expect(others).toEqual([]);
    expect(spiral?.kind).toBe("spiralStair");
    expect(spiral?.w.standard).toBe(ghost?.w);
    expect(spiral?.d.standard).toBe(ghost?.d);
  });
});
