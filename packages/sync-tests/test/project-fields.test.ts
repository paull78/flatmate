import { describe, expect, it } from "vitest";
import { surroundingsOf } from "@fm/domain";
import { Net, sharedRoom, type Client } from "./net";

// Project fields through the real server (sheet.02; AC-01, AC-02): one row per field, so two people editing different
// fields at once are both accepted.

describe("project fields against the real server", () => {
  it("a field set on one client reaches the other (AC-01)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "setField", fieldId: "project.client", value: "Rossi" });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().projectFields).toEqual({ client: { id: "client", value: "Rossi" } });
    expect(bob.shell.view().projectFields?.find((f) => f.id === "project.client")?.value).toBe("Rossi");
  });

  it("the sheet set's paper and scale reach the other client's view (sheetset.21)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    bob.shell.ui({ type: "openExport" });
    alice.shell.ui({ type: "setSheetSetting", key: "paper", value: "A3" });
    alice.pump();
    await net.settle();
    alice.shell.ui({ type: "setSheetSetting", key: "generalScale", value: "75" });
    alice.pump();
    await net.settle();
    expect(bob.shell.view().sheetsView?.paper).toBe("A3");
    expect(bob.shell.view().sheetsView?.scale).toBe("75");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  const setSurroundings = (c: Client, value: string): void => void c.shell.send({ type: "command", command: { type: "setProjectField", key: "surroundings", value } });

  it("surroundings set by one client reaches the other, and undo takes it back (AC-04)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const before = alice.shell.state.undo.past.length;
    setSurroundings(alice, "outside");
    await net.settle();
    expect(surroundingsOf(bob.shell.doc())).toBe("outside");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.state.undo.past).toHaveLength(before + 1);

    alice.shell.key("z", { ctrl: true });
    await net.settle();
    expect(surroundingsOf(alice.shell.doc())).toBeNull();
    expect(surroundingsOf(bob.shell.doc())).toBeNull();
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.state.undo.past).toHaveLength(before);
  });

  it("clearing surroundings on an untouched project sends nothing and leaves no undo entry (AC-04)", async () => {
    const net = new Net();
    const { alice } = await sharedRoom(net);
    const undo = alice.shell.state.undo.past.length;
    const sent = alice.shell.effectsOf("submit").length;
    setSurroundings(alice, "");
    await net.settle();
    expect(alice.shell.state.undo.past).toHaveLength(undo);
    expect(alice.shell.effectsOf("submit")).toHaveLength(sent);
    expect(alice.shell.view().toast).toBeNull();
  });

  it("two clients set different fields at once: both are accepted and both converge (AC-02)", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "setField", fieldId: "project.client", value: "Rossi" });
    bob.shell.ui({ type: "setField", fieldId: "project.address", value: "Via Roma 12" });
    alice.pump(); // both submitted before either sees the other's
    bob.pump();
    await net.settle();
    const fields = { address: { id: "address", value: "Via Roma 12" }, client: { id: "client", value: "Rossi" } };
    expect(alice.shell.doc().projectFields).toEqual(fields);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.view().toast).toBeNull();
    expect(alice.shell.state.undo.past.at(-1)?.status).toBe("usable");
    expect(bob.shell.state.undo.past.at(-1)?.status).toBe("usable");
  });

  it("the same field set by both: the second is a conflict, and both converge on the first", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "setField", fieldId: "project.client", value: "Rossi" });
    bob.shell.ui({ type: "setField", fieldId: "project.client", value: "Bianchi" });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(alice.shell.doc().projectFields.client?.value).toBe("Rossi");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
  });
});
