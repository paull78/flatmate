import { describe, expect, it } from "vitest";
import type { Point } from "@fm/protocol";
import { Net, seqOf, sharedRoom, submitIds, type Client } from "./net";

// Direct manipulation with two editors (spec: tools): others see results, not previews (direct.15). The shared room is
// 6 × 4 m with inner faces at y 0.1/3.9; the Object tool centres a desk (1.2 × 0.6) on the click.

async function placeDesk(net: Net, c: Client, at: Point): Promise<void> {
  c.shell.ui({ type: "pickKind", kind: "desk" });
  c.shell.click(at);
  c.shell.key("Escape");
  await net.settle();
}

/** Two desks centred on (1.5, 1.5) and (4.5, 1.5), each spanning y 1.2–1.8, both selected by Alice. */
async function twoDesks(): Promise<{ net: Net; alice: Client; bob: Client }> {
  const net = new Net();
  const { alice, bob } = await sharedRoom(net);
  await placeDesk(net, alice, { x: 1.5, y: 1.5 });
  await placeDesk(net, alice, { x: 4.5, y: 1.5 });
  alice.shell.key("v");
  alice.shell.click({ x: 1.5, y: 1.5 });
  alice.shell.click({ x: 4.5, y: 1.5 }, { shift: true });
  await net.settle();
  return { net, alice, bob };
}

const anchors = (c: Client) => Object.values(c.shell.doc().placements).map((p) => p.at);

describe("group moves with two editors (direct.02, direct.15)", () => {
  it("a group move by Alice reaches Bob as one change at release, not during the drag, and her one undo reverts both desks (AC-15, AC-08)", async () => {
    const { net, alice, bob } = await twoDesks();
    expect(alice.shell.view().properties).toEqual({ kind: "group", count: 2 });
    const doc0 = bob.shell.doc();
    const seq0 = seqOf(bob);
    const sent0 = submitIds(alice).length;
    const at0 = anchors(alice);
    expect(at0).toHaveLength(2);

    alice.shell.moveTo({ x: 1.5, y: 1.5 });
    alice.shell.down({ x: 1.5, y: 1.5 });
    alice.shell.moveTo({ x: 1.5, y: 2 });
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent0);
    expect(bob.shell.doc()).toEqual(doc0);

    alice.shell.moveTo({ x: 1.5, y: 2.5 });
    alice.shell.up({ x: 1.5, y: 2.5 });
    await net.settle();
    expect(seqOf(bob)).toBe(seq0 + 1);
    expect(submitIds(alice)).toHaveLength(sent0 + 1);
    const at1 = anchors(alice);
    at0.forEach((p, i) => {
      expect(at1[i]?.y).toBeCloseTo(p.y + 1, 6);
      expect(at1[i]?.x).toBe(p.x);
    });
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.state.undo.past.at(-1)?.status).toBe("usable");
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);

    alice.shell.key("z", { meta: true });
    await net.settle();
    expect(bob.shell.doc()).toEqual(doc0);
    expect(seqOf(bob)).toBe(seq0 + 2);
  });

  it("a group drag into a wall commits nothing in either editor (AC-08)", async () => {
    const { net, alice, bob } = await twoDesks();
    const doc0 = alice.shell.doc();
    const sent0 = submitIds(alice).length;

    alice.shell.drag({ x: 1.5, y: 1.5 }, { x: 1.5, y: 3.7 }); // each desk would span y 3.4–4.0, across the face at 3.9
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent0);
    expect(alice.shell.doc()).toEqual(doc0);
    expect(bob.shell.doc()).toEqual(doc0);
    expect(alice.shell.view().toast).toMatch(/overlaps a wall/);
  });
});

