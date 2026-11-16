import { describe, expect, it } from "vitest";
import { trailerOf } from "@fm/domain";
import { Net, sharedRoom } from "./net";

// The trailer's settings through the real server (trailer.03; AC-02): set by one client, read by the other.

describe("the trailer's settings against the real server", () => {
  it("a setting made in one client's Trailer section reaches the other", async () => {
    const net = new Net();
    const { alice, bob } = await sharedRoom(net);
    alice.shell.send({ type: "command", command: { type: "setProjectField", key: "surroundings", value: "wheels" } });
    alice.pump();
    await net.settle();
    alice.shell.ui({ type: "setField", fieldId: "trailer.axles", value: "3" });
    alice.pump();
    await net.settle();
    expect(trailerOf(bob.shell.doc()).axles).toBe(3);
    expect(bob.shell.view().trailer?.find((f) => f.id === "trailer.axles")?.value).toBe("3");
  });
});
