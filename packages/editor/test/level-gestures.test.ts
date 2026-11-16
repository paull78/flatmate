import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { viewedLevel } from "../src/state";
import { hitTest } from "../src/tools/hit-test";
import { handles } from "../src/view/handles";
import { helperLabelAt } from "../src/view/helper";
import { zoneChips } from "../src/view/zone-chips";
import { roomDoc, underlayDoc, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// Gate M2's gesture findings (levels.40): a gesture started at one level never finishes at another. Moving the view
// (Page Up, the strip) cancels a drag, a box, a press, the Object tool's ghost and the duplicate's ghost; the strip is
// ignored while a typed value is open, as Page Up already is.

const LOFT = "loft/k0";
const SOFA_ID = "sofa/p0";
const place = (opId: string, kind: string, at: Point): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at });

/**
 * The studio of select-at-level.test.ts: the 5.8 × 3.8 shell (roomDoc, ceiling 2.50) split at x = 2.5 by a 2.03
 * partition, under a Loft (top 2.15) at x 1.3–3.7, y 1.4–3.8; a sofa on the floor at x 3.55–5.65, y 0.1–1.0 and a
 * 0.90 × 1.20 mattress on the loft at x 2.7–3.6, y 2.5–3.7.
 */
function studio(): Document {
  return withCommands(
    roomDoc(),
    { type: "addWall", opId: "part", from: { at: { x: 2.5, y: 0 } }, to: { at: { x: 2.5, y: 4 } } },
    { type: "setWallTop", wallId: "part/w0", top: 2.03 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 2.5, y: 2.6 }, w: 2.4, d: 2.4 },
    place("sofa", "sofa", { x: 4.6, y: 1 }),
    { type: "placeObject", deck: null, opId: "bed", state: "s0", object: { kind: "bed", size: { w: 0.9, d: 1.2 } }, at: { x: 3.15, y: 3.7 } },
    { type: "setObjectSize", objectId: "bed/o0", w: 0.9, d: { standard: 1.2 }, h: { standard: 0.3 } },
    { type: "movePlacement", placementId: "bed/p0", at: { x: 3.15, y: 3.7 }, rotation: 0, deck: LOFT },
  );
}

const SOFA = { x: 4.6, y: 0.5 };
const OVER_LOFT = { x: 1.8, y: 2 }; // left of the partition, on the loft's empty top
const height = (shell: FakeShell): number | undefined => viewedLevel(shell.state)?.height;
const pieces = (shell: FakeShell): string[] => Object.keys(shell.doc().placements).sort();
const sent = (r: FakeRemote): number => r.submits().length;

