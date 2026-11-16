import { describe, expect, it } from "vitest";
import { isRug, motifDefaults, type Command, type Document } from "@fm/domain";
import { COLORS } from "../src/view/colors";
import { PALETTE, tileLook } from "../src/view/palette";
import { planPicture } from "../src/view/picture";
import { PRESENTATION_STYLE } from "../src/view/plan-style";
import { floorView } from "../src/view/plan-view";
import type { LayerName, Primitive, Scene } from "../src/view/scene-types";
import { labelledDoc, roomDoc, withCommands, withoutSheetFinishes } from "./builders";
import { FakeShell } from "./fake-shell";

// White over finishes, per picture (seating.02, AC-01): with the picture showing finishes and the document holding one,
// every piece fills white with the mockup's thin grey outline; otherwise today's grey (smart.46).
//
// The fixture: labelledDoc's divided 6 × 4 room, Room 1 (L1, x 0.1–2.9) finished in planks, Room 2 (L2, x 3.1–5.9) not;
// a desk against Room 1's top wall (x 0.9–2.1, y 3.3–3.9), a chair in Room 2 (x 4.25–4.75, y ~2.0–2.5) and a wall cabinet
// at 1.40 on Room 2's bottom wall (x 4.2–4.8, y 0.1–0.45), wholly above the 1.20 cut.

const WHITE = "#ffffff";
const WHITE_EDGE = "#5d6166";
const PLANKS = motifDefaults("planks");

const place = (opId: string, kind: string, x: number, y: number, rotation = 0): Command => ({ type: "placeObject", deck: null, opId, state: "s0", object: { kind }, at: { x, y }, rotation });
const PIECES: Command[] = [place("d", "desk", 1.5, 3.9), place("c", "chair", 4.5, 2.5), place("k", "wallCabinet", 4.5, 0.1, 180)];

const plain = (): Document => withCommands(labelledDoc(), ...PIECES);
const finished = (): Document => withCommands(plain(), { type: "setFinish", id: "L1", finish: PLANKS });

const layer = (scene: Scene, name: LayerName): readonly Primitive[] => scene.layers.find((l) => l.name === name)?.primitives ?? [];
const fills = (ps: readonly Primitive[]): string[] => ps.flatMap((p) => (p.kind === "polygon" ? [p.color] : []));
const objects = (shell: FakeShell): readonly Primitive[] => layer(shell.scene(), "objects");
const placementOf = (doc: Document, object: string): string => {
  const p = Object.values(doc.placements).find((q) => q.object === object);
  if (!p) throw new Error(`no placement of ${object}`);
  return p.id;
};
const strokes = (ps: readonly Primitive[]): Set<string> => new Set(ps.flatMap((p) => (p.kind === "segment" || p.kind === "arc" ? [p.color] : [])));
const px = (p: Primitive): number | null => (p.kind === "segment" && "px" in p.width ? p.width.px : null);
/** The primitives inside a box. */
const near = (ps: readonly Primitive[], x0: number, x1: number, y0: number, y1: number): Primitive[] =>
  ps.filter((p) => {
    const pts = p.kind === "polygon" ? p.points : p.kind === "segment" ? [p.a, p.b] : [];
    return pts.length > 0 && pts.every((q) => q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && q.y >= y0 - 1e-6 && q.y <= y1 + 1e-6);
  });

/** What an export hands the shell (the saved SVG or PDF, the PNG's page to rasterise). */
function exported(doc: Document, format: "pdf" | "svg" | "png", finishes: "with" | "without"): readonly Primitive[] {
  const shell = FakeShell.withDocument(format === "pdf" && finishes === "without" ? withoutSheetFinishes(doc) : doc);
  shell.ui({ type: "openExport" });
  shell.ui({ type: "setExport", field: "finishes", value: finishes });
  shell.ui({ type: "download", format });
  const content = shell.effectsOf("saveFile")[0]?.content;
  const primitives =
    format === "png" ? (shell.effectsOf("rasterise")[0]?.page.primitives ?? []) : content?.kind === "svg" ? content.primitives : content?.kind === "pdf" ? content.pages.flatMap((p) => p.primitives) : [];
  expect(primitives.length).toBeGreaterThan(0);
  return primitives;
}

