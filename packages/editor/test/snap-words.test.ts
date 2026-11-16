import { describe, expect, it } from "vitest";
import { COLORS } from "../src/view/colors";
import { roomDoc } from "./builders";
import { FakeShell } from "./fake-shell";

// Step 22 (law 7: a marker plus a word): each snap mark draws its word beside it in the snap colour; the grid none.

const words = (shell: FakeShell): string[] =>
  (shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? []).flatMap((p) => (p.kind === "text" && p.color === COLORS.snap ? [p.text] : []));

describe("snap words", () => {
  it("the Wall tool: Endpoint, Midpoint and the angle", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("w");
    shell.moveTo({ x: 6.03, y: 4.02 });
    expect(shell.state.snap?.kind).toBe("endpoint");
    expect(words(shell)).toEqual(["Endpoint"]);
    shell.moveTo({ x: 3.03, y: 0.02 });
    expect(shell.state.snap?.kind).toBe("midpoint");
    expect(words(shell)).toEqual(["Midpoint"]);
    shell.click({ x: 1, y: 1 });
    shell.moveTo({ x: 2.5, y: 2.47 }); // near the 45° ray from (1, 1)
    expect(shell.state.snap?.kind).toBe("angle");
    expect(words(shell)).toEqual(["45°"]);
  });

  it("a joint drag: Aligned, and no word on the grid", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.moveTo({ x: 6, y: 4 });
    shell.down({ x: 6, y: 4 });
    shell.moveTo({ x: 7.2, y: 4.04 }); // lines up with the other top corner's y
    expect(shell.state.snap?.kind).toBe("aligned");
    expect(words(shell)).toEqual(["Aligned"]);
    shell.moveTo({ x: 7.3, y: 5.3 });
    expect(shell.state.snap?.kind).toBe("grid");
    expect(words(shell)).toEqual([]);
  });

  it("the Dimension tool's marks get words too", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("m");
    shell.moveTo({ x: 6.02, y: 4.03 });
    expect(shell.state.snap?.kind).not.toBe("grid");
    expect(words(shell)).toHaveLength(1);
  });
});
