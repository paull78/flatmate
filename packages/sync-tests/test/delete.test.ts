import { describe, expect, it } from "vitest";
import { PROJECT_DELETED } from "@fm/editor";
import { Net, sharedRoom } from "./net";

describe("deleting a shared project (spec §7.2.1)", () => {
  it("sends a client with a pending edit back to the list; the project is gone for everyone", async () => {
    const net = new Net();
    const { alice, bob, projectId } = await sharedRoom(net);
    bob.shell.ui({ type: "showProjectList" });
    await net.settle();

    bob.shell.ui({ type: "deleteProject", id: projectId });
    bob.pump(); // the delete reaches the project queue first…
    alice.shell.key("v");
    alice.shell.drag({ x: 6, y: 4 }, { x: 6, y: 4.6 });
    alice.pump(); // …then Alice's edit, which finds no project
    expect(alice.shell.view().project?.status).toBe("waiting for server");
    await net.settle();

    expect(net.fatal).toEqual([]);
    expect(alice.shell.state.document).toBeNull();
    expect(alice.shell.view().toast).toBe(PROJECT_DELETED);
    expect(alice.shell.view().projectList?.items).toEqual([]);
    expect(bob.shell.view().projectList?.items).toEqual([]);
    expect(await net.repository.load(projectId)).toBeNull();

    alice.shell.ui({ type: "openProject", id: projectId }); // a stale list elsewhere: the open fails in the list
    await net.settle();
    expect(alice.shell.view().projectList?.error).toBe("Unknown project");
  });

  it("a client offline during the delete returns to the list when it reconnects", async () => {
    const net = new Net();
    const { alice, bob, projectId } = await sharedRoom(net);
    bob.shell.ui({ type: "showProjectList" });
    await net.settle();
    alice.disconnect();
    bob.shell.ui({ type: "deleteProject", id: projectId });
    await net.settle();
    expect(alice.shell.view().project?.status).toBe("offline");

    alice.connect();
    await net.settle();
    expect(alice.shell.state.document).toBeNull();
    expect(alice.shell.view().toast).toBe(PROJECT_DELETED);
  });
});
