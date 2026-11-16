import { describe, expect, it } from "vitest";
import { columnOf, wallRange, zoneOfLabel, type Command, type Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { LOFT_ROOM_LOFT, loftRoomDoc, roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// Properties for a column (spec "Properties", pillars.14; AC-16 typed width): Width, Depth, Angle, the area it takes
// off its room. A column row shows no Wall section.

const ROW = "c/w0";
const place: Command = { type: "placeColumn", opId: "c", at: { x: 2, y: 2 }, width: 0.3, depth: 0.4 };
const label: Command = { type: "labelZone", id: "L1", at: { x: 4, y: 3 }, name: "Studio", finish: null };
const set = (shell: FakeShell, fieldId: string, value: string) => shell.ui({ type: "setField", fieldId, value });
const column = (shell: FakeShell) => columnOf(shell.doc(), ROW);

function selected(): FakeShell {
  const shell = FakeShell.withDocument(withCommands(roomDoc(), place, label));
  shell.click({ x: 2, y: 2 });
  expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
  return shell;
}
function fields(shell: FakeShell) {
  const props = shell.view().properties;
  return props.kind === "column" ? props.fields : [];
}

describe("Properties for a column", () => {
  it("a Column section: Width, Depth, Angle, Base, Top, Height and the floor it takes; no Wall section", () => {
    const shell = selected();
    expect(shell.view().properties.kind).toBe("column");
    expect(fields(shell).map((f) => [f.id, f.label, f.value, f.unit, f.readOnly])).toEqual([
      ["width", "Width", "0.30", "m", false],
      ["depth", "Depth", "0.40", "m", false],
      ["angle", "Angle", "0", "°", false],
      ["base", "Base", "Floor", null, true],
      ["top", "Top", "ceiling", null, false],
      ["height", "Height", "2.50", "m", true],
      ["takes", "Takes", "0.12 m²", null, true],
    ]);
    expect(new Set(fields(shell).map((f) => f.section))).toEqual(new Set(["Column"]));
  });

  it("Width 0.60 typed resizes about the centre; 2.01 is refused with the range in the toast", () => {
    const shell = selected();
    set(shell, "width", "0.60");
    expect(column(shell)).toEqual(expect.objectContaining({ centre: { x: 2, y: 2 }, width: expect.closeTo(0.6, 9), depth: 0.4 }));
    set(shell, "width", "2.01");
    expect(shell.view().toast).toContain("0.10–2.00");
    expect(column(shell)?.width).toBeCloseTo(0.6, 9);
    set(shell, "depth", "abc");
    expect(shell.view().toast).toBe("Can't read abc");
  });

  it("Depth and Angle typed: one setColumn each, one undo step each", () => {
    const shell = selected();
    set(shell, "depth", "0.5");
    set(shell, "angle", "30");
    expect(column(shell)?.depth).toBe(0.5);
    expect(column(shell)?.rotation).toBeCloseTo(30, 9);
    expect(fields(shell).find((f) => f.id === "angle")?.value).toBe("30");
    shell.key("z", { meta: true });
    expect(column(shell)?.rotation).toBeCloseTo(0, 9);
  });

  it("the area shown equals the room's loss", () => {
    const shell = selected();
    const withColumn = zoneOfLabel(shell.doc(), "L1")?.area ?? 0;
    const without = zoneOfLabel(withCommands(roomDoc(), label), "L1")?.area ?? 0;
    expect(without - withColumn).toBeCloseTo(0.12, 9);
    expect(fields(shell).find((f) => f.id === "takes")?.value).toBe("0.12 m²");
  });
});

describe("Properties for a column in a wall's line (AC-16)", () => {
  // 0.30 × 0.30 in the south wall (0,0)→(6,0) at (2, 0): halves (0,0)→(1.85,0) and (2.15,0)→(6,0).
  function inLine(): FakeShell {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeColumn", opId: "c", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 }));
    shell.click({ x: 2, y: 0 });
    expect(shell.state.selection).toEqual([{ table: "walls", id: ROW }]);
    return shell;
  }
  const halves = (shell: FakeShell): number[] => {
    const doc = shell.doc();
    return Object.values(doc.walls).filter((w) => !w.column && doc.joints[w.a]?.y === 0 && doc.joints[w.b]?.y === 0)
      .map((w) => Math.abs((doc.joints[w.b]?.x ?? 0) - (doc.joints[w.a]?.x ?? 0))).sort();
  };

  it("Angle is read-only, set by its wall; an angle sent anyway changes nothing", () => {
    const shell = inLine();
    expect(fields(shell).find((f) => f.id === "angle")).toEqual(expect.objectContaining({ value: "0", readOnly: true }));
    set(shell, "angle", "30");
    expect(column(shell)?.rotation).toBe(0);
    expect(shell.state.undo.past).toHaveLength(0);
    expect(shell.view().toast).toBeNull();
  });

  it("Takes shows only the part proud of the wall into the room (0.30 × 0.05)", () => {
    expect(fields(inLine()).find((f) => f.id === "takes")?.value).toBe("0.02 m²");
  });

  it("Width 0.60 for 0.30 keeps the centre and shortens each half by 0.15", () => {
    const shell = inLine();
    expect(halves(shell)).toEqual([expect.closeTo(1.85, 9), expect.closeTo(3.85, 9)]);
    set(shell, "width", "0.60");
    expect(column(shell)?.centre).toEqual({ x: expect.closeTo(2, 9), y: 0 });
    expect(column(shell)?.width).toBeCloseTo(0.6, 9);
    expect(halves(shell)).toEqual([expect.closeTo(1.7, 9), expect.closeTo(3.7, 9)]);
  });

  it("Depth typed keeps it in the line", () => {
    const shell = inLine();
    set(shell, "depth", "0.40");
    expect(column(shell)).toEqual(expect.objectContaining({ centre: { x: 2, y: 0 }, depth: 0.4, rotation: 0 }));
    expect(column(shell)?.line).not.toBeNull();
  });
});

describe("a column's Base and Top (spec \"Properties\", pillars.14, .23)", () => {
  // loftRoomDoc: ceiling 3.05, the Loft at 2.15 (underside 2.03) over x 1.3–3.7, y 1.4–3.8.
  const UNDER = "u/w0";
  const ON = "o/w0";
  const doc = (): Document => withCommands(loftRoomDoc(),
    { type: "placeColumn", opId: "u", at: { x: 2.4, y: 1.6 }, width: 0.2, depth: 0.2, top: LOFT_ROOM_LOFT },
    { type: "placeColumn", opId: "o", at: { x: 3.5, y: 3 }, width: 0.2, depth: 0.2, base: LOFT_ROOM_LOFT });
  function select(at: Point, loft: boolean, row: string): FakeShell {
    const shell = FakeShell.withDocument(doc());
    if (loft) shell.ui({ type: "setViewedLevel", deck: LOFT_ROOM_LOFT });
    shell.click(at);
    expect(shell.state.selection).toEqual([{ table: "walls", id: row }]);
    return shell;
  }
  const under = (): FakeShell => select({ x: 2.4, y: 1.6 }, false, UNDER);
  const on = (): FakeShell => select({ x: 3.5, y: 3 }, true, ON);
  const pick = (shell: FakeShell, id: string) => fields(shell).find((f) => f.id === id);
  const range = (shell: FakeShell, row: string) => wallRange(shell.doc(), row);
  const OPTIONS = { ceiling: { value: "ceiling", label: "Ceiling" }, loft: { value: LOFT_ROOM_LOFT, label: "Loft" }, height: { value: "height", label: "Height" } };

  it("a post under the loft: Base Floor, read-only; Top a choice of Ceiling, Loft and Height, on Loft; Height 2.03 read-only", () => {
    const shell = under();
    expect(fields(shell).map((f) => f.id)).toEqual(["width", "depth", "angle", "base", "top", "height", "takes"]);
    expect(pick(shell, "base")).toEqual(expect.objectContaining({ label: "Base", value: "Floor", readOnly: true }));
    expect(pick(shell, "top")).toEqual(expect.objectContaining({ label: "Top", value: LOFT_ROOM_LOFT, readOnly: false, select: true, options: [OPTIONS.ceiling, OPTIONS.loft, OPTIONS.height] }));
    expect(pick(shell, "height")).toEqual(expect.objectContaining({ label: "Height", value: "2.03", unit: "m", readOnly: true }));
  });

  it("Top Height keeps 2.03 as a height; Height 2.00 typed; Top Loft follows the loft again; one undo step each", () => {
    const shell = under();
    set(shell, "top", "height");
    expect(shell.doc().walls[UNDER]?.top).toBe(2.03);
    expect(pick(shell, "top")?.value).toBe("height");
    expect(pick(shell, "height")).toEqual(expect.objectContaining({ value: "2.03", readOnly: false, step: 0.01 }));
    set(shell, "height", "2.00");
    expect(range(shell, UNDER)).toEqual({ bottom: 0, top: 2 });
    set(shell, "top", LOFT_ROOM_LOFT);
    expect(shell.doc().walls[UNDER]?.top).toBe(LOFT_ROOM_LOFT);
    expect(range(shell, UNDER)?.top).toBeCloseTo(2.03, 9);
    expect(shell.state.undo.past).toHaveLength(3);
    shell.key("z", { meta: true });
    expect(shell.doc().walls[UNDER]?.top).toBe(2);
  });

  it("Top Ceiling under the loft is refused in plain words, and the post keeps the loft", () => {
    const shell = under();
    set(shell, "top", "ceiling");
    expect(shell.doc().walls[UNDER]?.top).toBe(LOFT_ROOM_LOFT);
    expect(shell.view().toast).not.toBeNull();
    expect(shell.view().toast).not.toMatch(/u\/w0|loft\/k0/);
  });

  it("a post on the loft, at the loft's level: Base Loft; Top Ceiling or Height only; Height 0.90, then back to Ceiling", () => {
    const shell = on();
    expect(pick(shell, "base")).toEqual(expect.objectContaining({ value: "Loft", readOnly: true }));
    expect(pick(shell, "top")).toEqual(expect.objectContaining({ value: "ceiling", options: [OPTIONS.ceiling, OPTIONS.height] }));
    expect(pick(shell, "height")).toEqual(expect.objectContaining({ value: "0.90", readOnly: true }));
    set(shell, "top", "height");
    set(shell, "height", "0.5");
    expect(range(shell, ON)).toEqual({ bottom: 2.15, top: expect.closeTo(2.65, 9) });
    set(shell, "top", "ceiling");
    expect(range(shell, ON)).toEqual({ bottom: 2.15, top: 3.05 });
  });

  it("in a wall's line Base and Top are read-only, the wall's", () => {
    const shell = FakeShell.withDocument(withCommands(roomDoc(), { type: "placeColumn", opId: "c", at: { x: 2, y: 0 }, width: 0.3, depth: 0.3 }));
    shell.click({ x: 2, y: 0 });
    expect(pick(shell, "base")).toEqual(expect.objectContaining({ value: "Floor", readOnly: true }));
    expect(pick(shell, "top")).toEqual(expect.objectContaining({ value: "Ceiling", readOnly: true }));
    expect(pick(shell, "top")?.options).toBeUndefined();
    expect(pick(shell, "height")).toEqual(expect.objectContaining({ value: "2.50", readOnly: true }));
    set(shell, "top", "height");
    expect(shell.state.undo.past).toHaveLength(0);
  });
});
