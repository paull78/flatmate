import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { pruneSelection, switchTool } from "../src/state";
import { resizeCursor } from "../src/view/cursor";
import { zoneChips } from "../src/view/zone-chips";
import { bed160x200, roomDoc, sofaBed200, underlayDoc, wallBetween, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The cursor per handle (furnish.10, AC-12). roomDoc at zoom 80: inner faces x 0.1 / 5.9, y 0.1 / 3.9.
const P = (x: number, y: number): Point => ({ x, y });
const sofa = (at: Point, rotation = 0): Document =>
  withCommands(roomDoc(), { type: "placeObject", deck: null, opId: "sofa", state: "s0", object: { kind: "sofaBed" }, at, rotation } satisfies Command, sofaBed200("sofa/o0"));
/** The sofa (2 × 0.9) at rotation 0: x 1–3, y 2.1–3; grips right (3, 2.55), left (1, 2.55), front (2, 2.1), back (2, 3). */
const SOFA0 = () => sofa(P(2, 3));
/** Turned 45°: centre (3.3182, 2.1818); grips right (4.0253, 2.8889), left (2.6111, 1.4747), front (3.6364, 1.8636), back (3, 2.5). */
const SOFA45 = () => sofa(P(3, 2.5), 45);
const selected = (doc: Document, at: Point): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  shell.click(at);
  return shell;
};
const cursorAt = (shell: FakeShell, at: Point): string => {
  shell.moveTo(at);
  return shell.view().cursor;
};
const unit = (deg: number): Point => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });

describe("resizeCursor (furnish.10)", () => {
  it("buckets a direction to the nearest 45°, with world y up", () => {
    const table: [number, string][] = [
      [0, "ew"], [22, "ew"], [23, "nesw"], [45, "nesw"], [67, "nesw"], [68, "ns"], [90, "ns"], [112, "ns"], [113, "nwse"],
      [135, "nwse"], [157, "nwse"], [158, "ew"], [180, "ew"], [-22, "ew"], [-23, "nwse"], [-45, "nwse"], [-90, "ns"],
    ];
    for (const [deg, c] of table) expect(resizeCursor(unit(deg)), `${deg}°`).toBe(`${c}-resize`);
  });
});

