import { describe, expect, it } from "vitest";
import { NO_MODS } from "@fm/editor";
import { jointAt, wallBetween } from "@fm/editor/testing";
import { Net, seqOf, sharedRoom, submitIds } from "./net";

// Lean mode: only the blocking and reconnect scenarios. Lost messages, sequence gaps, crashes and late joiners
// are not covered here.
describe("blocking and recovery against the real server (spec §7.4, §7.7, §8, §9)", () => {
  it("while an edit is outstanding, other edits are refused and never replayed; the camera and selection still work", async () => {
    const net = new Net();
    const { alice } = await sharedRoom(net);
    const s = alice.shell;
    const before = submitIds(alice).length;
    s.key("v");
    alice.holding = true;
    s.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    await net.settle(); // accepted on the server; the replies wait
    expect(s.view().project).toMatchObject({ status: "waiting for server", canEdit: false });

    s.drag({ x: 0, y: 0 }, { x: -0.4, y: 0 }); // no drag starts while edits are blocked
    const bottom = wallBetween(s.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
    s.click({ x: 3, y: 0 });
    expect(s.state.selection).toEqual([{ table: "walls", id: bottom }]);
    s.key("Delete");
    expect(s.view().toast).toBe("Waiting for server");
    s.key("z", { meta: true });
    expect(s.view().toast).toBe("Waiting for server");
    const zoom = s.state.camera.zoom;
    s.send({ type: "wheel", screen: { x: 600, y: 400 }, deltaX: 0, deltaY: -100, mods: { ...NO_MODS, ctrl: true } });
    expect(s.state.camera.zoom).toBeGreaterThan(zoom);

    alice.holding = false;
    await net.settle();
    expect(submitIds(alice)).toHaveLength(before + 1);
    expect(s.view().project).toMatchObject({ status: "saved", canEdit: true });
    jointAt(s.doc(), { x: 0, y: 0 });
    wallBetween(s.doc(), { x: 0, y: 0 }, { x: 6, y: 0 });
  });

  it("an ack lost with the connection: the snapshot contains the edit and the same-ID resend is acked from the receipt", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    const before = seqOf(alice);
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    alice.pump();
    await net.app.idle(); // accepted and saved; the changes and ack are still queued…
    alice.disconnect(); // …and lost with the connection
    expect(alice.shell.view().project?.status).toBe("offline");
    alice.connect();
    await net.settle();
    const [original, resend] = submitIds(alice).slice(-2);
    expect(resend).toBe(original);
    expect(alice.shell.view().project?.status).toBe("saved");
    expect(seqOf(alice)).toBe(before + 1); // applied once
    expect(seqOf(bob)).toBe(before + 1);
    expect(bob.shell.doc()).toEqual(alice.shell.doc());
  });
});
