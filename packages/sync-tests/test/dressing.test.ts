import { describe, expect, it } from "vitest";
import { Net, sharedRoom } from "./net";

// A window's dressing over the wire (hangings step 04, AC-05): the two optional opening fields are a stored-shape
// change, so a sheer and a shutter box Alice sets must reach Bob as stored, and the server accept them.

describe("a window's dressing between two clients", () => {
  it("a sheer to the floor and a shutter box Alice sets in Properties reach Bob, and come off again", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "pickOpeningKind", kind: "window" });
    alice.shell.click({ x: 3, y: 0.05 });
    await net.settle();
    const id = Object.keys(alice.shell.doc().openings)[0] ?? "";
    alice.shell.key("v"); // the Select tool
    alice.shell.click({ x: 3, y: 0.05 }); // selects the window
    alice.shell.ui({ type: "setField", fieldId: "sheer", value: "floor" });
    await net.settle(); // one edit is saved at a time
    alice.shell.ui({ type: "setField", fieldId: "shutterBox", value: "true" });
    await net.settle();

    expect(net.fatal).toEqual([]);
    expect(bob.shell.doc().openings[id]).toMatchObject({ sheer: "floor", shutterBox: true });
    expect(bob.shell.doc().openings).toEqual(alice.shell.doc().openings);

    alice.shell.ui({ type: "setField", fieldId: "sheer", value: "none" });
    await net.settle();
    alice.shell.ui({ type: "setField", fieldId: "shutterBox", value: "false" });
    await net.settle();
    expect(Object.keys(bob.shell.doc().openings[id] ?? {})).not.toContain("sheer");
    expect(Object.keys(bob.shell.doc().openings[id] ?? {})).not.toContain("shutterBox");
  });
});
