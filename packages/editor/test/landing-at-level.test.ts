import { describe, expect, it } from "vitest";
import { emptyDocument, placementRange, rectangleRoom, validateDocument, type Command, type Document, type Placement } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { viewedLevel } from "../src/state";
import type { ObjectGhost } from "../src/tools/types";
import { COLORS } from "../src/view/colors";
import { liveDistances } from "../src/view/distances";
import { handles } from "../src/view/handles";
import type { Primitive } from "../src/view/scene-types";
import { jointAt, wallBetween, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";

// Placing at a level (spec "Placing at a level", levels.08, .16, .19; AC-07): the Object tool's ghost and drawn
// footprint, single-piece drags and the rotation grip land by the viewed level. At an upper level with none of its
// decks under the centre the ghost or dragged piece is red and the click or drop sends nothing, with "No floor at
// +2.15 here". At an upper level contact snaps ignore walls whose top is at or below it, and guides and live
// distances ignore the pieces it doesn't show.
//
// The studio of landing-gestures.test.ts under a 3.20 ceiling (floor cut 1.20, loft cut 2.675): 7 × 2.5 on its centre
// lines, inner faces x 0.1–6.9, y 0.1–2.4. A 2.03 partition on x = 2 (faces 1.9–2.1); the loft (hollow, top 2.15,
// underside 2.03) at x 0.1–3.6, y 0.1–2.4, over the partition; the platform (solid, 0.45) at x 4.5–6.9, y 0.1–1.4.
// A default bed (1.70 × 2.10, 1.00 high) fits on the loft (2.15–3.15) and under it (0.00–1.00). The tests set the snap
// step to 0.10; the snap tolerance is 0.125 m.

const LOFT = "loft/k0";
const PLAT = "plat/k0";
const MATTRESS = "bed/p0";
const NO_FLOOR = "No floor at +2.15 here";

function studio(...more: Command[]): Document {
  return studioWith([], ...more);
}

/** The studio with `before` applied before the loft and the platform are added (a half wall under the loft). */
function studioWith(before: readonly Command[], ...more: Command[]): Document {
  let doc = withCommands(emptyDocument(), ...rectangleRoom({ x: 0, y: 0 }, 7, 2.5, "st"), { type: "addWall", opId: "part", from: { at: { x: 2, y: 0 } }, to: { at: { x: 2, y: 2.5 } } }, ...before);
  const partition = wallBetween(doc, { x: 2, y: 0 }, { x: 2, y: 2.5 });
  const bottom = wallBetween(doc, { x: 2, y: 0 }, { x: 7, y: 0 });
  const fromLeft = doc.walls[bottom]?.a === jointAt(doc, { x: 2, y: 0 });
  doc = withCommands(
    doc,
    { type: "setWallTop", wallId: partition, top: 2.03 },
    { type: "setCeiling", height: 3.2 },
    { type: "addDeck", opId: "loft", preset: "loft", at: { x: 1.85, y: 1.25 }, w: 3.5, d: 2.3 },
    { type: "addDeck", opId: "plat", preset: "platform", at: { x: 5.7, y: 0.75 }, w: 2.4, d: 1.3 },
    { type: "addOpening", opId: "win", wall: bottom, kind: "window", offset: fromLeft ? 3.7 : 1.3 },
  );
  return withCommands(doc, ...more);
}

const place = (opId: string, kind: string, at: Point, deck: string | null): Command => ({ type: "placeObject", opId, state: "s0", object: { kind }, at, rotation: 0, deck });

/** A 1.30 × 1.20 mattress, 0.35 high, on the loft at x 0.35–1.65, y 1.2–2.4 (its back to the top wall). */
const MATTRESS_ON_LOFT: Command[] = [
  { type: "placeObject", opId: "bed", state: "s0", object: { kind: "bed", size: { w: 1.3, d: 1.2 } }, at: { x: 3, y: 2.4 }, deck: null },
  { type: "setObjectSize", objectId: "bed/o0", w: 1.3, d: { standard: 1.2 }, h: { standard: 0.35 } },
  { type: "movePlacement", placementId: MATTRESS, at: { x: 1, y: 2.4 }, rotation: 0, deck: LOFT },
];
const ON_MATTRESS = { x: 1, y: 1.8 };

/**
 * The drawing with every piece on the loft standing on the floor under it instead, at the same place: the floor level
 * edits only its own pieces (shown.02), so a contrast at the floor drags a floor twin of the loft's piece.
 */
const floorTwin = (doc: Document): Document => ({
  ...doc,
  placements: Object.fromEntries(Object.entries(doc.placements).map(([id, p]) => [id, p.deck === LOFT ? { ...p, deck: null } : p])),
});

/** The studio open in a server-mode editor (so nothing sent is countable), snap step 0.10, viewing the loft or the floor. */
function open(doc: Document, at: "loft" | "floor"): FakeRemote {
  expect(validateDocument(doc)).toEqual({ ok: true, value: undefined });
  const r = FakeRemote.open(doc);
  r.shell.ui({ type: "setSnapStep", step: 0.1 });
  if (at === "loft") r.shell.ui({ type: "setViewedLevel", deck: LOFT });
  expect(viewedLevel(r.shell.state)?.height).toBe(at === "loft" ? 2.15 : 0);
  return r;
}

const ghost = (r: FakeRemote): ObjectGhost | null => (r.shell.state.tool.name === "object" ? r.shell.state.tool.state.ghost : null);
const overlays = (r: FakeRemote): readonly Primitive[] => r.shell.scene().layers.find((l) => l.name === "overlays")?.primitives ?? [];
const redFills = (r: FakeRemote): Primitive[] => overlays(r).filter((p) => p.kind === "polygon" && p.color === COLORS.invalidFill);
const guideLines = (r: FakeRemote): Primitive[] => overlays(r).filter((p) => p.kind === "segment" && p.color === COLORS.snapGuide);
const ofKind = (r: FakeRemote, kind: string): Placement[] => Object.values(r.shell.doc().placements).filter((p) => r.shell.doc().objects[p.object]?.kind === kind);
const pin = (p: Placement | undefined) => (p ? { at: p.at, rotation: p.rotation, deck: p.deck, state: p.state } : null);
const moving = (r: FakeRemote) => (r.shell.state.tool.name === "select" && r.shell.state.tool.state.kind === "moving" ? r.shell.state.tool.state : null);

/** Presses at `from`, moves to `to` and leaves the button down. */
function holdDrag(r: FakeRemote, from: Point, to: Point): void {
  r.shell.moveTo(from);
  r.shell.down(from);
  r.shell.moveTo(to);
  expect(moving(r)).not.toBeNull();
}

describe("the Object tool at a level (AC-07)", () => {
  it("› at the loft, a bed clicked over the loft stands on it in the active layout", () => {
    const r = open(studio(), "loft");
    r.shell.ui({ type: "pickKind", kind: "bed" });
    r.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.15, top: 3.15 } });
    r.shell.click({ x: 1, y: 1.25 });
    const [bed, ...more] = ofKind(r, "bed");
    expect(more).toEqual([]);
    expect(bed).toMatchObject({ deck: LOFT, state: "s0" });
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.view().toast).toBeNull();
  });

  it("› under 2.85: a bed clicked over the loft is refused with its top and the ceiling; a mattress stands on it (AC-07)", () => {
    const r = open(studio({ type: "setCeiling", height: 2.85 }), "loft"); // its 3/4, 0.75, reaches 2.90
    r.shell.ui({ type: "pickKind", kind: "bed" });
    r.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: false });
    r.shell.click({ x: 1, y: 1.25 });
    expect(r.submits()).toEqual([]);
    expect(ofKind(r, "bed")).toEqual([]);
    expect(r.shell.view().toast).toBe("Bed reaches 3.15 m in Layout; the ceiling is 2.85 m");
    r.shell.key("Escape");
    r.shell.ui({ type: "pickKind", kind: "mattress" });
    r.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.15, top: 2.4 } });
    r.shell.click({ x: 1, y: 1.25 });
    expect(ofKind(r, "mattress")).toMatchObject([{ deck: LOFT, state: "s0" }]);
    expect(r.submits()).toHaveLength(1);
  });

  it("› the sample Studio at 3.05: a bed clicked over the loft lowers to 0.90 and stands on it (clarity.11)", () => {
    const r = open(studio({ type: "setCeiling", height: 3.05 }), "loft");
    r.shell.ui({ type: "pickKind", kind: "bed" });
    r.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.15, top: 3.05 }, lowered: { h: 0.9, from: 1, under: null } });
    r.shell.click({ x: 1, y: 1.25 });
    expect(ofKind(r, "bed")).toMatchObject([{ deck: LOFT, state: "s0" }]);
    expect(Object.values(r.shell.doc().objects).map((o) => o.h.standard)).toEqual([0.9]);
    expect(r.shell.view().toast).toBeNull();
  });

  it("› at the loft, a bed clicked beside the loft: no submit effect, toast \"No floor at +2.15 here\", ghost not fitting", () => {
    // Centre (5.2, 1.3), over the main room's free floor and the platform's edge: no deck of +2.15 under it.
    const r = open(studio(), "loft");
    r.shell.ui({ type: "pickKind", kind: "bed" });
    r.shell.moveTo({ x: 5.2, y: 1.3 });
    expect(ghost(r)).toMatchObject({ fits: false });
    expect(redFills(r)).toHaveLength(1);
    r.shell.click({ x: 5.2, y: 1.3 });
    expect(r.submits()).toEqual([]);
    expect(ofKind(r, "bed")).toEqual([]);
    expect(r.shell.view().toast).toBe(NO_FLOOR);
    expect(ghost(r)).toMatchObject({ fits: false }); // the tool stays armed, its ghost still red
  });

  it("› at the loft, a nightstand over free floor beside the loft is red with no floor; at the floor the same ghost fits", () => {
    // Centre (4, 1.8): the main room's open floor, clear of the platform and every wall, so only the level refuses it.
    const loft = open(studio(), "loft");
    loft.shell.ui({ type: "pickKind", kind: "nightstand" });
    loft.shell.moveTo({ x: 4, y: 1.8 });
    expect(ghost(loft)).toMatchObject({ fits: false, noFloor: true });
    expect(redFills(loft)).toHaveLength(1);
    const floor = open(studio(), "floor");
    floor.shell.ui({ type: "pickKind", kind: "nightstand" });
    floor.shell.moveTo({ x: 4, y: 1.8 });
    expect(ghost(floor)).toMatchObject({ fits: true, surface: null });
    expect(ghost(floor)?.noFloor).toBeUndefined();
    expect(redFills(floor)).toEqual([]);
  });

  it("› at the loft, a footprint drawn beside the loft is refused the same way", () => {
    const r = open(studio(), "loft");
    r.shell.ui({ type: "pickKind", kind: "block" });
    r.shell.moveTo({ x: 4.8, y: 1.6 });
    r.shell.down({ x: 4.8, y: 1.6 });
    r.shell.moveTo({ x: 5.6, y: 2.2 });
    expect(ghost(r)).toMatchObject({ fits: false, noFloor: true });
    expect(redFills(r)).toHaveLength(1);
    r.shell.up({ x: 5.6, y: 2.2 });
    expect(r.submits()).toEqual([]);
    expect(r.shell.view().toast).toBe(NO_FLOOR);
    // Drawn over the loft, it stands on it.
    r.shell.drag({ x: 2.6, y: 0.6 }, { x: 3.2, y: 1.2 });
    expect(ofKind(r, "block").map((p) => p.deck)).toEqual([LOFT]);
  });

  it("› at the loft, the Object tool's ghost after a collaborator raises the loft to 2.30 lands at the new height (levels.43)", () => {
    const r = open(studio(), "loft");
    r.shell.ui({ type: "pickKind", kind: "nightstand" });
    r.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.15 } });
    r.shell.down({ x: 1, y: 1.25 });
    r.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(viewedLevel(r.shell.state)?.height).toBe(2.3);
    r.shell.up({ x: 1, y: 1.25 });
    expect(ghost(r)).toMatchObject({ fits: true, surface: LOFT, range: { bottom: 2.3 } });
    const [stand] = ofKind(r, "nightstand");
    expect(stand?.deck).toBe(LOFT);
    expect(stand ? placementRange(r.shell.doc(), stand.id)?.bottom : null).toBe(2.3);
    expect(r.submits()).toHaveLength(1);
  });

  it("› at the floor, a desk under the loft stands on the floor; a chair on the platform stands on it; a bed over the loft with the floor blocked is refused with validation's text (AC-07)", () => {
    const r = open(studio(), "floor");
    r.shell.ui({ type: "pickKind", kind: "desk" });
    r.shell.click({ x: 2.9, y: 1.25 });
    expect(ofKind(r, "desk").map((p) => p.deck)).toEqual([null]);
    r.accept(); // one edit in flight at a time
    r.shell.ui({ type: "pickKind", kind: "chair" });
    r.shell.click({ x: 5.7, y: 0.9 });
    expect(ofKind(r, "chair").map((p) => p.deck)).toEqual([PLAT]);

    // A desk takes the sleeping end's floor (x 0.4–1.6, y 1.8–2.4). The bed there lies wholly over the loft, which
    // would take it (2.15–3.15), but the loft is not a candidate at the floor (levels.08): validation's refusal.
    const blocked = open(studio(place("desk", "desk", { x: 1, y: 2.4 }, null)), "floor");
    blocked.shell.ui({ type: "pickKind", kind: "bed" });
    blocked.shell.moveTo({ x: 1, y: 1.25 });
    expect(ghost(blocked)).toMatchObject({ fits: false, surface: null });
    blocked.shell.click({ x: 1, y: 1.25 });
    expect(ofKind(blocked, "bed")).toEqual([]);
    expect(blocked.shell.view().toast).toBe("Bed (0.00–1.00) and Desk (0.00–0.75) overlap in Layout");
  });
});

