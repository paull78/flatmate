// Demo step 9a (spec §1.4): steps 2–6 of the five-minute demo, replayed through the headless editor.
// No DOM, no canvas, no server: pointer and key events go in, effects and a ViewModel come out.
// The steps stay inline on purpose, so the file reads as the demo; demo.test.ts is the regression test.
// Run on screen with: pnpm demo:headless
import { describe, expect, it } from "vitest";
import { MESSAGES, zones } from "@fm/domain";
import type { Document, Joint } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { COLORS } from "../../src/view/colors";
import { helperLabelAt } from "../../src/view/helper";
import { FakeShell } from "../fake-shell";

// The core packages build without DOM or Node types; vitest provides console at run time.
declare const console: { table(rows: readonly object[]): void };

const SHIFT = { shift: true };

/** The joint at exactly `p` (no tolerance: the demo's snaps and typed lengths land on exact values). */
function jointAt(doc: Document, p: Point): Joint | undefined {
  return Object.values(doc.joints).find((j) => j.x === p.x && j.y === p.y);
}

function areas(doc: Document): string[] {
  return zones(doc).map((z) => (z.area === null ? "unavailable" : z.area.toFixed(2)));
}

function field(shell: FakeShell, id: string): string {
  const props = shell.view().properties;
  if (props.kind === "none") throw new Error("nothing is selected");
  const f = props.fields.find((x) => x.id === id);
  if (!f) throw new Error(`no property field "${id}"`);
  return f.unit ? `${f.value} ${f.unit}` : f.value;
}

function hasRedWall(shell: FakeShell): boolean {
  const walls = shell.scene().layers.find((l) => l.name === "walls")?.primitives ?? [];
  return walls.some((p) => p.kind === "polygon" && p.color === COLORS.invalid);
}

describe("Flatmate demo, headless (steps 2–6)", () => {
  const shell = FakeShell.local();

  it("step 2: W, Shift held, a 6 × 4 m room from typed lengths 6, 4, 6, closed on the first joint", () => {
    shell.key("w");
    shell.click({ x: 0, y: 0 }, SHIFT);
    shell.moveTo({ x: 3, y: 0.2 }, SHIFT); // right; Shift keeps the direction orthogonal
    shell.type("6", SHIFT); // Shift stays held while typing (spec §5.4)
    shell.key("Enter", SHIFT);
    shell.moveTo({ x: 6.2, y: 2 }, SHIFT); // up
    shell.type("4", SHIFT);
    shell.key("Enter", SHIFT);
    shell.moveTo({ x: 3, y: 4.2 }, SHIFT); // left
    shell.type("6", SHIFT);
    shell.key("Enter", SHIFT);
    shell.click({ x: 0.02, y: 0.02 }, SHIFT); // clicking the first joint closes the chain

    expect(Object.keys(shell.doc().walls)).toHaveLength(4);
    for (const p of [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }]) {
      expect(jointAt(shell.doc(), p), `joint at (${p.x}, ${p.y})`).toBeDefined();
    }
    expect(shell.view().commandBar.prompt).toBe("First point");
  });

  it("step 3: a divider between the two wall midpoints; the midpoint snap makes both ends exact", () => {
    shell.moveTo({ x: 3.04, y: 0.03 }, SHIFT);
    expect(shell.view().snap).toEqual({ kind: "midpoint", at: { x: 3, y: 0 } });
    shell.click({ x: 3.04, y: 0.03 }, SHIFT);
    shell.moveTo({ x: 3.1, y: 3.97 }, SHIFT);
    expect(shell.view().snap).toEqual({ kind: "midpoint", at: { x: 3, y: 4 } });
    shell.click({ x: 3.1, y: 3.97 }, SHIFT);
    shell.key("Enter"); // an empty value finishes the chain

    expect(Object.keys(shell.doc().walls)).toHaveLength(7); // the bottom and top walls split at T-junctions
    expect(jointAt(shell.doc(), { x: 3, y: 0 })).toBeDefined();
    expect(jointAt(shell.doc(), { x: 3, y: 4 })).toBeDefined();
    expect(zones(shell.doc())).toHaveLength(2);
  });

  it("step 4: Z, click inside each room: each tag shows 10.64 m² with 0.20 m walls", () => {
    shell.key("z");
    shell.click({ x: 1.5, y: 2 });
    expect(field(shell, "area")).toBe("10.64 m²");
    shell.click({ x: 4.5, y: 2 });
    expect(field(shell, "area")).toBe("10.64 m²");

    expect(Object.keys(shell.doc().zoneLabels)).toHaveLength(2);
    expect(areas(shell.doc()).sort()).toEqual(["10.64", "10.64"]);
  });

  it("step 5: select the right wall, click its helper, type 3.5: the top-right joint moves to (6, 3.5)", () => {
    shell.key("v");
    shell.click({ x: 6, y: 1 });
    expect(shell.view().properties.kind).toBe("wall");
    expect(field(shell, "length")).toBe("4.00 m");

    const selected = shell.state.selection[0];
    const helper = selected && helperLabelAt(shell.doc(), selected.id, shell.state.camera);
    if (!helper) throw new Error("the selected wall shows no helper dimension");
    shell.click(helper);
    expect(shell.view().commandBar.prompt).toBe("Wall length");
    shell.type("3.5");
    shell.key("Enter");

    expect(jointAt(shell.doc(), { x: 6, y: 3.5 })).toBeDefined();
    expect(jointAt(shell.doc(), { x: 6, y: 4 })).toBeUndefined();
    expect(field(shell, "length")).toBe("3.50 m");
    expect(areas(shell.doc()).sort()).toEqual(["10.64", "9.94"]); // the top wall of the right room now slopes
  });

  it("step 6: dragging that joint across the divider turns red, is refused and reverts on release", () => {
    const before = shell.doc();
    shell.moveTo({ x: 6, y: 3.5 });
    shell.down({ x: 6, y: 3.5 }); // the selected wall's handle
    shell.moveTo({ x: 4, y: 3 }); // passing through: still valid
    expect(hasRedWall(shell)).toBe(false);
    shell.moveTo({ x: 2, y: 2 }); // the right wall would cross the divider at (3, 1.5)
    expect(hasRedWall(shell)).toBe(true);
    shell.up({ x: 2, y: 2 });

    expect(shell.doc()).toEqual(before);
    expect(jointAt(shell.doc(), { x: 6, y: 3.5 })).toBeDefined();
    expect(shell.view().toast).toBe(MESSAGES.crossing);
    expect(shell.view().toast).toBe("Walls can't cross");

    const doc = shell.doc();
    console.table(
      zones(doc).map((z) => ({
        room: z.labelIds.map((id) => doc.zoneLabels[id]?.name ?? id).join(" / "),
        area: z.area === null ? "Area unavailable" : `${z.area.toFixed(2)} m²`,
      })),
    );
  });
});
