import { describe, expect, it } from "vitest";
import type { Command, Document } from "@fm/domain";
import { viewedLevel } from "../src/state";
import { planView } from "../src/levels";
import { roomDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";
import { FakeShell } from "./fake-shell";
import { PROJECT } from "./shared-builders";

// The viewed level (levels.09): each viewer keeps "the floor" or "the level of deck X", resolved against the visible
// document, so it follows the deck's top and falls back to the floor when the deck is no longer a level.

const loft = (opId: string, x: number, more: Partial<Extract<Command, { type: "addDeck" }>> = {}): Command =>
  ({ type: "addDeck", opId, preset: "loft", at: { x, y: 2.5 }, ...more });
const LOFT = "m/k0";
/** The sample room under the default 2.50 ceiling with a Loft (top 2.15) and a Platform (top 0.45, part of the floor level). */
const loftDoc = (): Document => withCommands(roomDoc(), loft("m", 1.2), { type: "addDeck", opId: "p", preset: "platform", at: { x: 4.5, y: 1 }, w: 1, d: 1 });
const view = (shell: FakeShell) => {
  const level = viewedLevel(shell.state);
  return { height: level?.height, cut: planView(shell.state)?.cut, decks: level?.deckIds };
};

describe("the viewed level", () => {
  it("starts at the floor; setViewedLevel(loft) views +2.15 and the plan view's cut is 2.325 under 2.50", () => {
    const shell = FakeShell.withDocument(loftDoc());
    expect(shell.state.viewedDeck).toBeNull();
    expect(view(shell)).toEqual({ height: 0, cut: 1.2, decks: [] });
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(shell.state.viewedDeck).toBe(LOFT);
    expect(view(shell)).toEqual({ height: 2.15, cut: 2.325, decks: [LOFT] });
    expect(planView(shell.state)?.level).toBe(viewedLevel(shell.state));
    shell.ui({ type: "setViewedLevel", deck: null });
    expect(view(shell)).toEqual({ height: 0, cut: 1.2, decks: [] });
  });

  it("the plan view is the same object while the document, layout and level are, and a new one for another level", () => {
    const shell = FakeShell.withDocument(loftDoc());
    const floor = planView(shell.state);
    expect(planView(shell.state)).toBe(floor);
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    const upper = planView(shell.state);
    expect(upper).not.toBe(floor);
    expect(planView(shell.state)).toBe(upper);
    expect(upper?.layout).toBe(floor?.layout);
  });

  it("raising the viewed loft to 2.30 keeps the view on it, now +2.30 (local)", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "setViewedLevel", deck: LOFT });
    shell.command({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(view(shell)).toEqual({ height: 2.3, cut: 2.4, decks: [LOFT] });
  });

  it("raising the viewed loft to 2.30 keeps the view on it, now +2.30 (a collaborator's edit)", () => {
    const r = FakeRemote.open(loftDoc());
    r.shell.ui({ type: "setViewedLevel", deck: LOFT });
    r.remote({ type: "setDeck", deckId: LOFT, top: 2.3 });
    expect(view(r.shell)).toEqual({ height: 2.3, cut: 2.4, decks: [LOFT] });
  });

  it("deleting the viewed loft, lowering it to 1.00, or raising the ceiling until it is below the floor's cut falls back to the floor", () => {
    const floor = { height: 0, cut: 1.2, decks: [] };
    const deleted = FakeShell.withDocument(loftDoc());
    deleted.ui({ type: "setViewedLevel", deck: LOFT });
    deleted.command({ type: "deleteEntities", ids: [{ table: "decks", id: LOFT }] });
    expect(view(deleted)).toEqual(floor);

    const lowered = FakeRemote.open(loftDoc());
    lowered.shell.ui({ type: "setViewedLevel", deck: LOFT });
    lowered.remote({ type: "setDeck", deckId: LOFT, top: 1 });
    expect(view(lowered.shell)).toEqual(floor);

    // Under a 2.00 ceiling the floor's cut is 1.00, so a 1.10 deck is a level; at 2.50 the cut is 1.20 and it is not.
    const low = withCommands(roomDoc(), { type: "setCeiling", height: 2 }, loft("m", 1.2, { top: 1.1 }));
    const raised = FakeRemote.open(low);
    raised.shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(view(raised.shell)).toEqual({ height: 1.1, cut: 1.55, decks: [LOFT] });
    raised.remote({ type: "setCeiling", height: 2.5 });
    expect(view(raised.shell)).toEqual(floor);
  });

  it("a deck below the floor's cut, or a missing one, is viewed as the floor", () => {
    const shell = FakeShell.withDocument(loftDoc());
    shell.ui({ type: "setViewedLevel", deck: "p/k0" }); // the platform
    expect(view(shell)).toEqual({ height: 0, cut: 1.2, decks: [] });
    shell.ui({ type: "setViewedLevel", deck: "nope" });
    expect(view(shell)).toEqual({ height: 0, cut: 1.2, decks: [] });
  });

  it("two lofts at 2.15: picking the level keeps the lower id; raising that one takes the view with it", () => {
    // "m/k0" is added first, "b/k0" second: the lower id is the later deck.
    const shell = FakeShell.withDocument(withCommands(loftDoc(), loft("b", 3.4, { name: "Bunk" })));
    const row = shell.view().levels?.rows.find((r) => r.height === "+2.15");
    expect(row?.deck).toBe("b/k0");
    shell.ui({ type: "setViewedLevel", deck: row?.deck ?? null });
    expect(view(shell)).toEqual({ height: 2.15, cut: 2.325, decks: ["b/k0", LOFT] });
    shell.command({ type: "setDeck", deckId: "b/k0", top: 2.3 });
    expect(view(shell)).toEqual({ height: 2.3, cut: 2.4, decks: ["b/k0"] });
  });

  it("is kept across a reconnect's reload and reset on opening a project", () => {
    const r = FakeRemote.open(loftDoc());
    r.shell.ui({ type: "setViewedLevel", deck: LOFT });
    r.disconnect();
    r.reconnect();
    expect(view(r.shell).height).toBe(2.15);
    r.shell.ui({ type: "showProjectList" });
    r.shell.ui({ type: "openProject", id: PROJECT.id });
    r.snapshot();
    expect(r.shell.state.viewedDeck).toBeNull();
    expect(view(r.shell).height).toBe(0);
  });

  it("sends no edit, only presence naming the level (levels.11)", () => {
    const r = FakeRemote.open(loftDoc());
    r.shell.clearEffects();
    r.shell.ui({ type: "setViewedLevel", deck: LOFT });
    expect(r.shell.effects.filter((e) => e.type !== "render").map((e) => (e.type === "presence" ? e.level : e.type))).toEqual([LOFT]);
  });
});
