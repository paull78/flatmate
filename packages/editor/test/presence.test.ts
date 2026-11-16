import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/ports/events";
import { roomDoc, studioDoc, withCommands } from "./builders";
import { FakeRemote } from "./fake-remote";

function labels(r: FakeRemote): string[] {
  return presenceLayer(r).flatMap((p) => (p.kind === "text" ? [p.text] : []));
}

function bobIn(r: FakeRemote, state: string | null, level: string | null = null): ServerEvent {
  return { type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: { x: 1, y: 2 }, selection: [], state, level };
}

function presenceLayer(r: FakeRemote) {
  return r.shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
}

describe("presence in the scene (spec: collaboration)", () => {
  it("draws each remote cursor with its name in the collaborator's colour", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: { x: 1, y: 2 }, selection: [], state: null, level: null });
    const layer = presenceLayer(r);
    expect(layer).toContainEqual({ kind: "disc", center: { x: 1, y: 2 }, radius: { px: 5 }, color: "#0090ff" });
    expect(layer.some((p) => p.kind === "text" && p.text === "Bob" && p.color === "#0090ff")).toBe(true);
  });

  it("draws nothing for a collaborator without a cursor", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090ff", cursor: null, selection: [], state: null, level: null });
    expect(presenceLayer(r)).toEqual([]);
  });

  it("a remote presence in Night while I am in Day draws the label \"Bob · Night\"; in the same state draws \"Bob\" (spec: layouts)", () => {
    const r = FakeRemote.open(studioDoc()); // I am in s0 "Layout" (the day layout); Night is n/s0
    r.event(bobIn(r, "n/s0"));
    expect(labels(r)).toEqual(["Bob · Night"]);
    r.event(bobIn(r, "s0"));
    expect(labels(r)).toEqual(["Bob"]);
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(labels(r)).toEqual(["Bob · Layout"]);
    r.event(bobIn(r, null));
    expect(labels(r)).toEqual(["Bob"]);
    r.event(bobIn(r, "gone/s0")); // a state this client does not know (deleted, or not yet received)
    expect(labels(r)).toEqual(["Bob"]);
  });

  it("setActiveState emits a presence effect with the new state", () => {
    const r = FakeRemote.open(studioDoc());
    const generation = r.generation();
    r.shell.moveTo({ x: 1, y: 1 });
    expect(r.shell.effectsOf("presence").at(-1)?.state).toBe("s0");
    r.shell.clearEffects();
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    expect(r.shell.effectsOf("presence")).toEqual([
      { type: "presence", projectId: "p1", generation, cursor: { x: 1, y: 1 }, selection: [], state: "n/s0", level: null },
    ]);
    r.shell.clearEffects();
    r.shell.ui({ type: "setActiveState", id: "n/s0" }); // no change, nothing to say
    expect(r.shell.effectsOf("presence")).toEqual([]);
  });

  it("a remote deletion of my state moves me to the first state and tells the others", () => {
    const r = FakeRemote.open(studioDoc());
    r.shell.ui({ type: "setActiveState", id: "n/s0" });
    const sent = r.shell.effectsOf("presence").length;
    r.remote({ type: "deleteState", stateId: "n/s0" });
    expect(r.shell.effectsOf("presence").slice(sent).map((e) => e.state)).toEqual(["s0"]);
  });
});

describe("presence level (levels.11, AC-10)", () => {
  // The 5.8 × 3.8 room under a 2.80 ceiling: Loft (top 2.15) at x 0.4–2.4 and Bunk (top 2.15) at x 3.4–5.4, one level.
  const doc = () => withCommands(
    roomDoc(),
    { type: "setCeiling", height: 2.8 },
    { type: "addDeck", opId: "loft", preset: "loft", name: "Loft", at: { x: 1.4, y: 2.2 }, w: 2, d: 1.6 },
    { type: "addDeck", opId: "bunk", preset: "loft", name: "Bunk", at: { x: 4.4, y: 2.8 }, w: 2, d: 1.6 },
  );

  it("names the level by height: the same level through another deck reads no suffix; an unknown deck is the floor", () => {
    const r = FakeRemote.open(doc());
    r.event(bobIn(r, "s0", "loft/k0"));
    expect(labels(r)).toEqual(["Bob · Bunk, Loft"]);
    r.shell.ui({ type: "setViewedLevel", deck: "bunk/k0" });
    expect(labels(r)).toEqual(["Bob"]);
    r.event(bobIn(r, "s0", "gone/k0")); // a deck this client does not hold (deleted, or not yet received)
    expect(labels(r)).toEqual(["Bob · Floor"]);
    r.remote({ type: "setDeck", deckId: "loft/k0", top: 2.3 });
    r.event(bobIn(r, "s0", "loft/k0"));
    expect(labels(r)).toEqual(["Bob · Loft"]); // raised to 2.30, Loft is a level of its own
  });

  it("Page Up and Page Down send presence with the viewed deck, null at the floor; the same deck again sends nothing", () => {
    const r = FakeRemote.open(doc());
    r.shell.moveTo({ x: 1, y: 1 });
    expect(r.shell.effectsOf("presence").at(-1)?.level).toBeNull();
    r.shell.clearEffects();
    r.shell.key("PageUp");
    expect(r.shell.effectsOf("presence").map((e) => e.level)).toEqual(["bunk/k0"]); // the level's lowest deck id
    r.shell.clearEffects();
    r.shell.ui({ type: "setViewedLevel", deck: "bunk/k0" });
    expect(r.shell.effectsOf("presence")).toEqual([]);
    r.shell.key("PageDown");
    expect(r.shell.effectsOf("presence").map((e) => e.level)).toEqual([null]);
  });

  it("another deck of the same level sends presence with that deck: the level is named by its deck, not its height", () => {
    const r = FakeRemote.open(doc());
    r.shell.ui({ type: "setViewedLevel", deck: "loft/k0" });
    r.shell.moveTo({ x: 1, y: 1 });
    r.shell.clearEffects();
    r.shell.ui({ type: "setViewedLevel", deck: "bunk/k0" }); // same height: once Loft moves, only the deck tells them apart
    expect(r.shell.effectsOf("presence").map((e) => e.level)).toEqual(["bunk/k0"]);
  });

  it("undoing the add of the deck I view sends presence at the floor, not the gone deck", () => {
    const r = FakeRemote.open(withCommands(roomDoc(), { type: "setCeiling", height: 2.8 }));
    r.shell.command({ type: "addDeck", opId: "loft", preset: "loft", name: "Loft", at: { x: 1.4, y: 2.2 }, w: 2, d: 1.6 });
    r.accept();
    r.shell.ui({ type: "setViewedLevel", deck: "loft/k0" });
    r.shell.moveTo({ x: 1, y: 1 });
    r.shell.clearEffects();
    r.shell.ui({ type: "undo" });
    expect(r.shell.doc().decks).toEqual({});
    expect(r.shell.effectsOf("presence").map((e) => e.level)).toEqual([null]);
  });
});

describe("presence colours (render.12)", () => {
  it("an uppercase colour from the wire draws lowercase, inside the Scene's colour rule", () => {
    const r = FakeRemote.open(roomDoc());
    r.event({ type: "presence", projectId: "p1", generation: r.generation(), clientId: "bob", name: "Bob", color: "#0090FF", cursor: { x: 1, y: 2 }, selection: [], state: null, level: null });
    expect(presenceLayer(r).map((p) => p.color)).toEqual(["#0090ff", "#0090ff"]);
  });
});