describe("moving the view cancels a gesture started at the floor (levels.40)", () => {
  it("› a duplicate ghost started at the floor is cancelled by Page Up; nothing is placed", () => {
    const r = FakeRemote.open(studio());
    const shell = r.shell;
    shell.click(SOFA);
    shell.key("d", { meta: true });
    expect(shell.state.tool.state.kind).toBe("copying");
    const before = pieces(shell);
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    shell.click(OVER_LOFT);
    expect(pieces(shell)).toEqual(before);
    expect(sent(r)).toBe(0);
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]); // the click selected the loft, not a copy
  });

  it("› an open wall-length field is closed by the strip's Loft row, or the row is ignored while it is open; no wall changes", () => {
    const shell = FakeShell.withDocument(studio());
    const right = wallBetween(shell.doc(), { x: 6, y: 0 }, { x: 6, y: 4 });
    shell.click({ x: 6, y: 1 });
    const label = helperLabelAt(shell.doc(), right, shell.state.camera);
    if (!label) throw new Error("no helper label");
    shell.click(label);
    shell.type("4.5");
    expect(shell.state.tool.state.kind).toBe("editingHelper");
    const joints = shell.doc().joints;
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(shell.state.viewedDeck).toBeNull(); // ignored: the field stays open at the floor
    expect(height(shell)).toBe(0);
    expect(shell.state.tool.state).toEqual(expect.objectContaining({ kind: "editingHelper", value: "4.5" }));
    shell.key("Escape");
    expect(shell.doc().joints).toBe(joints);
  });

  it("› the strip is ignored while the Wall tool's length or the Scale tool's distance is typed", () => {
    const wall = FakeShell.withDocument(studio());
    wall.key("w");
    wall.click({ x: 4, y: 2 });
    wall.type("2");
    wall.ui({ type: "setViewedLevel", deck: LOFT });
    expect(wall.state.viewedDeck).toBeNull();
    expect(wall.view().commandBar.value).toBe("2");

    const scale = FakeShell.withDocument(underlayDoc(studio())); // the picture spans x −1.37 to 1.63, y 4.02 to 5.22
    scale.ui({ type: "pickTool", tool: "scale" });
    scale.click({ x: -1, y: 4.5 });
    scale.click({ x: 1, y: 4.5 });
    scale.type("2");
    expect(scale.state.tool.state.kind).toBe("typing");
    scale.ui({ type: "setViewedLevel", deck: LOFT });
    expect(scale.state.viewedDeck).toBeNull();
    expect(scale.state.tool.state.kind).toBe("typing");
  });

  it("› a sofa drag at the floor is cancelled by Page Up mid-drag; nothing is sent", () => {
    const r = FakeRemote.open(studio());
    const shell = r.shell;
    const at = shell.doc().placements[SOFA_ID]?.at;
    shell.moveTo(SOFA);
    shell.down(SOFA);
    shell.moveTo({ x: 4.6, y: 0.8 });
    expect(shell.state.tool.state.kind).toBe("moving");
    shell.key("PageUp");
    expect(height(shell)).toBe(2.15);
    expect(shell.state.tool).toEqual({ name: "select", state: { kind: "idle" } });
    shell.moveTo({ x: 4.6, y: 1.2 });
    shell.up({ x: 4.6, y: 1.2 });
    expect(sent(r)).toBe(0);
    expect(shell.doc().placements[SOFA_ID]?.at).toEqual(at);
  });

  it("› a press on the sofa, a box from empty canvas and the Object tool's ghost and press are cancelled by Page Up", () => {
    const press = FakeRemote.open(studio());
    press.shell.moveTo(SOFA);
    press.shell.down(SOFA);
    press.shell.key("PageUp");
    expect(press.shell.state.tool.state.kind).toBe("idle");
    press.shell.moveTo({ x: 4.6, y: 1.2 }); // past the drag threshold: no drag of the floor's sofa starts at the loft
    press.shell.up({ x: 4.6, y: 1.2 });
    expect(press.shell.state.tool.state.kind).toBe("idle");
    expect(sent(press)).toBe(0);

    const box = FakeShell.withDocument(studio());
    box.drag({ x: -1, y: -1 }, { x: 7, y: 5 }); // at the floor this box selects the sofa
    expect(box.state.selection).toContainEqual({ table: "placements", id: SOFA_ID });
    box.click({ x: -1, y: -2 });
    box.moveTo({ x: -1, y: -1 });
    box.down({ x: -1, y: -1 });
    box.moveTo({ x: 7, y: 5 });
    expect(box.state.tool.state.kind).toBe("box");
    box.key("PageUp");
    expect(box.state.tool.state.kind).toBe("idle");
    box.up({ x: 7, y: 5 });
    expect(box.state.selection).toEqual([]);

    const object = FakeRemote.open(studio());
    object.shell.ui({ type: "pickKind", kind: "chair" });
    object.shell.moveTo({ x: 1, y: 0.8 });
    const tool = () => object.shell.state.tool;
    expect(tool().name === "object" && tool().state).toEqual(expect.objectContaining({ ghost: expect.objectContaining({ surface: null }) }));
    object.shell.key("r");
    object.shell.down({ x: 1, y: 0.8 });
    object.shell.key("PageUp");
    expect(tool()).toEqual({ name: "object", state: { kind: "idle", ghost: null, rotation: 90, pressing: null, stair: null, preview: null, offer: null } }); // the turn stays
    object.shell.up({ x: 1, y: 0.8 });
    expect(sent(object)).toBe(0);
  });

  it("› viewing the same level again (the viewed row, Page Up at the top) keeps the gesture", () => {
    const shell = FakeShell.withDocument(studio());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.moveTo({ x: 3.15, y: 3.1 });
    shell.down({ x: 3.15, y: 3.1 });
    shell.moveTo({ x: 3.15, y: 2.9 });
    expect(shell.state.tool.state.kind).toBe("moving");
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.key("PageUp");
    expect(shell.state.tool.state.kind).toBe("moving");
  });

  it("› with these fixed, a stale floor selection can't reach the loft (handles and chips gates stay as guards)", () => {
    const shell = FakeShell.withDocument(studio());
    shell.click(SOFA);
    const grips = handles(shell.state, shell.doc()).filter((h) => h.hittable);
    const chips = zoneChips(shell.state, shell.doc());
    expect(grips.length).toBeGreaterThan(0);
    expect(chips.length).toBeGreaterThan(0);
    for (const h of grips) expect(hitTest(shell.state, h.at)?.handle).not.toBeNull();
    for (const c of chips) expect(hitTest(shell.state, c.at)?.chip).toBeDefined();

    // Every way up prunes the selection, so a floor piece's grips and chips never show at the loft…
    shell.key("d", { meta: true });
    shell.key("PageUp");
    expect(shell.state.selection).toEqual([]);
    expect(handles(shell.state, shell.doc())).toEqual([]);
    expect(zoneChips(shell.state, shell.doc())).toEqual([]);

    // …and if one were left selected, the hit test's gates still refuse its grips and chips.
    shell.key("PageDown");
    shell.click(SOFA);
    const stale = { ...shell.state, viewedDeck: LOFT };
    for (const h of grips) expect(hitTest(stale, h.at)?.handle ?? null).toBeNull();
    for (const c of chips) expect(hitTest(stale, c.at)?.chip).toBeUndefined();
  });
});
