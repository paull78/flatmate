import { describe, expect, it } from "vitest";
import { emptyDocument, rectangleRoom, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import type { LayerName, Primitive } from "../src/view/scene-types";
import { openingReason } from "../src/tools/opening-tool";
import { roomDoc, wallBetween, wallDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// roomDoc's bottom wall runs from (0, 0) to (6, 0): its left side is the room (y > 0).
const bottom = (doc: Document): string => wallBetween(doc, { x: 0, y: 0 }, { x: 6, y: 0 });
const openings = (shell: FakeShell) => Object.values(shell.doc().openings);
const layer = (shell: FakeShell, name: LayerName): readonly Primitive[] => shell.scene().layers.find((l) => l.name === name)?.primitives ?? [];

describe("the Opening tool (spec: openings)", () => {
  it("D then a click on a wall adds a 0.80 swing door centred at the click, opening to the pointer's side; the tool stays armed with the same kind (AC-17)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    const areasBefore = layer(shell, "tags").flatMap((p) => (p.kind === "text" ? [p.text] : []));
    shell.key("d");
    expect(shell.view().activeTool).toBe("opening");
    expect(shell.view().openingKind).toBe("swing");
    shell.click({ x: 3, y: 0.05 });
    expect(openings(shell)).toEqual([
      expect.objectContaining({ wall: bottom(shell.doc()), kind: "swing", offset: 2.6, width: 0.8, side: "left", hinge: "a", glazed: false }),
    ]);
    expect(shell.view().activeTool).toBe("opening");
    expect(shell.view().openingKind).toBe("swing");
    shell.click({ x: 1, y: -0.05 }); // the outside of the same wall: opens outwards
    expect(openings(shell).map((o) => [o.offset, o.side])).toEqual(expect.arrayContaining([[0.6, "right"]]));
    expect(layer(shell, "tags").flatMap((p) => (p.kind === "text" ? [p.text] : []))).toEqual(areasBefore); // rooms and areas unchanged
    shell.key("Escape");
    expect(shell.view().activeTool).toBe("select");
  });

  it("with openingKind window a click adds a 1.00 window; the warnings layer is empty (AC-26)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.ui({ type: "pickOpeningKind", kind: "window" });
    expect(shell.view().activeTool).toBe("opening");
    expect(shell.view().openingKind).toBe("window");
    shell.click({ x: 3, y: 0.05 });
    expect(openings(shell)).toEqual([expect.objectContaining({ kind: "window", offset: 2.5, width: 1 })]);
    expect(layer(shell, "warnings")).toEqual([]);
  });

  it("a click on a wall span already holding a door toasts the I12 refusal", () => {
    const doc = withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: bottom(roomDoc()), kind: "swing", offset: 2.6 });
    const shell = FakeShell.withDocument(doc);
    shell.key("d");
    shell.click({ x: 3.2, y: 0.05 });
    expect(openings(shell)).toHaveLength(1);
    expect(shell.view().toast).toBe("This door would overlap a door on this wall");
  });

  it("hovering a wall previews the opening at the pointer's projection; red where it would not fit", () => {
    const doc = withCommands(roomDoc(), { type: "addOpening", opId: "d", wall: bottom(roomDoc()), kind: "swing", offset: 2.6 });
    const shell = FakeShell.withDocument(doc);
    shell.key("d");
    shell.moveTo({ x: 1, y: 0.05 });
    const t = shell.state.tool;
    expect(t.name === "opening" ? t.state.preview : null).toMatchObject({ ok: true, opening: { offset: 0.6, side: "left" } });
    expect(layer(shell, "overlays").length).toBeGreaterThan(0);
    shell.moveTo({ x: 3.2, y: 0.05 });
    const u = shell.state.tool;
    expect(u.name === "opening" ? u.state.preview?.ok : null).toBe(false);
    shell.moveTo({ x: 3, y: 2 }); // off every wall
    const v = shell.state.tool;
    expect(v.name === "opening" ? v.state.preview : undefined).toBeNull();
    expect(layer(shell, "overlays")).toEqual([]);
  });

  it("hovering with a window at 2.00 and the door preview at 0.60 draws 0.50, 0.80, 0.60, 1.00, 0.90 and no total (AC-18)", () => {
    const base = roomDoc();
    const right = wallBetween(base, { x: 6, y: 0 }, { x: 6, y: 4 }); // a = (6, 0)
    const shell = FakeShell.withDocument(withCommands(base, { type: "addOpening", opId: "w", wall: right, kind: "window", offset: 2 }));
    shell.key("d");
    shell.moveTo({ x: 5.95, y: 1 }); // the 0.80 door centred at 1.00 starts at 0.60
    const t = shell.state.tool;
    expect(t.name === "opening" ? t.state.preview : null).toMatchObject({ ok: true, opening: { wall: right, offset: 0.6 } });
    const texts = () => layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p.text] : []));
    expect(texts()).toEqual(["0.50", "0.80", "0.60", "1.00", "0.90"]);
    shell.moveTo({ x: 5.95, y: 2.2 }); // over the window: red, and the chain stays
    const u = shell.state.tool;
    expect(u.name === "opening" ? u.state.preview?.ok : null).toBe(false);
    expect(texts()).toContain("1.70");
    shell.moveTo({ x: 3, y: 2 }); // off every wall
    expect(texts()).toEqual([]);
  });

  it("in a clockwise room the hover chain draws on the wall's room side, its right of a → b, with clear numbers (AC-18)", () => {
    const cw = withCommands(emptyDocument(), ...rectangleRoom({ x: 6, y: 0 }, -6, 4)); // right wall a = (6, 4) → b = (6, 0)
    const right = wallBetween(cw, { x: 6, y: 4 }, { x: 6, y: 0 });
    const shell = FakeShell.withDocument(withCommands(cw, { type: "addOpening", opId: "w", wall: right, kind: "window", offset: 2 })); // y 2.0 → 1.0
    shell.key("d");
    shell.moveTo({ x: 5.95, y: 3 }); // the 0.80 door centred 1.00 from a starts at 0.60
    const t = shell.state.tool;
    expect(t.name === "opening" ? t.state.preview : null).toMatchObject({ ok: true, opening: { wall: right, offset: 0.6 } });
    const texts = layer(shell, "annotations").flatMap((p) => (p.kind === "text" && p.color === COLORS.helper ? [p] : []));
    expect(texts.map((p) => p.text)).toEqual(["0.50", "0.80", "0.60", "1.00", "0.90"]);
    for (const p of texts) expect(p.at.x).toBeCloseTo(6 - 0.1 - 18 / 80, 9);
  });

  it("the preview and its chain are gone on pointer leave (ux-polish.17)", () => {
    const shell = FakeShell.withDocument(roomDoc());
    shell.key("d");
    shell.moveTo({ x: 1, y: 0.05 });
    expect(layer(shell, "overlays").length).toBeGreaterThan(0);
    shell.send({ type: "pointerLeave" });
    const t = shell.state.tool;
    expect(t.name === "opening" ? t.state.preview : undefined).toBeNull();
    expect(layer(shell, "overlays")).toEqual([]);
    expect(shell.state.pointer).toBeNull();
  });
});

