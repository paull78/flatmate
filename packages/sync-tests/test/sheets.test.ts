import { describe, expect, it } from "vitest";
import { sheetDrawings, sheetsOf, type Command, type Document } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Sheets through the real server (sheetset.02, .11; AC-02): a row per sheet, flat as the wire requires, so different
// sheets both land and one sheet clashes like any other row.

const run = (c: Client, command: Command): void => void c.shell.send({ type: "command", command });

/** Alice and Bob on a room with the layouts Layout and Night, so two automatic sheets. */
async function room(): Promise<{ net: Net; alice: Client; bob: Client; layout: string; night: string }> {
  const net = new Net();
  const { alice, bob } = await sharedRoom(net);
  run(alice, { type: "addState", opId: "night", name: "Night" });
  await net.settle();
  const states = Object.values(alice.shell.doc().states);
  const layout = states.find((s) => s.name === "Layout")?.id ?? "";
  return { net, alice, bob, layout, night: "night/s0" };
}

const titles = (doc: Document): string[] => sheetsOf(doc).map((s) => s.title);

describe("sheets against the real server", () => {
  it("a sheet's flat drawings cross the wire", async () => {
    const { net, alice, bob, layout, night } = await room();
    run(alice, { type: "addSheet", opId: "cmp", after: null, kind: "compare", drawings: [{ layout, deck: null }, { layout: night, deck: null }], title: "Day and night", scale: 50 });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    const sheet = sheetsOf(bob.shell.doc()).find((s) => s.id === "cmp/t0");
    expect(sheet?.drawings).toEqual({ l0: layout, d0: null, l1: night, d1: null, l2: null, d2: null, l3: null, d3: null });
    expect(sheet && sheetDrawings(sheet)).toEqual([{ layout, deck: null }, { layout: night, deck: null }]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a Section sheet's letter crosses the wire", async () => {
    const { net, alice, bob, layout } = await room();
    run(alice, { type: "addSection", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, side: 1 });
    await net.settle();
    run(alice, { type: "addSheet", opId: "s", after: null, kind: "section", section: "A", drawings: [{ layout, deck: null }], title: "Section A–A" });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    const sheet = sheetsOf(bob.shell.doc()).find((s) => s.id === "s/t0");
    expect(sheet?.kind).toBe("section");
    expect(sheet?.section).toBe("A");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it.each([["the delete reaches the server first", true], ["the sheet reaches the server first", false]])("a Section sheet raced by its section's delete: one is refused and both agree, %s", async (_name, deleteFirst) => {
    const { net, alice, bob, layout } = await room();
    run(alice, { type: "addSection", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, side: 1 });
    await net.settle();
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Stored" }); // the first edit, so each race below writes only its own row
    await net.settle();
    run(alice, { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] });
    run(bob, { type: "addSheet", opId: "s", after: null, kind: "section", section: "A", drawings: [{ layout, deck: null }], title: "Section A–A" });
    for (const client of deleteFirst ? [alice, bob] : [bob, alice]) client.pump();
    await net.settle();
    const loser = deleteFirst ? bob : alice;
    const winner = deleteFirst ? alice : bob;
    expect(loser.shell.view().toast).not.toBeNull();
    expect(winner.shell.view().toast).toBeNull();
    expect(Object.keys(alice.shell.doc().sections)).toEqual(deleteFirst ? [] : ["A"]);
    expect(sheetsOf(alice.shell.doc()).some((s) => s.id === "s/t0")).toBe(!deleteFirst);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("deleting a section takes its stored sheet for both, and undo brings both back", async () => {
    const { net, alice, bob, layout } = await room();
    run(alice, { type: "addSection", a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, side: 1 });
    await net.settle();
    run(alice, { type: "addSheet", opId: "s", after: null, kind: "section", section: "A", drawings: [{ layout, deck: null }], title: "Section A–A" });
    await net.settle();
    expect(sheetsOf(bob.shell.doc()).some((s) => s.id === "s/t0")).toBe(true);
    run(alice, { type: "deleteEntities", ids: [{ table: "sections", id: "A" }] });
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(Object.keys(bob.shell.doc().sections)).toEqual([]);
    expect(sheetsOf(bob.shell.doc()).some((s) => s.id === "s/t0")).toBe(false);
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(Object.keys(bob.shell.doc().sections)).toEqual(["A"]);
    expect(sheetsOf(bob.shell.doc()).find((s) => s.id === "s/t0")?.section).toBe("A");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("two clients edit different sheets and both land", async () => {
    const { net, alice, bob } = await room();
    run(alice, { type: "setSheet", sheetId: "auto/0", cx: 1 }); // the first edit, so both are rows
    await net.settle();
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Alice's" });
    run(bob, { type: "setSheet", sheetId: "auto/1", title: "Bob's" });
    alice.pump(); // both submitted before either sees the other's
    bob.pump();
    await net.settle();
    expect(titles(alice.shell.doc())).toEqual(["Alice's", "Bob's"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBeNull();
  });

  it("the same sheet: \"Someone else changed this first\"", async () => {
    const { net, alice, bob } = await room();
    run(alice, { type: "setSheet", sheetId: "auto/0", cx: 1 });
    await net.settle();
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Alice's" });
    run(bob, { type: "setSheet", sheetId: "auto/0", title: "Bob's" });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(titles(alice.shell.doc())[0]).toBe("Alice's");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
  });

  it("two first edits at once, on different sheets: one lands, the other gets the conflict notice", async () => {
    const { net, alice, bob } = await room();
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Alice's" });
    run(bob, { type: "setSheet", sheetId: "auto/1", title: "Bob's" });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(titles(alice.shell.doc())).toEqual(["Alice's", "Night"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
  });

  it("a first edit while someone deletes a layout: the second clashes on the layout, and both converge", async () => {
    const { net, alice, bob, night } = await room();
    run(bob, { type: "deleteState", stateId: night });
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Alice's" });
    bob.pump();
    alice.pump();
    await net.settle();
    expect(titles(alice.shell.doc())).toEqual(["Layout"]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.view().toast).toBe("Someone else changed this first");
  });

  it("a sheet added on a layout someone is deleting: the second edit is refused as needing what was removed, and both converge", async () => {
    const { net, alice, bob, layout, night } = await room();
    run(alice, { type: "setSheet", sheetId: "auto/0", cx: 1 }); // rows, so the sheet and the delete write different keys
    await net.settle();
    run(bob, { type: "addSheet", opId: "late", after: null, kind: "plan", drawings: [{ layout: night, deck: null }] });
    run(alice, { type: "deleteState", stateId: night });
    bob.pump();
    alice.pump();
    await net.settle();
    expect(Object.keys(alice.shell.doc().states)).toEqual(expect.arrayContaining([layout, night]));
    expect(alice.shell.view().toast).toBe("This edit needs something that was just removed");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a report being typed outlives another's text; leaving sends it, and both converge on it (last writer wins)", async () => {
    const { net, alice, bob } = await room();
    run(alice, { type: "addSheet", opId: "r", after: null, kind: "report", drawings: [], title: "Report", text: "Stored" });
    await net.settle();
    bob.shell.ui({ type: "typeReport", id: "r/t0", text: "Bob is typing" });
    run(alice, { type: "setSheet", sheetId: "r/t0", text: "Alice wrote this" });
    await net.settle();
    expect(bob.shell.state.reportDrafts["r/t0"]?.text).toBe("Bob is typing");
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(sheetsOf(bob.shell.doc()).find((s) => s.id === "r/t0")?.text).toBe("Alice wrote this");
    bob.shell.ui({ type: "leaveReport", id: "r/t0" });
    await net.settle();
    expect(bob.shell.state.reportDrafts["r/t0"]).toBeUndefined();
    expect(sheetsOf(alice.shell.doc()).find((s) => s.id === "r/t0")?.text).toBe("Bob is typing");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    bob.shell.ui({ type: "undo" }); // back to what he overwrote, not to what he started from
    await net.settle();
    expect(sheetsOf(alice.shell.doc()).find((s) => s.id === "r/t0")?.text).toBe("Alice wrote this");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("a layout deleted beside its sheets: one change on the other client, undone as one", async () => {
    const { net, alice, bob, layout, night } = await room();
    run(alice, { type: "addSheet", opId: "cmp", after: null, kind: "compare", drawings: [{ layout, deck: null }, { layout: night, deck: null }] });
    await net.settle();
    run(alice, { type: "deleteState", stateId: night });
    await net.settle();
    const left = sheetsOf(bob.shell.doc());
    expect(left.map((s) => [s.id, s.kind])).toEqual([["auto/0", "plan"], ["cmp/t0", "plan"]]);
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(sheetsOf(bob.shell.doc()).map((s) => [s.id, s.kind])).toEqual([["auto/0", "plan"], ["auto/1", "plan"], ["cmp/t0", "compare"]]);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("the first edit undone returns to automatic, and a new first edit lands over the old rows' tombstones", async () => {
    const { net, alice, bob } = await room();
    run(alice, { type: "setSheet", sheetId: "auto/0", title: "Mine" });
    await net.settle();
    alice.shell.ui({ type: "undo" });
    await net.settle();
    expect(titles(bob.shell.doc())).toEqual(["Layout", "Night"]);
    run(bob, { type: "setSheet", sheetId: "auto/1", title: "Bob's" });
    await net.settle();
    expect(titles(alice.shell.doc())).toEqual(["Layout", "Bob's"]);
    expect(bob.shell.view().toast).toBeNull();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
