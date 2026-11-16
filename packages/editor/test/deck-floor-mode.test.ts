import { describe, expect, it } from "vitest";
import { motifDefaults, type Command, type Document, type EntityRef } from "@fm/domain";
import type { Point } from "@fm/protocol";
import { viewedLevel } from "../src/state";
import { COLORS } from "../src/view/colors";
import { tagLayout } from "../src/view/tags";
import { roomDoc, withCommands } from "./builders";
import { FakeShell } from "./fake-shell";

// The Floor mode at every level (deck-floors.02, .06; AC-03, AC-04): a Floor tile's click lays the motif on the first
// of, at the floor, a room's tag, the floor's deck under the click, the room's floor; at an upper level the level's own
// deck only. Off any surface at an upper level, "No floor at +2.15 here". Arming a tile keeps the viewed level.
//
// The 5.8 × 3.8 shell (roomDoc, ceiling 2.50), one room: a platform P (0.45) over x 0.5–2.5, y 0.3–1.7 with a hole over
// x 1.3–1.7, y 0.8–1.2; a loft A (2.15) over x 3.2–4.8, y 0.2–1.8; the room labelled "Living" with its tag under A.

const P = "p/k0";
const A = "a/k0";
const PLANKS = motifDefaults("planks");

function studio(labelAt: Point = { x: 4, y: 1 }, ...more: Command[]): Document {
  return withCommands(
    roomDoc(),
    { type: "addDeck", opId: "p", preset: "platform", at: { x: 1.5, y: 1 }, w: 2, d: 1.4 },
    { type: "addDeckHole", opId: "h", deck: P, at: { x: 1.5, y: 1 }, w: 0.4, d: 0.4 },
    { type: "addDeck", opId: "a", preset: "loft", at: { x: 4, y: 1 }, w: 1.6, d: 1.6 },
    { type: "labelZone", id: "L", at: labelAt, name: "Living", finish: null },
    ...more,
  );
}
const armed = (doc: Document, deck: string | null = null): FakeShell => {
  const shell = FakeShell.withDocument(doc);
  if (deck !== null) shell.ui({ type: "setViewedLevel", deck });
  shell.ui({ type: "pickMotif", motif: "planks" });
  return shell;
};
const tagCentre = (doc: Document): Point => {
  const tag = tagLayout(doc, "L", { zoom: 80 }, "s0");
  if (!tag) throw new Error("no tag");
  return { x: (tag.min.x + tag.max.x) / 2, y: (tag.min.y + tag.max.y) / 2 };
};
const deckRef = (id: string): EntityRef => ({ table: "decks", id });

describe("the Floor mode at the floor (AC-03)", () => {
  it("a click on the platform finishes the platform and selects it, not the room", () => {
    const shell = armed(studio());
    shell.click({ x: 0.8, y: 0.6 });
    expect(shell.doc().decks[P]?.finish).toEqual(PLANKS);
    expect(shell.doc().zoneLabels.L?.finish).toBeNull();
    expect(shell.state.selection).toEqual([deckRef(P)]);
  });

  it("a click on the room's floor, inside the loft's footprint (not the tag), finishes the room", () => {
    const shell = armed(studio());
    shell.click({ x: 4.6, y: 0.4 });
    expect(shell.doc().zoneLabels.L?.finish).toEqual(PLANKS);
    expect(shell.doc().decks[A]?.finish).toBeNull();
    expect(shell.state.selection).toEqual([{ table: "zoneLabels", id: "L" }]);
  });

  it("a click in the platform's hole finishes the room", () => {
    const shell = armed(studio());
    shell.click({ x: 1.5, y: 1 });
    expect(shell.doc().zoneLabels.L?.finish).toEqual(PLANKS);
    expect(shell.doc().decks[P]?.finish).toBeNull();
  });

  it("a click on a room's tag lying over the platform finishes the room (Select's order: tags before decks)", () => {
    const doc = studio({ x: 1.5, y: 0.75 }); // under the platform's two-line label (areas.10), clear of it
    const at = tagCentre(doc);
    expect(at.x > 0.5 && at.x < 2.5 && at.y > 0.3 && at.y < 1.7).toBe(true); // the fixture: the tag lies over the platform
    const shell = armed(doc);
    shell.click(at);
    expect(shell.doc().zoneLabels.L?.finish).toEqual(PLANKS);
    expect(shell.doc().decks[P]?.finish).toBeNull();
  });

  it("hovering the platform marks the deck and tints it under the pieces; hovering the room's floor marks the room", () => {
    const shell = armed(studio());
    const tinted = (): number => (shell.scene().layers.find((l) => l.name === "decks")?.primitives ?? []).filter((p) => p.kind === "polygon" && p.color === COLORS.zoneFinishTint).length;
    expect(tinted()).toBe(0);
    shell.moveTo({ x: 0.8, y: 0.6 });
    expect(tinted()).toBe(1);
    const t1 = shell.state.tool;
    expect(t1.name === "zone" ? [t1.state.hoverDeck, t1.state.hoverFaceKey] : null).toEqual([P, null]);
    shell.moveTo({ x: 3, y: 3 });
    const t2 = shell.state.tool;
    expect(t2.name === "zone" ? t2.state.hoverDeck : "no tool").toBeNull();
    expect(t2.name === "zone" ? t2.state.hoverFaceKey : null).not.toBeNull();
  });
});

describe("the Floor mode at the loft's level (AC-04)", () => {
  it("arming a Floor tile keeps the loft level", () => {
    const shell = armed(studio(), A);
    expect(viewedLevel(shell.state)?.height).toBe(2.15);
    expect(shell.state.tool).toMatchObject({ name: "zone", state: { motif: "planks" } });
  });

  it("a click on the loft finishes it and selects it, even over the room's tag lying under it", () => {
    const doc = studio();
    const shell = armed(doc, A);
    shell.click(tagCentre(doc));
    expect(shell.doc().decks[A]?.finish).toEqual(PLANKS);
    expect(shell.doc().zoneLabels.L?.finish).toBeNull();
    expect(shell.state.selection).toEqual([deckRef(A)]);
  });

  it("a click off the loft lays nothing and toasts \"No floor at +2.15 here\"", () => {
    const shell = armed(studio(), A);
    const before = shell.doc();
    shell.click({ x: 1.5, y: 3 });
    expect(shell.doc()).toBe(before);
    expect(shell.view().toast).toBe("No floor at +2.15 here");
  });

  it("picking the Zone tool (Z) at the loft still views the floor; Page Up keeps the Floor mode, and drops the plain Zone tool to Select", () => {
    const keyed = FakeShell.withDocument(studio());
    keyed.ui({ type: "setViewedLevel", deck: A });
    keyed.key("z");
    expect(viewedLevel(keyed.state)?.height).toBe(0);

    const floor = armed(studio());
    floor.key("PageUp");
    expect(viewedLevel(floor.state)?.height).toBe(2.15);
    expect(floor.state.tool).toMatchObject({ name: "zone", state: { motif: "planks" } });

    const plain = FakeShell.withDocument(studio());
    plain.key("z");
    plain.key("PageUp");
    expect(plain.state.tool.name).toBe("select");
  });
});
