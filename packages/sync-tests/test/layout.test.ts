import { describe, expect, it } from "vitest";
import { nullZones } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Layout states with two editors on one drawing (spec: layouts): each user has their own active state, presence says
// which one, and edits in different states are independent rows, so they converge like any other edits.

function stateId(c: Client, name: string): string {
  const id = c.shell.view().states.find((s) => s.name === name)?.id;
  if (id === undefined) throw new Error(`${c.name} has no state named ${name}`);
  return id;
}

function activeName(c: Client): string | undefined {
  return c.shell.view().states.find((s) => s.active)?.name;
}

/** The labels next to the remote cursors in this client's scene. */
function cursorLabels(c: Client): string[] {
  const layer = c.shell.scene().layers.find((l) => l.name === "presence")?.primitives ?? [];
  return layer.flatMap((p) => (p.kind === "text" ? [p.text] : []));
}

function placementsIn(c: Client, state: string) {
  return Object.values(c.shell.doc().placements).filter((p) => p.state === state);
}

/** Alice renames the first state Day and adds Night (a copy of Day). Alice ends in Night, Bob in Day. */
async function dayAndNight(net: Net, alice: Client): Promise<{ day: string; night: string }> {
  alice.shell.ui({ type: "renameState", id: stateId(alice, "Layout"), name: "Day" });
  await net.settle();
  alice.shell.ui({ type: "addState" }); // copies Day and makes the copy active
  await net.settle();
  alice.shell.ui({ type: "renameState", id: stateId(alice, "Layout 2"), name: "Night" });
  await net.settle();
  return { day: stateId(alice, "Day"), night: stateId(alice, "Night") };
}

/** With the Object tool, a click in the 6 × 4 room places a bed centred on the click. */
function placeBed(c: Client, at: { x: number; y: number }): void {
  c.shell.ui({ type: "pickKind", kind: "bed" });
  c.shell.click(at);
  c.shell.key("Escape");
}

/** Alice places a desk in Layout (desk/p0, x 2.4–3.6, y 2.4–3); its default sides are front only. */
async function deskInLayout(net: Net, alice: Client): Promise<void> {
  alice.shell.command({ type: "placeObject", deck: null, opId: "desk", state: stateId(alice, "Layout"), object: { kind: "desk" }, at: { x: 3, y: 3 } });
  await net.settle();
}

const FRONT_BACK = { front: true, back: true, left: false, right: false };

