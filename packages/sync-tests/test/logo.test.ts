import { describe, expect, it } from "vitest";
import { LOGO_LONG_SIDE, MAX_LOGO_DATA_CHARS } from "@fm/protocol";
import { Net, sharedRoom } from "./net";

// The studio's logo through the real server (sheetset.18, .21; AC-13): one row, so everyone prints the same thing.

const JPEG = "/9j/4AAQSkZJRgABAQ";
const picture = (data = JPEG, width = 600, height = 200) => ({ ok: true as const, data, width, height });

describe("a logo through the real server", () => {
  it("a logo reaches the other client", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    bob.shell.ui({ type: "openExport" });
    alice.shell.ui({ type: "importLogo", result: picture() });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().logos).toEqual({ logo: { id: "logo", data: JPEG, width: 600, height: 200 } });
    expect(bob.shell.view().logo?.present).toBe(true);
    expect(bob.shell.view().sheetsView?.sheets[0]?.pages()[0]?.images?.[0]?.jpeg).toBe(JPEG);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });

  it("the largest a logo can be goes over the wire", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const data = JPEG.padEnd(MAX_LOGO_DATA_CHARS, "A");
    alice.shell.ui({ type: "importLogo", result: picture(data, LOGO_LONG_SIDE, LOGO_LONG_SIDE) });
    alice.pump();
    await net.settle();
    expect(alice.shell.view().toast).toBeNull();
    expect(bob.shell.doc().logos["logo"]?.data).toBe(data);
  });

  it("Remove and undo reach the other client, each one step", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "importLogo", result: picture() });
    alice.pump();
    await net.settle();
    alice.shell.ui({ type: "removeLogo" });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().logos).toEqual({});
    alice.shell.ui({ type: "undo" });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().logos["logo"]?.data).toBe(JPEG);
    alice.shell.ui({ type: "undo" });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().logos).toEqual({});
  });

  it("two choosing at once: the second is told, and both converge on the first", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "importLogo", result: picture(`${JPEG}AAAA`) });
    bob.shell.ui({ type: "importLogo", result: picture(`${JPEG}BBBB`) });
    alice.pump();
    bob.pump();
    await net.settle();
    expect(bob.shell.view().toast).toBe("Someone else changed this first");
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
    expect(alice.shell.doc().logos["logo"]?.data).toBe(`${JPEG}AAAA`);
  });

  it("the server refuses a row that isn't a JPEG, whoever sent it", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.ui({ type: "importLogo", result: picture("iVBORw0KGgo") });
    alice.pump();
    await net.settle();
    expect(bob.shell.doc().logos).toEqual({});
    expect(alice.shell.doc().logos).toEqual({});
  });
});
