import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { viewedLevel } from "../src/state";
import { zoneChips } from "../src/view/zone-chips";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";

// The viewed level falls back to the floor (spec "Levels", last paragraph; levels.09, .19, .31; AC-08): when the
// viewed deck is deleted or is no longer a level, a gesture in progress is cancelled, nothing is sent and the viewed
// deck is forgotten, so the view stays at the floor if the deck comes back. Following a raised deck keeps both.

const LOFT = "loft/k0";
const BUNK = "bunk/k0";
const MATTRESS = "bed/p0";
const loft = (opId: string, at: Point, more: Partial<Extract<Command, { type: "addDeck" }>> = {}): Command =>
  ({ type: "addDeck", opId, preset: "loft", at, w: 2, d: 1.6, ...more });
const onDeck = (opId: string, deck: string, at: Point): Command[] => [
  { type: "placeObject", deck: null, opId, state: "s0", object: { kind: "bed", size: { w: 0.9, d: 1.2 } }, at: { x: 3, y: 2 } },
  { type: "setObjectSize", objectId: `${opId}/o0`, w: 0.9, d: { standard: 1.2 }, h: { standard: 0.3 } },
  { type: "movePlacement", placementId: `${opId}/p0`, at, rotation: 0, deck },
];

/**
 * The 5.8 × 3.8 room (roomDoc) under a 2.80 ceiling, so a mattress on a 2.30 loft fits: an empty Loft (top 2.15) at
 * x 0.4–2.4, y 1.4–3.0 and a sofa on the floor at x 3.55–5.65, y 0.1–1.0. A piece's `at` is its back edge's middle; a
 * mattress is placed on the floor beside the loft, then moved onto its deck.
 */
const loftDoc = (...more: Command[]): Document => withCommands(
  roomDoc(),
  { type: "setCeiling", height: 2.8 },
  loft("loft", { x: 1.4, y: 2.2 }),
  { type: "placeObject", deck: null, opId: "sofa", state: "s0", object: { kind: "sofa" }, at: { x: 4.6, y: 1 } },
  ...more,
);
/** With a 0.90 × 1.20 mattress, 0.30 high, on the loft at x 0.95–1.85, y 1.6–2.8. */
const withBed = (): Document => loftDoc(...onDeck("bed", LOFT, { x: 1.4, y: 2.8 }));
/** With a second 2.15 deck, Bunk, at x 3.4–5.4, y 2.0–3.6 carrying a mattress at x 3.95–4.85, y 2.2–3.4. */
const withBunk = (): Document => loftDoc(loft("bunk", { x: 4.4, y: 2.8 }, { name: "Bunk" }), ...onDeck("bunk-bed", BUNK, { x: 4.4, y: 3.4 }));

const ON_MATTRESS = { x: 1.4, y: 2.2 };
const ON_BUNK_MATTRESS = { x: 4.4, y: 2.6 };
const LOFT_TOP = { x: 0.7, y: 2.9 }; // the loft's empty top
const BUNK_TOP = { x: 3.6, y: 3.5 }; // Bunk's empty top
const height = (shell: FakeShell): number | undefined => viewedLevel(shell.state)?.height;
const idleSelect = { name: "select", state: { kind: "idle" } };

function atLoft(doc: Document = loftDoc()): FakeRemote {
  const r = FakeRemote.open(doc);
  r.shell.ui({ type: "setViewedLevel", deck: LOFT });
  expect(height(r.shell)).toBeGreaterThan(0);
  return r;
}

/** Presses at `from` and drags 0.1 m down. */
function dragFrom(r: FakeRemote, from: Point): Point {
  const to = { x: from.x, y: from.y - 0.1 };
  r.shell.moveTo(from);
  r.shell.down(from);
  r.shell.moveTo(to);
  expect(r.shell.state.tool.state.kind).toBe("moving");
  return to;
}