describe("white over finishes, per picture (seating.02, AC-01)", () => {
  it("white with finishes on and a finished room: every piece, in the finished room and the unfinished one", () => {
    const shell = FakeShell.withDocument(finished());
    expect(shell.state.finishesOn).toBe(true);
    const ps = objects(shell);
    expect(fills(ps)).toEqual([WHITE, WHITE]); // the desk (finished room) and the chair (unfinished room); the cabinet is dashed
    expect(fills(near(ps, 0.9, 2.1, 3.3, 3.9))).toEqual([WHITE]);
    expect(fills(near(ps, 4.2, 4.8, 1.9, 2.5))).toEqual([WHITE]);
    expect(strokes(ps).has(WHITE_EDGE)).toBe(true);
    expect(strokes(ps).has(COLORS.objectEdge)).toBe(false);
    const widths = new Set(ps.flatMap((p) => (p.kind === "segment" && p.color === WHITE_EDGE && !p.dash ? [px(p)] : [])));
    expect(widths).toEqual(new Set([0.9, 1.4])); // the outline and the heavier front
  });

  it("grey with finishes off", () => {
    const shell = FakeShell.withDocument(finished());
    shell.state = { ...shell.state, finishesOn: false };
    const ps = objects(shell);
    expect(fills(ps)).toEqual([COLORS.object, COLORS.object]);
    expect(strokes(ps).has(WHITE_EDGE)).toBe(false);
  });

  it("grey in a document with no finish", () => {
    const ps = objects(FakeShell.withDocument(plain()));
    expect(fills(ps)).toEqual([COLORS.object, COLORS.object]);
    expect(strokes(ps).has(COLORS.objectEdge)).toBe(true);
  });

  it("grey in the PNG, SVG and PDF exported Without", () => {
    for (const format of ["png", "svg", "pdf"] as const) {
      const ps = exported(finished(), format, "without");
      expect(fills(ps).filter((c) => c === COLORS.object), format).toHaveLength(2);
      expect(strokes(ps).has(WHITE_EDGE), format).toBe(false);
    }
  });

  it("white in each exported With", () => {
    for (const format of ["png", "svg", "pdf"] as const) {
      const ps = exported(finished(), format, "with");
      expect(fills(ps).filter((c) => c === COLORS.object), format).toEqual([]);
      expect(strokes(ps).has(WHITE_EDGE), format).toBe(true);
      expect(strokes(ps).has(COLORS.objectEdge), format).toBe(false);
    }
  });

  it("planPicture in the presentation style: white With, grey Without, grey without a finish", () => {
    const doc = finished();
    const view = floorView(doc, "s0");
    const With = planPicture(doc, view, PRESENTATION_STYLE, 10, true).objects;
    expect(fills(With)).toEqual([WHITE, WHITE]);
    expect(strokes(With)).toEqual(new Set([WHITE_EDGE, "#9a9ea3"]));
    expect(fills(planPicture(doc, view, PRESENTATION_STYLE, 10, false).objects)).toEqual([COLORS.object, COLORS.object]);
    const bare = plain();
    expect(fills(planPicture(bare, floorView(bare, "s0"), PRESENTATION_STYLE, 10, true).objects)).toEqual([COLORS.object, COLORS.object]);
  });

  it("a deck's finish alone turns pieces white", () => {
    const deck = (...more: Command[]): Document =>
      withCommands(roomDoc(), { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1 }, w: 2, d: 1.4 }, place("c", "chair", 4.5, 2.5), ...more);
    expect(fills(objects(FakeShell.withDocument(deck())))).toEqual([COLORS.object]);
    expect(fills(objects(FakeShell.withDocument(deck({ type: "setDeckFinish", deckId: "p/k0", finish: PLANKS }))))).toEqual([WHITE]);
  });

  it("selected and refused fills unchanged", () => {
    const doc = finished();
    const shell = FakeShell.withDocument(doc);
    shell.state = { ...shell.state, selection: [{ table: "placements", id: placementOf(doc, "c/o0") }] };
    expect(fills(near(objects(shell), 4.2, 4.8, 1.9, 2.5))).toEqual([COLORS.objectSelected]);
    shell.state = { ...shell.state, selection: [] };
    shell.ui({ type: "pickKind", kind: "chair" });
    shell.moveTo({ x: 1.5, y: 3.6 }); // over the desk: refused
    expect(fills(layer(shell.scene(), "overlays"))).toContain(COLORS.invalidFill);
  });

  it("pieces above the cut stay unfilled", () => {
    const cabinet = near(objects(FakeShell.withDocument(finished())), 4.2, 4.8, 0.1, 0.45);
    expect(fills(cabinet)).toEqual([]);
    expect(cabinet).toHaveLength(4);
    expect(cabinet.every((p) => p.kind === "segment" && p.dash !== undefined)).toBe(true);
  });

  it("the flip's fill and the ghost follow the picture", () => {
    const flipping = (finishesOn: boolean): readonly Primitive[] => {
      const doc = withCommands(finished(), { type: "copyState", opId: "n", from: "s0", name: "Night" });
      const shell = FakeShell.withDocument(doc);
      shell.state = { ...shell.state, finishesOn, flip: { from: "s0", to: "n/s0", startedAt: 0, t: 0.5 } };
      return objects(shell);
    };
    expect(fills(flipping(true))).toEqual([WHITE, WHITE]);
    expect(strokes(flipping(true)).has(WHITE_EDGE)).toBe(true);
    expect(fills(flipping(false))).toEqual([COLORS.object, COLORS.object]);

    const ghost = (finishesOn: boolean): string[] => {
      const shell = FakeShell.withDocument(finished());
      shell.state = { ...shell.state, finishesOn };
      shell.ui({ type: "pickKind", kind: "chair" });
      shell.moveTo({ x: 4.5, y: 3.2 }); // free floor in Room 2
      return fills(layer(shell.scene(), "overlays"));
    };
    expect(ghost(true)).toEqual([COLORS.ghostFillOnFinish]);
    expect(COLORS.ghostFillOnFinish).toBe("#ffffffcc"); // white at the grey ghost's alpha
    expect(ghost(false)).toEqual([COLORS.ghostFill]);
  });

  it("tiles stay grey, a rug's in its lighter fill", () => {
    for (const k of PALETTE.flatMap((g) => g.cards)) {
      const [fill] = tileLook(k);
      expect(fill, k.kind).toMatchObject({ kind: "polygon", color: isRug(k.kind) || k.kind === "sofaAndRug" ? COLORS.rug : COLORS.object }); // that set's first piece is its rug
    }
  });
});