describe("layout states with two editors (spec: layouts)", () => {
  it("Alice places and moves a bed in Day while Bob places a table in Night; both are linked into the other layout and both documents are identical at the end (AC-06, review.05)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const { day, night } = await dayAndNight(net, alice);
    alice.shell.ui({ type: "setActiveState", id: day });
    bob.shell.ui({ type: "setActiveState", id: night });
    await net.settle();

    placeBed(alice, { x: 1.5, y: 2 }); // bed x 0.65–2.35, y 0.95–3.05
    bob.shell.ui({ type: "pickKind", kind: "foldingTable" });
    bob.shell.click({ x: 4.5, y: 2 });
    bob.shell.key("Escape");
    alice.pump();
    bob.pump();
    await net.settle();

    alice.shell.drag({ x: 1.5, y: 2 }, { x: 2, y: 2 }, { ctrl: true }); // the bed moves 0.5 m right (no snapping), in both: linked (review.05)
    await net.settle();

    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    const kinds = (state: string) => placementsIn(alice, state).map((p) => [alice.shell.doc().objects[p.object]?.kind, p.at]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(kinds(day)[0]).toEqual(["bed", { x: 2, y: 3.05 }]);
    expect(kinds(night)).toEqual(kinds(day)); // each piece placed in one layout is in the other too, at the same place
    expect(kinds(night).map(([k]) => k)).toEqual(["bed", "foldingTable"]);
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);

    // Each sees the other's cursor with the state they are looking at.
    alice.shell.moveTo({ x: 1, y: 1 });
    bob.shell.moveTo({ x: 5, y: 1 });
    await net.settle();
    expect(cursorLabels(alice)).toEqual(["Bob · Night"]);
    expect(cursorLabels(bob)).toEqual(["Alice · Day"]);
    bob.shell.ui({ type: "setActiveState", id: day });
    await net.settle();
    expect(cursorLabels(alice)).toEqual(["Bob"]);
  });

  it("Alice and Bob resize the same object from different states concurrently: one is accepted, the other rejected as conflict, both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    placeBed(alice, { x: 1.5, y: 2 });
    await net.settle();
    const { day, night } = await dayAndNight(net, alice); // the bed is in both states
    bob.shell.ui({ type: "setActiveState", id: night });
    alice.shell.ui({ type: "setActiveState", id: day });
    await net.settle();
    const bed = Object.values(alice.shell.doc().objects)[0]?.id ?? "";

    alice.shell.key("v");
    bob.shell.key("v");
    alice.shell.click({ x: 1.5, y: 2 });
    bob.shell.click({ x: 1.5, y: 2 });
    alice.shell.ui({ type: "setField", fieldId: "width", value: "1.60" });
    bob.shell.ui({ type: "setField", fieldId: "width", value: "1.80" });
    alice.pump(); // Alice's resize arrives first
    bob.pump();
    await net.settle();

    expect(alice.shell.doc().objects[bed]?.w.standard).toBe(1.6);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(bob.shell.state.undo.pending).toBeNull();
  });

  it("Bob deletes Night while Alice is in Night: Alice's editor moves to Day and her pending move in Night is rejected cleanly", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    placeBed(alice, { x: 1.5, y: 2 });
    await net.settle();
    const { day, night } = await dayAndNight(net, alice); // Alice is in Night, Bob in Day
    expect(activeName(alice)).toBe("Night");
    expect(activeName(bob)).toBe("Day");

    alice.shell.key("v");
    alice.shell.drag({ x: 1.5, y: 2 }, { x: 2.5, y: 2 }); // a move in Night, not sent yet
    bob.shell.ui({ type: "deleteState", id: night });
    bob.pump(); // Bob's delete arrives first
    alice.pump();
    await net.settle();

    expect(activeName(alice)).toBe("Day");
    expect(alice.shell.view().states.map((s) => s.id)).toEqual([day]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(placementsIn(alice, day).map((p) => p.at)).toEqual([{ x: 1.5, y: 3.05 }]); // Day never moved
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    expect(alice.shell.state.undo.pending).toBeNull();
    expect(alice.shell.effectsOf("presence").at(-1)?.state).toBe(day); // the others learn she is in Day now
    expect(cursorLabels(bob)).toEqual(["Alice"]);
  });
  it("a zone toggle in Layout and a copy of Layout race: the toggle first refuses the copy, both converge (AC-12)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await deskInLayout(net, alice);

    alice.shell.command({ type: "setZoneSides", placementId: "desk/p0", sides: FRONT_BACK });
    bob.shell.ui({ type: "addState" }); // a copy of Layout
    alice.pump(); // the toggle arrives first
    bob.pump();
    await net.settle();

    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect([alice, bob].map((c) => c.shell.view().states.map((s) => s.name))).toEqual([["Layout"], ["Layout"]]);
    expect(alice.shell.doc().placements["desk/p0"]?.sides).toEqual(FRONT_BACK);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.state.undo.pending).toBeNull();
  });

  it("the same race with the copy first: both are accepted, the copy carries the sides it copied (AC-12)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await deskInLayout(net, alice);
    const layout = stateId(alice, "Layout");
    const BACK = { front: false, back: true, left: false, right: false }; // not the desk's default, so a copy shows
    alice.shell.command({ type: "setZoneSides", placementId: "desk/p0", sides: BACK });
    await net.settle();

    alice.shell.command({ type: "setZoneSides", placementId: "desk/p0", sides: FRONT_BACK });
    bob.shell.ui({ type: "addState" });
    bob.pump(); // the copy arrives first: it writes no row the toggle depends on
    alice.pump();
    await net.settle();

    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);
    const copies = Object.values(alice.shell.doc().placements).filter((p) => p.state !== layout);
    expect(copies.map((p) => p.sides)).toEqual([BACK]);
    expect(alice.shell.doc().placements["desk/p0"]?.sides).toEqual(FRONT_BACK);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a zone extent reaches the other editor, only in its layout, and Undo takes it back for both (AC-18)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "placeObject", deck: null, opId: "bed", state: stateId(alice, "Layout"), object: { kind: "bed" }, at: { x: 1.5, y: 3.05 } }); // x 0.65–2.35, y 0.95–3.05
    await net.settle(); // one edit in flight at a time
    alice.shell.ui({ type: "addState" }); // a copy: State 2
    await net.settle();

    alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: { depth: 0.4, start: 0.45, end: 0 } });
    await net.settle();
    expect(bob.shell.doc().placements["bed/p0"]?.zones).toMatchObject({ leftDepth: 0.4, leftStart: 0.45, leftEnd: 0 });
    expect(placementsIn(bob, stateId(bob, "Layout 2"))[0]?.zones).toEqual(nullZones());
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);

    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(bob.shell.doc().placements["bed/p0"]?.zones).toMatchObject({ leftDepth: null, leftStart: null, leftEnd: null });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a zone extent and a concurrent resize of the object conflict: the second is rejected, both converge", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.command({ type: "placeObject", deck: null, opId: "bed", state: stateId(alice, "Layout"), object: { kind: "bed" }, at: { x: 1.5, y: 3.05 } });
    await net.settle();

    alice.shell.command({ type: "setZoneExtent", placementId: "bed/p0", side: "left", extent: { depth: 0.4, start: 0.45, end: 0 } });
    bob.shell.command({ type: "setObjectSize", objectId: "bed/o0", w: 1.6, d: { standard: 2.1 } });
    // The resize arrives first and writes only the object row: the extent is refused because it depends on the
    // object (its insets were checked against the old size). With only the placement as a dependency it would pass.
    bob.pump();
    alice.pump();
    await net.settle();

    expect(alice.shell.view().toast).toBe("Someone else changed this first");
    expect(bob.shell.view().toast).toBeNull();
    expect(alice.shell.doc().objects["bed/o0"]?.w["standard"]).toBe(1.6);
    expect(alice.shell.doc().placements["bed/p0"]?.zones.leftDepth).toBeNull();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.state.undo.pending).toBeNull();
  });
});