describe("duplicate with two editors (ghost.01, AC-10)", () => {
  // Remote cursors go only to the presence layer, so the rest of the scene is the plan a viewer sees.
  const plan = (c: Client) => c.shell.scene().layers.filter((l) => l.name !== "presence");

  /** Desks centred on (1.6, 1.6) and (4.4, 1.6): anchors (1.6, 1.9) and (4.4, 1.9), box x 1.0–5.0, y 1.3–1.9, centre (3.0, 1.6). */
  async function deskPair(): Promise<{ net: Net; alice: Client; bob: Client }> {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    await placeDesk(net, alice, { x: 1.6, y: 1.6 });
    await placeDesk(net, alice, { x: 4.4, y: 1.6 });
    alice.shell.key("v");
    alice.shell.click({ x: 1.6, y: 1.6 });
    alice.shell.click({ x: 4.4, y: 1.6 }, { shift: true });
    await net.settle();
    return { net, alice, bob };
  }

  it("copies Alice places from a group ghost reach Bob as one change; Bob never sees the ghost; her one undo removes both", async () => {
    const { net, alice, bob } = await deskPair();
    const doc0 = bob.shell.doc();
    const seq0 = seqOf(bob);
    const sent0 = submitIds(alice).length;
    const bobPlan0 = plan(bob);
    const alicePlan0 = plan(alice);

    alice.shell.key("d", { meta: true });
    alice.shell.moveTo({ x: 3, y: 2.6 }); // offset (0, 1.0)
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent0);
    expect(seqOf(bob)).toBe(seq0);
    expect(bob.shell.doc()).toEqual(doc0);
    expect(plan(bob)).toEqual(bobPlan0);
    expect(plan(alice)).not.toEqual(alicePlan0); // Alice's ghost is in her plan, so the comparison can fail

    alice.shell.click({ x: 3, y: 2.6 });
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent0 + 1);
    expect(seqOf(bob)).toBe(seq0 + 1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(anchors(alice).sort((a, b) => a.y - b.y || a.x - b.x)).toEqual([
      { x: 1.6, y: 1.9 }, { x: 4.4, y: 1.9 }, { x: 1.6, y: 2.9 }, { x: 4.4, y: 2.9 },
    ]);
    expect(alice.shell.state.selection).toHaveLength(2);
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);

    alice.shell.key("z", { meta: true });
    await net.settle();
    expect(seqOf(bob)).toBe(seq0 + 2);
    expect(bob.shell.doc()).toEqual(doc0);
  });

  it("a ghost started from the button and dropped with Esc sends nothing (AC-08, AC-07)", async () => {
    const { net, alice, bob } = await deskPair();
    const doc0 = bob.shell.doc();
    const seq0 = seqOf(bob);
    const sent0 = submitIds(alice).length;
    const bobPlan0 = plan(bob);

    alice.shell.send({ type: "pointerLeave" }); // the mouse goes to the panel
    alice.shell.ui({ type: "duplicate" });
    await net.settle();
    expect(plan(bob)).toEqual(bobPlan0);

    alice.shell.moveTo({ x: 3, y: 2.6 });
    alice.shell.key("Escape");
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent0);
    expect(seqOf(bob)).toBe(seq0);
    expect(alice.shell.doc()).toEqual(doc0);
    expect(bob.shell.doc()).toEqual(doc0);
  });
});

function stateId(c: Client, name: string): string {
  const id = c.shell.view().states.find((s) => s.name === name)?.id;
  if (id === undefined) throw new Error(`${c.name} has no state named ${name}`);
  return id;
}

describe("grip resize with two editors (direct.04)", () => {
  it("a grip resize by Alice reaches Bob as one change, the linked copy in the other layout follows (review.05), and one undo reverts it (AC-15, AC-02)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "pickKind", kind: "sofaBed" });
    alice.shell.click({ x: 3, y: 2 }); // a 2.10 × 0.90 sofa bed anchored at (3, 2.45): x 1.95–4.05, y 1.55–2.45
    alice.shell.key("Escape");
    await net.settle();
    alice.shell.ui({ type: "addState" }); // "Layout 2", a copy, becomes active
    await net.settle();
    const layout = stateId(alice, "Layout");
    const state2 = stateId(alice, "Layout 2");
    alice.shell.ui({ type: "setActiveState", id: layout });
    await net.settle();
    alice.shell.key("v");
    alice.shell.click({ x: 3, y: 2 });
    const seq = seqOf(bob);
    const sent = submitIds(alice).length;
    const placementIn = (c: Client, state: string) => Object.values(c.shell.doc().placements).find((p) => p.state === state);
    const sofa = (c: Client) => Object.values(c.shell.doc().objects)[0];

    alice.shell.drag({ x: 4.05, y: 2 }, { x: 4.35, y: 2 }, { ctrl: true }); // the right grip, +0.30 with no snap
    await net.settle();
    expect(submitIds(alice)).toHaveLength(sent + 1);
    expect(seqOf(bob)).toBe(seq + 1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(sofa(bob)?.w.sofa).toBeCloseTo(2.4, 6);
    expect(sofa(bob)).toMatchObject({ d: { sofa: 0.9, bed: 1.6 } });
    expect(sofa(bob)?.w.bed).toBeCloseTo(2.4, 6);
    expect(placementIn(bob, layout)?.at).toEqual({ x: expect.closeTo(3.15, 6), y: expect.closeTo(2.45, 6) }); // left side kept at x 1.95
    expect(placementIn(bob, state2)?.at).toEqual({ x: expect.closeTo(3.15, 6), y: expect.closeTo(2.45, 6) }); // linked: the copy follows (review.05)
    expect([alice.shell.view().toast, bob.shell.view().toast]).toEqual([null, null]);

    alice.shell.key("z", { meta: true });
    await net.settle();
    expect(seqOf(bob)).toBe(seq + 2);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(sofa(bob)?.w.sofa).toBe(2.1);
    expect(sofa(bob)?.w.bed).toBe(2.1);
    expect(placementIn(bob, layout)?.at).toEqual({ x: 3, y: 2.45 });
  });
});