describe("a fallback to the floor cancels a gesture (AC-08)", () => {
  it("› at the loft, a collaborator deletes the loft mid-drag of it: the drag is cancelled, nothing is sent, the view is the floor", () => {
    // The delete writes the dragged loft, so the remote-change rule (spec: tools) cancels this drag; the next test
    // drags a piece the delete doesn't touch, which only the fallback cancels.
    const r = atLoft();
    r.shell.click(LOFT_TOP);
    const to = dragFrom(r, LOFT_TOP); // the selected loft's body: a deck drag
    r.remote({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(r.shell.state.tool).toEqual(idleSelect);
    expect(r.shell.state.toast?.text).toBe("Drawing changed remotely");
    expect(height(r.shell)).toBe(0);
    expect(r.shell.state.viewedDeck).toBeNull();
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
  });

  it("› the same when the drag is of a piece on another deck of the level, which the delete doesn't touch", () => {
    // Viewed through the Loft's id, the level +2.15 holds Loft and Bunk; deleting Loft returns the view to the floor
    // (the spec's "the deck is deleted"), so the drag of Bunk's mattress, which doesn't depend on Loft, ends too.
    const r = atLoft(withBunk());
    const to = dragFrom(r, ON_BUNK_MATTRESS);
    r.remote({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(height(r.shell)).toBe(0);
    expect(r.shell.state.tool).toEqual(idleSelect);
    expect(r.shell.state.toast).toBeNull(); // the fallback ended it, not the remote-change rule
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
  });

  it("› the same mid box-select and mid Object-tool press", () => {
    const box = atLoft(withBed());
    box.shell.moveTo({ x: -1, y: -1 });
    box.shell.down({ x: -1, y: -1 });
    box.shell.moveTo({ x: 7, y: 5 });
    expect(box.shell.state.tool.state.kind).toBe("box");
    box.remote({ type: "setDeck", deckId: LOFT, top: 1 });
    expect(height(box.shell)).toBe(0);
    expect(box.shell.state.tool).toEqual(idleSelect);
    box.shell.up({ x: 7, y: 5 }); // at the floor this box would select the sofa and the mattress
    expect(box.shell.state.selection).toEqual([]);

    const press = atLoft();
    press.shell.ui({ type: "pickKind", kind: "chair" });
    press.shell.moveTo({ x: 1.4, y: 2.2 });
    press.shell.down({ x: 1.4, y: 2.2 });
    press.remote({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(height(press.shell)).toBe(0);
    expect(press.shell.state.tool).toEqual({ name: "object", state: { kind: "idle", ghost: null, rotation: 0, pressing: null, stair: null, preview: null, offer: null } });
    press.shell.up({ x: 1.4, y: 2.2 }); // at the floor this click would place a chair
    expect(press.submits()).toEqual([]);
  });

  it("› a nudge run of Bunk's mattress ends uncommitted when Bob lowers the viewed Loft to 1.00", () => {
    const r = atLoft(withBunk());
    r.shell.click(ON_BUNK_MATTRESS);
    r.shell.key("ArrowDown");
    expect(r.shell.state.tool.state.kind).toBe("nudging");
    r.remote({ type: "setDeck", deckId: LOFT, top: 1 });
    expect(height(r.shell)).toBe(0);
    expect(r.shell.state.tool).toEqual(idleSelect);
    r.shell.fireTimer("nudge"); // an open run would commit here
    expect(r.submits()).toEqual([]);
  });

  it("› a collaborator raises the loft to 2.30 mid-gesture: the view follows; a box continues and selects at 2.30, a drag of the loft's mattress ends by the remote-change rule", () => {
    // A box reads the document only at its release, so it continues and selects the mattress at 2.30.
    const box = atLoft(withBed());
    box.shell.moveTo({ x: -1, y: -1 });
    box.shell.down({ x: -1, y: -1 });
    box.shell.moveTo({ x: 7, y: 5 });
    box.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(height(box.shell)).toBe(2.3);
    expect(box.shell.state.viewedDeck).toBe(LOFT);
    expect(box.shell.state.tool.state.kind).toBe("box");
    box.shell.up({ x: 7, y: 5 });
    expect(box.shell.state.selection).toEqual([{ table: "placements", id: MATTRESS }]);

    // A drag of the mattress reads the loft, so Bob's write to it ends the drag by the remote-change rule (spec: tools,
    // "Drawing changed remotely"), as before this cycle; the view still follows the loft and the selection stays.
    const drag = atLoft(withBed());
    const to = dragFrom(drag, ON_MATTRESS);
    drag.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(height(drag.shell)).toBe(2.3);
    expect(drag.shell.state.toast?.text).toBe("Drawing changed remotely");
    expect(drag.shell.state.selection).toEqual([{ table: "placements", id: MATTRESS }]);
    drag.shell.up(to);
    expect(drag.submits()).toEqual([]);
  });

  it("› when the view follows the Loft to 2.30, a drag, nudge run or duplicate ghost of Bunk's mattress (still at 2.15) ends uncommitted", () => {
    // Bob's write to Loft isn't a dependency of these gestures, so the remote-change rule leaves them; the piece they
    // act on is no longer at the viewed level, so following the deck drops them (levels.40). No toast: the view moved.
    const drag = atLoft(withBunk());
    const to = dragFrom(drag, ON_BUNK_MATTRESS);
    drag.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(height(drag.shell)).toBe(2.3);
    expect(drag.shell.state.viewedDeck).toBe(LOFT);
    expect(drag.shell.state.tool).toEqual(idleSelect);
    expect(drag.shell.state.toast).toBeNull();
    drag.shell.up(to);
    expect(drag.submits()).toEqual([]);

    const nudge = atLoft(withBunk());
    nudge.shell.click(ON_BUNK_MATTRESS);
    nudge.shell.key("ArrowDown");
    expect(nudge.shell.state.tool.state.kind).toBe("nudging");
    nudge.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(nudge.shell.state.tool).toEqual(idleSelect);
    nudge.shell.fireTimer("nudge");
    expect(nudge.submits()).toEqual([]);

    const copy = atLoft(withBunk());
    copy.shell.click(ON_BUNK_MATTRESS);
    copy.shell.key("d", { meta: true });
    expect(copy.shell.state.tool.state.kind).toBe("copying");
    copy.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(copy.shell.state.tool).toEqual(idleSelect);
    copy.shell.click({ x: 1.4, y: 2.2 });
    expect(copy.submits()).toEqual([]);
  });

  it("› without the raise, the same drag of Bunk's mattress commits at 2.15 and keeps it selected", () => {
    const r = atLoft(withBunk());
    const to = dragFrom(r, ON_BUNK_MATTRESS);
    r.shell.up(to);
    expect(r.submits()).toHaveLength(1);
    expect(r.shell.state.selection).toEqual([{ table: "placements", id: "bunk-bed/p0" }]);
  });

  it("› raising the ceiling so the loft is no longer a level returns to the floor", () => {
    // Under a 2.00 ceiling the floor's cut is 1.00, so a 1.10 loft is a level; at 2.50 the cut is 1.20 and it is not.
    const low = withCommands(roomDoc(), { type: "setCeiling", height: 2 }, loft("loft", { x: 1.4, y: 2.2 }, { top: 1.1 }), ...onDeck("bed", LOFT, { x: 1.4, y: 2.8 }));
    const r = atLoft(low);
    expect(height(r.shell)).toBe(1.1);
    const to = dragFrom(r, ON_MATTRESS);
    r.remote({ type: "setCeiling", height: 2.5 });
    expect(height(r.shell)).toBe(0);
    expect(r.shell.state.viewedDeck).toBeNull();
    expect(r.shell.state.tool).toEqual(idleSelect);
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
  });

  it("› setting the viewed loft's Top to 2.30 in Properties keeps the loft selected", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.click(LOFT_TOP);
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
    shell.ui({ type: "setField", fieldId: "top", value: "2.30" });
    expect(height(shell)).toBe(2.3);
    expect(shell.state.viewedDeck).toBe(LOFT);
    expect(shell.state.selection).toEqual([{ table: "decks", id: LOFT }]);
  });

  it("› after a fallback (Bob lowers the loft to 1.00) Bob raising it back to 2.15 leaves me at the floor, and so does Bob deleting and re-adding the same id", () => {
    const lowered = atLoft();
    lowered.remote({ type: "setDeck", deckId: LOFT, top: 1 });
    expect(lowered.shell.state.viewedDeck).toBeNull();
    lowered.remote({ type: "setDeck", deckId: LOFT, top: 2.15 });
    expect(height(lowered.shell)).toBe(0);

    const readded = atLoft();
    readded.remote({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(readded.shell.state.viewedDeck).toBeNull();
    readded.remote(loft("loft", { x: 1.4, y: 2.2 }));
    expect(readded.doc.decks[LOFT]).toBeDefined();
    expect(height(readded.shell)).toBe(0);
  });

  it("› my own undo of the loft's delete brings it back without moving the view up", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.click(LOFT_TOP);
    shell.key("Delete");
    expect(height(shell)).toBe(0);
    shell.key("z", { meta: true });
    expect(shell.doc().decks[LOFT]).toBeDefined();
    expect(height(shell)).toBe(0);
  });
});

describe("a collaborator's change to a deck of the viewed level (gate M3, levels.46)", () => {
  const ghost = (r: FakeRemote) => (r.shell.state.tool.name === "object" ? r.shell.state.tool.state.ghost : undefined);
  const pressing = (r: FakeRemote) => {
    const tool = r.shell.state.tool;
    return tool.name === "select" && tool.state.kind === "pressing" ? tool.state : undefined;
  };

  it("› a press on Bunk's mattress, Bunk lowered by a collaborator within the drag threshold: the press ends, the move sends nothing", () => {
    // Viewed through Loft, the level stays at +2.15 when Bunk goes to 2.00, so following the view drops nothing; the
    // press has no dependencies for the remote-change rule, so only the level's rule (selectableAt) can end it.
    const r = atLoft(withBunk());
    r.shell.moveTo(ON_BUNK_MATTRESS);
    r.shell.down(ON_BUNK_MATTRESS);
    expect(r.shell.state.tool.state.kind).toBe("pressing");
    r.remote({ type: "setDeck", deckId: BUNK, top: 2 });
    expect(height(r.shell)).toBe(2.15);
    expect(r.shell.state.tool).toEqual(idleSelect);
    expect(r.shell.state.toast).toBeNull();
    const to = { x: ON_BUNK_MATTRESS.x, y: ON_BUNK_MATTRESS.y - 0.3 };
    r.shell.moveTo(to);
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
    expect(r.doc.placements["bunk-bed/p0"]?.at).toEqual({ x: 4.4, y: 3.4 });
  });

  it("› a press on a zone chip of Bunk's mattress, Bunk lowered by a collaborator: the press ends, the click toggles nothing", () => {
    // A chip press has no drag target, so only its chip names the piece the level must still select.
    const r = atLoft(withBunk());
    r.shell.click(ON_BUNK_MATTRESS);
    const chip = zoneChips(r.shell.state, r.shell.doc())[0];
    if (!chip) throw new Error("Bunk's mattress shows no zone chip");
    r.shell.moveTo(chip.at);
    r.shell.down(chip.at);
    expect(pressing(r)?.chip?.placementId).toBe("bunk-bed/p0");
    r.remote({ type: "setDeck", deckId: BUNK, top: 2 });
    expect(height(r.shell)).toBe(2.15);
    expect(r.shell.state.tool).toEqual(idleSelect);
    r.shell.up(chip.at);
    expect(r.submits()).toEqual([]);
  });

  it("› a press on Bunk's body (selected deck), Bunk raised to 2.30 by a collaborator within the threshold: the press ends, the drag sends nothing", () => {
    // Viewed through Loft, the level stays at +2.15; Bunk at 2.30 is a level of its own, which this view can't select.
    const r = atLoft(withBunk());
    r.shell.click(BUNK_TOP);
    expect(r.shell.state.selection).toEqual([{ table: "decks", id: BUNK }]);
    r.shell.moveTo(BUNK_TOP);
    r.shell.down(BUNK_TOP);
    expect(pressing(r)?.target?.kind).toBe("deck");
    r.remote({ type: "setDeck", deckId: BUNK, top: 2.3 });
    expect(height(r.shell)).toBe(2.15);
    expect(r.shell.state.tool).toEqual(idleSelect);
    const to = { x: BUNK_TOP.x, y: BUNK_TOP.y - 0.3 };
    r.shell.moveTo(to);
    r.shell.up(to);
    expect(r.submits()).toEqual([]);
    expect(r.doc.decks[BUNK]?.at).toEqual({ x: 4.4, y: 2.8 });
  });

  it("› the Object ghost over the loft after a collaborator raises it to 2.30: the ghost's landing is the 2.30 loft before the next move", () => {
    const r = atLoft();
    r.shell.ui({ type: "pickKind", kind: "nightstand" });
    r.shell.moveTo(ON_MATTRESS);
    expect(ghost(r)?.surface).toBe(LOFT);
    expect(ghost(r)?.range.bottom).toBeCloseTo(2.15, 6);
    r.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(height(r.shell)).toBe(2.3);
    const followed = ghost(r);
    expect(followed?.surface).toBe(LOFT);
    expect(followed?.range.bottom).toBeCloseTo(2.3, 6);
    r.shell.moveTo(ON_MATTRESS);
    expect(ghost(r)).toEqual(followed); // what the next move builds
  });

  it("› viewed through Bunk, a collaborator raising Bunk to 2.45 takes the view along: the ghost over the loft turns to no floor at once", () => {
    const r = FakeRemote.open(withBunk());
    r.shell.ui({ type: "setViewedLevel", deck: BUNK });
    r.shell.ui({ type: "pickKind", kind: "nightstand" });
    r.shell.moveTo(ON_MATTRESS);
    expect(ghost(r)?.surface).toBe(LOFT);
    r.remote({ type: "setDeck", deckId: BUNK, top: 2.45 });
    expect(height(r.shell)).toBe(2.45);
    expect(ghost(r)?.noFloor).toBe(true);
    expect(ghost(r)?.fits).toBe(false);
  });
});
