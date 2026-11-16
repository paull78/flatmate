import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Field } from "../src/view/view-model-types";
import { roomDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Properties' Sill and Height (sills step 10, AC-08; sills.07): a window shows its sill and its own height, a door or
// doorway its height; a sill edit keeps the height, a height edit keeps the sill, each one undo step, and a value that
// doesn't fit is refused with its reason. The 6 × 4 room under its 2.50 ceiling; the opening on the north wall at x 2–3.

const north = (doc: Document): string => wallBetween(doc, { x: 6, y: 4 }, { x: 0, y: 4 });
function selected(kind: "window" | "swing"): FakeShell {
  const doc = roomDoc();
  const wall = north(doc);
  const a = doc.joints[doc.walls[wall]?.a ?? ""];
  const add: Command = { type: "addOpening", opId: "o", wall, kind, offset: a?.x === 0 ? 2 : (a?.x ?? 0) - 3, width: 1 };
  const shell = FakeShell.withDocument(withCommands(doc, add));
  shell.click({ x: 2.5, y: 4 });
  return shell;
}
const fieldOf = (shell: FakeShell, id: string): Field | undefined => {
  const p = shell.view().properties;
  return "fields" in p ? p.fields.find((f) => f.id === id) : undefined;
};
const set = (shell: FakeShell, fieldId: string, value: string): void => void shell.ui({ type: "setField", fieldId, value });
const heights = (shell: FakeShell) => [shell.doc().openings["o/d0"]?.sill, shell.doc().openings["o/d0"]?.head];

describe("an opening's heights in Properties (sills step 10, AC-08)", () => {
  it("a window shows Sill 0.90 and Height 1.20; a door shows Height 2.10 and no Sill", () => {
    const win = selected("window");
    expect([fieldOf(win, "sill")?.value, fieldOf(win, "height")?.value]).toEqual(["0.90", "1.20"]);
    expect([fieldOf(win, "sill")?.label, fieldOf(win, "height")?.label]).toEqual(["Sill", "Height"]);
    const door = selected("swing");
    expect([fieldOf(door, "sill"), fieldOf(door, "height")?.value]).toEqual([undefined, "2.10"]);
  });

  it("Sill 1.20 keeps the height (1.20–2.40), then Height 0.60 keeps the sill (1.20–1.80), each one undo step", () => {
    const shell = selected("window");
    set(shell, "sill", "1.2");
    expect(heights(shell)).toEqual([1.2, 2.4]);
    set(shell, "height", "0.6");
    expect(heights(shell)).toEqual([1.2, 1.8]);
    shell.key("z", { ctrl: true });
    expect(heights(shell)).toEqual([1.2, 2.4]);
    shell.key("z", { ctrl: true });
    expect(heights(shell)).toEqual([0.9, 2.1]);
  });

  it("a door's Height sets its head", () => {
    const shell = selected("swing");
    set(shell, "height", "1.9");
    expect(heights(shell)).toEqual([0, 1.9]);
  });

  it("a value that doesn't fit is refused with its reason and leaves the window as it was", () => {
    const shell = selected("window");
    set(shell, "height", "1.6");
    expect(shell.view().toast).toBe("A window's head must be at least 0.10 m under its wall's top, at 2.50 m");
    expect(heights(shell)).toEqual([0.9, 2.1]);
    set(shell, "sill", "abc");
    expect(shell.view().toast).toBe("Can't read abc");
    expect(heights(shell)).toEqual([0.9, 2.1]);
  });

  it("switching the window to a swing door keeps its head; back to a window takes the 0.90 sill", () => {
    const shell = selected("window");
    set(shell, "height", "0.9"); // 0.90–1.80
    set(shell, "kind", "swing");
    expect(heights(shell)).toEqual([0, 1.8]);
    set(shell, "kind", "window");
    expect(heights(shell)).toEqual([0.9, 1.8]);
  });
});