describe("dragging one piece at a level", () => {
  it("› at the loft, dragging the mattress off the loft's edge: refused the same way, nothing sent", () => {
    // To x 3.85–5.15, centre (4.5, 1.8): past the loft's edge at 3.6.
    const r = open(studio(...MATTRESS_ON_LOFT), "loft");
    holdDrag(r, ON_MATTRESS, { x: 4.5, y: 1.8 });
    expect(moving(r)?.attempt.ok).toBe(false);
    expect(redFills(r)).toHaveLength(1);
    r.shell.up({ x: 4.5, y: 1.8 });
    expect(r.submits()).toEqual([]);
    expect(r.shell.view().toast).toBe(NO_FLOOR);
    expect(pin(r.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
  });

  it("› at the loft, dragged along the loft it stays on it and commits", () => {
    const r = open(studio(...MATTRESS_ON_LOFT), "loft");
    r.shell.drag(ON_MATTRESS, { x: 2.9, y: 1.8 });
    expect(pin(r.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 2.9, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
    expect(r.submits()).toHaveLength(1);
  });

  it("› at the floor, a press on the loft's mattress takes the loft, and a drag there leaves the mattress where it is", () => {
    // The mattress belongs to the loft (shown.02): the floor neither draws nor grabs it.
    const r = open(studio(...MATTRESS_ON_LOFT), "floor");
    r.shell.click(ON_MATTRESS);
    expect(r.shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
    expect(pin(r.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
  });

  it("› at the loft, the rotation grip turning a piece past the loft's edge is refused by validation, not landed on the floor", () => {
    // A desk on the loft at rotation 90, x 3.0–3.6, y 0.7–1.9; a quarter turn about (3.3, 1.3) makes it x 2.7–3.9: it
    // hangs past the loft's edge. A turn keeps the centre, which stays on the loft, so the loft is still the level's
    // candidate (never "none"); at the floor the same turn lands it on the floor (landing-gestures.test.ts).
    const r = open(studio({ type: "placeObject", opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 3, y: 1.3 }, rotation: 90, deck: LOFT }), "loft");
    const centre = { x: 3.3, y: 1.3 };
    r.shell.click(centre);
    const grip = handles(r.shell.state, r.shell.doc()).find((h) => h.kind === "rotate")?.at;
    if (!grip) throw new Error("no rotation grip");
    const to = { x: centre.x - (grip.y - centre.y), y: centre.y + (grip.x - centre.x) };
    holdDrag(r, grip, to);
    expect(moving(r)?.attempt.tried).toMatchObject({ kind: "place", rotation: 180, deck: LOFT });
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
    expect(r.shell.view().toast).toBe("Desk lies outside Loft in Layout");
    expect(r.shell.doc().placements["d/p0"]).toMatchObject({ rotation: 90, deck: LOFT });
  });

  it("› at the loft, dragging the mattress towards the 2.03 partition does not snap flush to it; at the floor it does", () => {
    // 0.20 m right: x 0.55–1.85, its right side 0.05 from the partition's face at 1.9.
    const loft = open(studio(...MATTRESS_ON_LOFT), "loft");
    loft.shell.drag(ON_MATTRESS, { x: 1.2, y: 1.8 });
    expect(pin(loft.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1.2, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
    const floor = open(floorTwin(studio(...MATTRESS_ON_LOFT)), "floor");
    floor.shell.drag(ON_MATTRESS, { x: 1.2, y: 1.8 });
    expect(pin(floor.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1.25, y: 2.4 }, rotation: 0, deck: null, state: "s0" });
  });

  it("› at the loft, guides align only to the loft's pieces (a sofa on the floor in line gives no guide)", () => {
    // The sofa on the floor at x 4.35–6.45, y 1.5–2.4. The mattress dragged 0.80 m down, to y 0.4–1.6: its top edge
    // 0.10 from the sofa's bottom edge, away from every wall face.
    const doc = studio(...MATTRESS_ON_LOFT, place("sofa", "sofa", { x: 5.4, y: 2.4 }, null));
    const loft = open(doc, "loft");
    holdDrag(loft, ON_MATTRESS, { x: 1, y: 1 });
    expect(moving(loft)?.attempt.guides).toEqual([]);
    loft.shell.up({ x: 1, y: 1 });
    expect(loft.shell.doc().placements[MATTRESS]?.at).toEqual({ x: 1, y: 1.6 });

    const floor = open(floorTwin(doc), "floor");
    holdDrag(floor, ON_MATTRESS, { x: 1, y: 1 });
    expect(moving(floor)?.attempt.guides).not.toEqual([]);
    floor.shell.up({ x: 1, y: 1 });
    expect(floor.shell.doc().placements[MATTRESS]?.at).toEqual({ x: 1, y: 1.5 });

    // Dragged 0.90 m down, to y 0.3–1.5: its top edge exactly on the sofa's bottom edge. The drawn guide shows only
    // at the floor.
    const onLine = open(doc, "loft");
    holdDrag(onLine, ON_MATTRESS, { x: 1, y: 0.9 });
    expect(moving(onLine)?.attempt.guides).toEqual([]);
    expect(guideLines(onLine)).toEqual([]);
    const onLineFloor = open(floorTwin(doc), "floor");
    holdDrag(onLineFloor, ON_MATTRESS, { x: 1, y: 0.9 });
    expect(moving(onLineFloor)?.attempt.guides).not.toEqual([]);
    expect(guideLines(onLineFloor)).not.toEqual([]);
  });

  it("› at the loft, live distances ignore the pieces the level doesn't show", () => {
    // The mattress dragged right to x 2.25–3.55 (y 1.2–2.4): a desk on the floor under the loft at x 3.9–5.1 faces
    // its right side, which at the loft measures to the end wall instead.
    const doc = studio(...MATTRESS_ON_LOFT, place("desk", "desk", { x: 4.5, y: 2.4 }, null));
    const ends = (r: FakeRemote): number[] => liveDistances(r.shell.state, moving(r)?.attempt.doc ?? null).map((l) => Math.round(l.to.x * 100) / 100);
    const loft = open(doc, "loft");
    holdDrag(loft, ON_MATTRESS, { x: 2.9, y: 1.8 });
    expect(ends(loft)).not.toContain(3.9);
    const floor = open(floorTwin(doc), "floor");
    holdDrag(floor, ON_MATTRESS, { x: 2.9, y: 1.8 });
    expect(ends(floor)).toContain(3.9);
  });
});

describe("group edits keep each piece's surface at any level", () => {
  it("› a group drag of two loft pieces at the loft keeps both on the loft", () => {
    // Two nightstands on the loft: a at x 0.775–1.225 (sleeping end), b at x 2.775–3.225 over the main room's floor.
    const r = open(studio(place("a", "nightstand", { x: 1, y: 2.4 }, LOFT), place("b", "nightstand", { x: 3, y: 2.4 }, LOFT)), "loft");
    r.shell.click({ x: 1, y: 2.2 });
    r.shell.click({ x: 3, y: 2.2 }, { shift: true });
    r.shell.drag({ x: 3, y: 2.2 }, { x: 3, y: 1.7 });
    expect(pin(r.shell.doc().placements["a/p0"])).toEqual({ at: { x: 1, y: 1.9 }, rotation: 0, deck: LOFT, state: "s0" });
    expect(pin(r.shell.doc().placements["b/p0"])).toEqual({ at: { x: 3, y: 1.9 }, rotation: 0, deck: LOFT, state: "s0" });
  });
});

describe("what an upper level hides from the snaps (levels.19)", () => {
  /** To the millimetre, so float noise doesn't hide a 1 mm snap. */
  const cm = (v: number): number => Math.round(v * 1000) / 1000;

  it("› at the loft, a corner box beside the 2.03 partition is not turned into its corner; at the floor it is", () => {
    // Centre (1.6, 2.08): its right side 0.0 from the partition's face at 1.9 once pushed back to the top wall.
    const loft = open(studio(), "loft");
    loft.shell.ui({ type: "pickKind", kind: "cornerBlock" });
    loft.shell.moveTo({ x: 1.6, y: 2.08 });
    expect(ghost(loft)).toMatchObject({ at: { x: 1.6, y: 2.4 }, rotation: 0, surface: LOFT, fits: true });
    const floor = open(studio(), "floor");
    floor.shell.ui({ type: "pickKind", kind: "cornerBlock" });
    floor.shell.moveTo({ x: 1.6, y: 2.08 });
    expect(ghost(floor)).toMatchObject({ rotation: 270 });
  });

  it("› at the loft, a corner basin dragged next to the partition keeps its turn", () => {
    // On the loft at x 1.35–1.8, its back to the top wall; 0.10 m right puts its right side 0.0 from the face at 1.9.
    const doc = studio({ type: "placeObject", opId: "cb", state: "s0", object: { kind: "cornerBasin" }, at: { x: 1.575, y: 2.4 }, rotation: 0, deck: LOFT });
    const loft = open(doc, "loft");
    holdDrag(loft, { x: 1.575, y: 2.2 }, { x: 1.675, y: 2.2 });
    expect(moving(loft)?.attempt.tried).toMatchObject({ kind: "place", at: { x: 1.675, y: 2.4 }, rotation: 0, deck: LOFT });
    const floor = open(floorTwin(doc), "floor");
    holdDrag(floor, { x: 1.575, y: 2.2 }, { x: 1.675, y: 2.2 });
    expect(moving(floor)?.attempt.tried).toMatchObject({ kind: "place", rotation: 270 });
  });

  it("› at the loft, the rotation grip doesn't snap parallel to a half wall under the loft; at the floor it does", () => {
    // A 1.00 m half wall (0.4, 0.4)→(1.2, 0.9), at 32°, under the loft; a desk on the loft at x 0.6–1.8, y 1.0–1.6.
    // A 31° turn of the grip snaps to the 15° step at the loft and to the wall's 32° at the floor.
    const halfWall: Command[] = [
      { type: "addWall", opId: "sl", from: { at: { x: 0.4, y: 0.4 } }, to: { at: { x: 1.2, y: 0.9 } } },
      { type: "setWallTop", wallId: "sl/w0", top: 1 },
    ];
    const doc = studioWith(halfWall, { type: "placeObject", opId: "d", state: "s0", object: { kind: "desk" }, at: { x: 1.2, y: 1.6 }, rotation: 0, deck: LOFT });
    const turn = (r: FakeRemote): unknown => {
      const centre = { x: 1.2, y: 1.3 };
      r.shell.click(centre);
      const grip = handles(r.shell.state, r.shell.doc()).find((h) => h.kind === "rotate")?.at;
      if (!grip) throw new Error("no rotation grip");
      const t = (31 * Math.PI) / 180;
      const v = { x: grip.x - centre.x, y: grip.y - centre.y };
      holdDrag(r, grip, { x: centre.x + v.x * Math.cos(t) - v.y * Math.sin(t), y: centre.y + v.x * Math.sin(t) + v.y * Math.cos(t) });
      return moving(r)?.attempt.tried;
    };
    expect(turn(open(doc, "loft"))).toMatchObject({ kind: "place", rotation: 30, deck: LOFT });
    expect(turn(open(floorTwin(doc), "floor"))).toMatchObject({ kind: "place", rotation: 32 });
  });

  it("› at the loft, a footprint drawn up to the partition's face keeps its drawn corner; at the floor it snaps to the face", () => {
    const loft = open(studio(), "loft");
    loft.shell.ui({ type: "pickKind", kind: "block" });
    loft.shell.drag({ x: 1.3, y: 0.6 }, { x: 1.83, y: 1.2 });
    const [drawn] = ofKind(loft, "block");
    expect(drawn?.deck).toBe(LOFT);
    expect(drawn ? loft.shell.doc().objects[drawn.object]?.w : null).toEqual({ standard: 0.53 });
    const floor = open(studio(), "floor");
    floor.shell.ui({ type: "pickKind", kind: "block" });
    floor.shell.drag({ x: 1.3, y: 0.6 }, { x: 1.83, y: 1.2 });
    const [snapped] = ofKind(floor, "block");
    expect(snapped ? floor.shell.doc().objects[snapped.object]?.w : null).toEqual({ standard: 0.6 });
  });

  it("› at the loft, the partition's face doesn't wall a drawn footprint's side; at the floor it does", () => {
    // With Ctrl (no corner snaps, no contact turn), x 1.0–1.9 across the room: the top and bottom faces wall two sides
    // at both levels; the partition's face walls the right side only at the floor, leaving one open side there.
    const held = (at: "loft" | "floor"): ObjectGhost | null => {
      const r = open(studio(), at);
      r.shell.ui({ type: "pickKind", kind: "block" });
      r.shell.moveTo({ x: 1, y: 0.1 }, { ctrl: true });
      r.shell.down({ x: 1, y: 0.1 }, { ctrl: true });
      r.shell.moveTo({ x: 1.9, y: 2.4 }, { ctrl: true });
      return ghost(r);
    };
    expect(held("loft")).toMatchObject({ rotation: 0, w: 0.9 });
    expect(held("floor")).toMatchObject({ rotation: 270, w: 2.3 });
  });

  it("› at the loft, live distances don't measure to the 2.03 partition; at the floor they do", () => {
    // The mattress dragged 0.10 m right, to x 0.45–1.75: 0.15 from the partition's face at 1.9.
    const ends = (r: FakeRemote): number[] => liveDistances(r.shell.state, moving(r)?.attempt.doc ?? null).map((l) => cm(l.to.x));
    const loft = open(studio(...MATTRESS_ON_LOFT), "loft");
    holdDrag(loft, ON_MATTRESS, { x: 1.1, y: 1.8 });
    expect(ends(loft)).not.toContain(1.9);
    const floor = open(floorTwin(studio(...MATTRESS_ON_LOFT)), "floor");
    holdDrag(floor, ON_MATTRESS, { x: 1.1, y: 1.8 });
    expect(ends(floor)).toContain(1.9);
  });

  it("› at the loft, a 2.20 wardrobe on the floor beside the loft (drawn there) still counts for live distances and guides", () => {
    // The wardrobe at x 3.7–4.9, y 1.8–2.4, 2.20 high: its top is above the loft, so the loft draws it. The mattress
    // dragged to x 2.25–3.55 measures 0.15 to it at both levels.
    const wardrobe: Command[] = [
      place("ward", "wardrobe", { x: 4.3, y: 2.4 }, null),
      { type: "setObjectSize", objectId: "ward/o0", w: 1.2, d: { standard: 0.6 }, h: { standard: 2.2 } },
    ];
    const doc = studio(...MATTRESS_ON_LOFT, ...wardrobe);
    const right = (r: FakeRemote) => liveDistances(r.shell.state, moving(r)?.attempt.doc ?? null).find((l) => l.from.x > 3);
    for (const at of ["loft", "floor"] as const) {
      const r = open(at === "floor" ? floorTwin(doc) : doc, at);
      holdDrag(r, ON_MATTRESS, { x: 2.9, y: 1.8 });
      expect(cm(right(r)?.to.x ?? 0)).toBe(3.7);
      expect(cm(right(r)?.gap ?? 0)).toBe(0.15);
    }
    // Dragged 0.60 m down instead, to y 0.6–1.8: its top edge on the wardrobe's front edge, a guide at the loft too.
    const loft = open(doc, "loft");
    holdDrag(loft, ON_MATTRESS, { x: 1, y: 1.2 });
    expect(moving(loft)?.attempt.guides).not.toEqual([]);
    expect(guideLines(loft)).not.toEqual([]);
  });

  it("› at the loft, the Object tool's ghost in line with a floor desk under the loft shows no guide; at the floor it does", () => {
    // A desk on the floor at x 2.275–3.475, y 1.8–2.4; a nightstand ghost at (2.5, 1) has its left edge on the desk's.
    const doc = studio(place("desk", "desk", { x: 2.875, y: 2.4 }, null));
    const atGhost = (at: "loft" | "floor"): Primitive[] => {
      const r = open(doc, at);
      r.shell.ui({ type: "pickKind", kind: "nightstand" });
      r.shell.moveTo({ x: 2.5, y: 1 });
      expect(ghost(r)).toMatchObject({ fits: true });
      return guideLines(r);
    };
    expect(atGhost("loft")).toEqual([]);
    expect(atGhost("floor")).not.toEqual([]);
  });

  it("› at the loft, a piece next to the 2.03 partition still takes a guide across it", () => {
    // A loft nightstand at x 1.88–2.33 over the partition. The mattress dragged 0.20 m right (right edge 1.85, 0.05
    // from the partition's face at 1.9) aligns its right edge to the nightstand's left edge: the hidden partition
    // doesn't hold x.
    const doc = studio(...MATTRESS_ON_LOFT, place("ns", "nightstand", { x: 2.105, y: 0.6 }, LOFT));
    const loft = open(doc, "loft");
    loft.shell.drag(ON_MATTRESS, { x: 1.2, y: 1.8 });
    expect(pin(loft.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1.23, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
  });

  it("› at the loft, the duplicate's ghost doesn't snap flush to the 2.03 partition", () => {
    const loft = open(studio(...MATTRESS_ON_LOFT), "loft");
    loft.shell.click(ON_MATTRESS);
    loft.shell.key("d", { meta: true });
    loft.shell.moveTo({ x: 1.2, y: 1.8 });
    const t = loft.shell.state.tool;
    expect(t.name === "select" && t.state.kind === "copying" ? t.state.offset : null).toEqual({ x: 0.2, y: 0 });
  });
});

describe("edits that keep each piece's surface at an upper level", () => {
  it("› at the loft, a nudge run shows no guide to a floor desk under the loft; at the floor it does", () => {
    // A desk on the floor at x 0.36–1.56, y 0.1–0.7, under the loft. One ArrowRight puts the mattress's left edge at 0.36.
    const doc = studio(...MATTRESS_ON_LOFT, place("desk", "desk", { x: 0.96, y: 0.7 }, null));
    const nudged = (at: "loft" | "floor"): Primitive[] => {
      const r = open(at === "floor" ? floorTwin(doc) : doc, at);
      r.shell.click(ON_MATTRESS);
      r.shell.key("ArrowRight");
      return guideLines(r);
    };
    expect(nudged("loft")).toEqual([]);
    expect(nudged("floor")).not.toEqual([]);
  });

  it("› at the loft, the duplicate's ghost shows no guide to a floor desk under the loft; at the floor it does", () => {
    // A desk on the floor at x 2.25–3.45, y 0.1–0.7; the copy moved 1.90 m right lies at x 2.25–3.55 on the loft.
    const doc = studio(...MATTRESS_ON_LOFT, place("desk", "desk", { x: 2.85, y: 0.7 }, null));
    const copied = (at: "loft" | "floor"): readonly unknown[] => {
      const r = open(at === "floor" ? floorTwin(doc) : doc, at);
      r.shell.click(ON_MATTRESS);
      r.shell.key("d", { meta: true });
      r.shell.moveTo({ x: 2.9, y: 1.8 });
      const t = r.shell.state.tool;
      expect(t.name === "select" && t.state.kind === "copying" ? t.state.offset : null).toEqual({ x: 1.9, y: 0 });
      // The copy lines up with its original at both levels; only the desk gives a guide along x = 2.25.
      const guides = t.name === "select" && t.state.kind === "copying" ? t.state.attempt.guides : [];
      return guides.filter((g) => Math.abs(g.a.x - 2.25) < 1e-6 && Math.abs(g.b.x - 2.25) < 1e-6);
    };
    expect(copied("loft")).toEqual([]);
    expect(copied("floor")).not.toEqual([]);
  });

  it("› at the loft, a group drag of two loft pieces ignores a floor sofa's line", () => {
    // Nightstands a and b on the loft (backs at y 2.4); the sofa on the floor at x 4.35–6.45, y 1.45–2.35. Dragged
    // 0.53 m down, the group's bottom edge comes 0.02 from the sofa's: at the floor it aligns to it, at the loft not.
    const doc = studio(place("a", "nightstand", { x: 1, y: 2.4 }, LOFT), place("b", "nightstand", { x: 3, y: 2.4 }, LOFT), place("sofa", "sofa", { x: 5.4, y: 2.35 }, null));
    const groupDrag = (at: "loft" | "floor"): FakeRemote => {
      const r = open(at === "floor" ? floorTwin(doc) : doc, at);
      r.shell.click({ x: 1, y: 2.2 });
      r.shell.click({ x: 3, y: 2.2 }, { shift: true });
      r.shell.drag({ x: 3, y: 2.2 }, { x: 3, y: 1.67 });
      return r;
    };
    const loft = groupDrag("loft");
    expect(pin(loft.shell.doc().placements["a/p0"])).toEqual({ at: { x: 1, y: 1.9 }, rotation: 0, deck: LOFT, state: "s0" });
    expect(pin(loft.shell.doc().placements["b/p0"])).toEqual({ at: { x: 3, y: 1.9 }, rotation: 0, deck: LOFT, state: "s0" });
    expect(groupDrag("floor").shell.doc().placements["a/p0"]?.at).toEqual({ x: 1, y: 1.85 });
  });

  it("› at the loft, a duplicate, a nudge, a resize grip and a typed width keep the mattress on the loft", () => {
    const r = open(studio(...MATTRESS_ON_LOFT), "loft");
    r.shell.click(ON_MATTRESS);
    r.shell.key("d", { meta: true });
    r.shell.click({ x: 2.9, y: 1.8 });
    const copy = Object.values(r.shell.doc().placements).find((p) => p.id !== MATTRESS);
    expect(pin(copy)).toEqual({ at: { x: 2.9, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
    r.accept();

    r.shell.key("Escape");
    r.shell.click(ON_MATTRESS);
    r.shell.key("ArrowRight");
    r.shell.host.advance(400);
    r.shell.fireTimer("nudge");
    expect(pin(r.shell.doc().placements[MATTRESS])).toEqual({ at: { x: 1.01, y: 2.4 }, rotation: 0, deck: LOFT, state: "s0" });
    r.accept();

    const grip = handles(r.shell.state, r.shell.doc()).find((h) => h.kind === "side" && h.side === "right");
    if (!grip) throw new Error("no right grip");
    r.shell.drag(grip.at, { x: grip.at.x + 0.1, y: grip.at.y });
    expect(r.shell.doc().objects["bed/o0"]?.w).toEqual({ standard: 1.4 });
    expect(r.shell.doc().placements[MATTRESS]?.deck).toBe(LOFT);
    r.accept();

    r.shell.ui({ type: "setField", fieldId: "width", value: "1.20" });
    expect(r.shell.doc().objects["bed/o0"]?.w).toEqual({ standard: 1.2 });
    expect(r.shell.doc().placements[MATTRESS]?.deck).toBe(LOFT);
  });
});