describe("a pocket door's preview (openkinds.09, AC-08)", () => {
  const preview = (shell: FakeShell) => {
    const t = shell.state.tool;
    return t.name === "opening" ? t.state.preview : null;
  };

  it("on a wall too short for its pocket is red, with the pocket's reason", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 1.4, y: 0 }));
    shell.ui({ type: "pickOpeningKind", kind: "pocket" });
    shell.moveTo({ x: 0.7, y: 0.05 });
    const p = preview(shell);
    expect(p?.ok).toBe(false);
    expect(p ? openingReason(shell.state, p) : null).toBe("A pocket door needs 0.80 m of wall past its end");
  });

  it("near a long wall's end parks its pocket toward the middle, so it previews valid", () => {
    const shell = FakeShell.withDocument(wallDoc({ x: 0, y: 0 }, { x: 2, y: 0 }));
    shell.ui({ type: "pickOpeningKind", kind: "pocket" });
    shell.moveTo({ x: 0.5, y: 0.05 });
    expect(preview(shell)).toMatchObject({ ok: true, opening: { kind: "pocket", hinge: "b" } });
  });

  it("a window clicked over the pocket is refused in plain words, and nothing is added", () => {
    const doc = wallDoc({ x: 0, y: 0 }, { x: 4, y: 0 });
    const wall = Object.keys(doc.walls)[0] ?? "";
    const shell = FakeShell.withDocument(withCommands(doc, { type: "addOpening", opId: "p", wall, kind: "pocket", offset: 0.5, width: 0.8, hinge: doc.joints[doc.walls[wall]?.a ?? ""]?.x === 0 ? "b" : "a" })); // pocket x 1.3–2.1
    shell.ui({ type: "pickOpeningKind", kind: "window" });
    shell.click({ x: 1.9, y: 0.05 }); // a 1.00 window at x 1.4–2.4
    expect(shell.view().toast).toBe("A pocket door's pocket would overlap a window");
    expect(Object.keys(shell.doc().openings)).toEqual(["p/d0"]);
  });
});