describe("the cursor per handle (AC-12)", () => {
  it("side grips of an unturned piece", () => {
    const shell = selected(SOFA0(), P(2, 2.55));
    expect(cursorAt(shell, P(3, 2.55))).toBe("ew-resize");
    expect(shell.state.hoverHandle).toMatchObject({ kind: "side", side: "right" });
    expect(cursorAt(shell, P(1, 2.55))).toBe("ew-resize");
    expect(cursorAt(shell, P(2, 2.1))).toBe("ns-resize");
    expect(cursorAt(shell, P(2, 3))).toBe("ns-resize");
  });

  it("side grips of a piece turned 45°", () => {
    const shell = selected(SOFA45(), P(3.3182, 2.1818));
    expect(cursorAt(shell, P(4.0253, 2.8889))).toBe("nesw-resize");
    expect(cursorAt(shell, P(2.6111, 1.4747))).toBe("nesw-resize");
    expect(cursorAt(shell, P(3.6364, 1.8636))).toBe("nwse-resize");
    expect(cursorAt(shell, P(3, 2.5))).toBe("nwse-resize");
  });

  it("the rotation grip is grab, and grabbing while turning", () => {
    const shell = selected(SOFA0(), P(2, 2.55));
    expect(cursorAt(shell, P(2, 1.8))).toBe("grab");
    shell.down(P(2, 1.8));
    expect(shell.view().cursor).toBe("grab");
    shell.moveTo(P(2.5, 1.9));
    expect(shell.view().cursor).toBe("grabbing");
    shell.up(P(2.5, 1.9));
    expect(shell.view().cursor).not.toBe("grabbing");
  });

  it("a joint handle, a bare joint and a wall body are move; empty floor is default", () => {
    const shell = selected(roomDoc(), P(3, 0));
    expect(cursorAt(shell, P(6, 0))).toBe("move");
    expect(shell.state.hoverHandle?.kind).toBe("joint");
    shell.key("Escape");
    expect(cursorAt(shell, P(0, 0))).toBe("move");
    expect(shell.state.hoverHandle).toBeNull();
    expect(cursorAt(shell, P(6, 2))).toBe("move");
    expect(cursorAt(shell, P(3, 2))).toBe("default");
  });

  it("the cursor follows the grip right after the selecting click", () => {
    const shell = FakeShell.withDocument(SOFA0());
    expect(cursorAt(shell, P(2.96, 2.55))).toBe("pointer");
    expect(shell.state.hoverHandle).toBeNull();
    shell.down(P(2.96, 2.55));
    expect(shell.view().cursor).toBe("pointer");
    shell.up(P(2.96, 2.55));
    expect(shell.state.selection).toEqual([{ table: "placements", id: "sofa/p0" }]);
    expect(shell.state.hoverHandle).toMatchObject({ kind: "side", side: "right" });
    expect(shell.view().cursor).toBe("ew-resize");
  });

  it("a press under a still pointer takes the press's hit", () => {
    const shell = selected(SOFA0(), P(2, 2.55));
    expect(cursorAt(shell, P(4.5, 1))).toBe("default");
    shell.down(P(3, 2.55));
    expect(shell.view().cursor).toBe("ew-resize");
  });

  it("drags keep the cursor of what they move", () => {
    const drag = (doc: Document, select: Point | null, from: Point, to: Point): string => {
      const shell = select ? selected(doc, select) : FakeShell.withDocument(doc);
      shell.moveTo(from);
      shell.down(from);
      shell.moveTo(to);
      return shell.view().cursor;
    };
    expect(drag(SOFA45(), P(3.3182, 2.1818), P(4.0253, 2.8889), P(4.2374, 3.101))).toBe("nesw-resize");
    expect(drag(SOFA0(), P(2, 2.55), P(3, 2.55), P(3.3, 2.55))).toBe("ew-resize");
    expect(drag(SOFA0(), null, P(2, 2.55), P(2.5, 2.55))).toBe("move");
    expect(drag(roomDoc(), null, P(6, 2), P(5.5, 2))).toBe("move");
    const door = withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: wallBetween(roomDoc(), P(0, 0), P(6, 0)), kind: "swing", offset: 2.6, side: "left" });
    expect(drag(door, null, P(3, 0), P(3.5, 0))).toBe("ew-resize");
    const h = withCommands(roomDoc(), { type: "addDimension", opId: "m", a: P(1, 1), b: P(4, 1), offset: 0.5 });
    expect(drag(h, null, P(2.5, 1.5), P(2.5, 1.9))).toBe("ns-resize");
  });

  it("openings resize along their wall, dimensions across their line", () => {
    const base = roomDoc();
    const doors = withCommands(
      base,
      { type: "addOpening", opId: "d", wall: wallBetween(base, P(0, 0), P(6, 0)), kind: "swing", offset: 2.6, side: "left" },
      { type: "addOpening", opId: "e", wall: wallBetween(base, P(6, 0), P(6, 4)), kind: "swing", offset: 1.6, side: "left" },
    );
    const shell = FakeShell.withDocument(doors);
    expect(cursorAt(shell, P(3, 0.05))).toBe("ew-resize");
    expect(cursorAt(shell, P(6, 2))).toBe("ns-resize");
    const h = FakeShell.withDocument(withCommands(roomDoc(), { type: "addDimension", opId: "m", a: P(1, 1), b: P(4, 1), offset: 0.5 }));
    expect(cursorAt(h, P(2.5, 1.5))).toBe("ns-resize");
    const d = FakeShell.withDocument(withCommands(roomDoc(), { type: "addDimension", opId: "m", a: P(1, 0.5), b: P(2.5, 2.5), offset: 0.5 }));
    expect(cursorAt(d, P(1.35, 1.8))).toBe("nwse-resize");
  });

  it("a zone chip and a piece body are pointer", () => {
    const shell = selected(SOFA0(), P(2, 2.55));
    const chip = zoneChips(shell.state, shell.doc())[0];
    if (!chip) throw new Error("no chip");
    expect(cursorAt(shell, chip.at)).toBe("pointer");
    expect(shell.state.hoverHandle).toBeNull();
    expect(shell.state.hover).toEqual({ table: "placements", id: "sofa/p0" });
    expect(cursorAt(shell, P(2, 2.55))).toBe("pointer");
  });

  it("Esc and a nudge run drop the grip cursor", () => {
    const nudged = selected(SOFA0(), P(2, 2.55));
    expect(cursorAt(nudged, P(3, 2.55))).toBe("ew-resize");
    nudged.key("ArrowRight");
    expect(nudged.view().cursor).not.toBe("ew-resize");
    const esc = selected(SOFA0(), P(2, 2.55));
    expect(cursorAt(esc, P(3, 2.55))).toBe("ew-resize");
    esc.key("Escape");
    expect(esc.state.selection).toEqual([]);
    expect(esc.state.hoverHandle).toBeNull();
    expect(esc.view().cursor).toBe("pointer");
  });

  it("zone handles resize across and along their side", () => {
    // The bed x 2.2–3.8, y 1.9–3.9; its left zone x 1.6–2.2, y 1.9–3.45: depth handle (1.6, 2.675), ends at x 1.9,
    // y 3.45 and 1.9.
    const bed = (): FakeShell => selected(withCommands(
      roomDoc(),
      { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed" }, at: P(3, 3.9) },
      bed160x200("bed/o0"),
    ), P(3, 2.9));
    const shell = bed();
    expect(cursorAt(shell, P(1.6, 2.675))).toBe("ew-resize");
    expect(cursorAt(shell, P(1.9, 3.45))).toBe("ns-resize");
    expect(cursorAt(shell, P(1.9, 1.9))).toBe("ns-resize");
    shell.down(P(1.6, 2.675));
    shell.moveTo(P(1.9, 2.675));
    expect(shell.state.tool.name === "select" && shell.state.tool.state.kind).toBe("moving");
    expect(shell.view().cursor).toBe("ew-resize");
    const fresh = bed();
    fresh.moveTo(P(1.9, 3.45));
    fresh.down(P(1.9, 3.45));
    fresh.moveTo(P(1.9, 3.15));
    expect(fresh.view().cursor).toBe("ns-resize");
  });

  it("turned zone handles take the diagonal cursors", () => {
    const shell = selected(SOFA45(), P(3.3182, 2.1818));
    expect(cursorAt(shell, P(3.98995, 1.51005))).toBe("nwse-resize"); // the front depth handle
    expect(cursorAt(shell, P(3.10607, 0.98973))).toBe("nesw-resize"); // the start handle, 20 px out (half the 40 px)
  });

  it("other tools keep their cursors", () => {
    const shell = FakeShell.withDocument(underlayDoc());
    for (const tool of ["wall", "object", "opening", "dimension", "scale", "zone"] as const) { // the Zone tool draws named areas (areas.41)
      shell.ui({ type: "pickTool", tool });
      expect(shell.view().cursor, tool).toBe("crosshair");
    }
  });
});

describe("hoverHandle follows hover (furnish.10)", () => {
  it("a tool switch and a pruned hover clear it; a live hover keeps it", () => {
    const shell = selected(SOFA0(), P(2, 2.55));
    shell.moveTo(P(3, 2.55));
    expect(shell.state.hoverHandle).not.toBeNull();
    expect(switchTool(shell.state, "wall").hoverHandle).toBeNull();
    expect(pruneSelection(shell.state)).toBe(shell.state);
    const gone = pruneSelection({ ...shell.state, hover: { table: "placements", id: "missing" } });
    expect(gone.hover).toBeNull();
    expect(gone.hoverHandle).toBeNull();
  });
});
